import axios from "axios";
import OpenAI from "openai";
import { withRetry } from "../../utils/institutional/retry.util.js";
import { isValidCusip } from "../../utils/institutional/holdings-deduplication.util.js";
import { cleanTickerSymbol, isValidTicker } from "../../utils/institutional/ticker.util.js";
import { chunkArray, sleep } from "../../utils/institutional/array.util.js";
import type { DeduplicatedHolding, FigiResponse } from "../../types/institutional.types.js";

const OPENFIGI_API_URL = "https://api.openfigi.com/v3/mapping";
const OPENFIGI_BATCH_SIZE = 10;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory cache for ticker resolutions
const tickerCache = new Map<string, string>();

export async function resolveTickersForHoldings(
  holdings: DeduplicatedHolding[],
): Promise<DeduplicatedHolding[]> {
  const cusipToTickerMap = new Map<string, string>();
  const failedHoldings: DeduplicatedHolding[] = [];

  const holdingsWithCusip = holdings.filter((h) => isValidCusip(h.cusip));
  if (holdingsWithCusip.length === 0) return holdings;

  // 1. Check Cache First
  const uncachedHoldings = holdingsWithCusip.filter((h) => {
    const cusip = h.cusip.trim().toUpperCase();
    const cached = tickerCache.get(cusip);
    if (cached) {
      cusipToTickerMap.set(cusip, cached);
      return false; // Skip API call
    }
    return true; // Need to fetch
  });

  if (uncachedHoldings.length === 0) {
    // All found in cache
    return holdings.map((h) => {
      const ticker = cusipToTickerMap.get(h.cusip.trim().toUpperCase());
      return ticker ? { ...h, ticker } : h;
    });
  }

  console.log(`   Fetching ${uncachedHoldings.length} uncached tickers...`);

  // 2. Process Batches SEQUENTIALLY (Fix for "Stuck" process)
  const batches = chunkArray(uncachedHoldings, OPENFIGI_BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    // Progress indicator for large lists
    if (batches.length > 5) {
      process.stdout.write(`\r   > Resolving batch ${i + 1}/${batches.length}... `);
    }

    try {
      // Fetch one batch
      const batchResults = await resolveBatchWithOpenFIGI(batch);

      // Process results
      for (const holding of batch) {
        const cusip = holding.cusip.trim().toUpperCase();
        const ticker = batchResults.get(cusip);
        if (ticker) {
          cusipToTickerMap.set(cusip, ticker);
          tickerCache.set(cusip, ticker);
        } else {
          failedHoldings.push(holding);
        }
      }
    } catch (err) {
      // If a batch fails, add to failed list and continue
      failedHoldings.push(...batch);
    }

    // CRITICAL: Delay between batches to prevent 429 Rate Limits / Hanging
    await sleep(500);
  }

  if (batches.length > 5) console.log(""); // New line after progress bar

  // 3. AI Fallback for failed items (Also Sequential)
  if (failedHoldings.length > 0) {
    // Limit AI resolution to prevent hanging on massive lists
    const MAX_AI_ATTEMPTS = 100;
    const itemsToResolve = failedHoldings.slice(0, MAX_AI_ATTEMPTS);

    console.log(
      `   Attempting AI resolution for ${itemsToResolve.length} items (${failedHoldings.length - itemsToResolve.length} skipped)...`,
    );

    for (let i = 0; i < itemsToResolve.length; i++) {
      const holding = itemsToResolve[i];
      const cusip = holding.cusip.trim().toUpperCase();

      // Progress indicator every 10 items
      if (i % 10 === 0 && i > 0) {
        process.stdout.write(`\r   > AI resolving ${i}/${itemsToResolve.length}... `);
      }

      try {
        const ticker = await resolveTickerWithAI(cusip, holding.issuerName);
        if (ticker) {
          cusipToTickerMap.set(cusip, ticker);
          tickerCache.set(cusip, ticker);
        }
        await sleep(200); // Gentle delay for OpenAI
      } catch (error) {
        // Ignore AI errors and continue
      }
    }

    if (itemsToResolve.length > 10) console.log(""); // New line after progress
  }

  // 4. Apply Tickers to Holdings
  const updatedHoldings = holdings.map((h) => {
    const ticker = cusipToTickerMap.get(h.cusip.trim().toUpperCase());
    return ticker ? { ...h, ticker } : h;
  });

  const resolved = updatedHoldings.filter((h) => h.ticker).length;
  console.log(
    `   ✅ Tickers Resolved: ${resolved}/${holdings.length} (${((resolved / holdings.length) * 100).toFixed(1)}%)`,
  );

  return updatedHoldings;
}

async function resolveBatchWithOpenFIGI(
  holdings: DeduplicatedHolding[],
): Promise<Map<string, string>> {
  const mappings = holdings.map((h) => ({
    idType: "ID_CUSIP",
    idValue: h.cusip.trim(),
    exchCode: "US",
  }));

  const results = await withRetry(
    async () => {
      const response = await axios.post<FigiResponse[]>(OPENFIGI_API_URL, mappings, {
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
      });
      return response.data;
    },
    { maxAttempts: 2, initialDelayMs: 1000 },
    "OpenFIGI",
  );

  const map = new Map<string, string>();
  results.forEach((result, index) => {
    if (result.error || !result.data) return;
    const cusip = holdings[index].cusip.trim().toUpperCase();

    // Prefer Equity on US exchanges
    const primaryListing = result.data.find(
      (item) =>
        item.marketSector === "Equity" &&
        (item.exchCode === "US" || item.exchCode === "UN" || item.exchCode === "UQ") &&
        item.ticker,
    );

    const ticker = primaryListing?.ticker || result.data[0]?.ticker;

    if (ticker) {
      const cleaned = cleanTickerSymbol(ticker);
      if (cleaned) map.set(cusip, cleaned);
    }
  });

  return map;
}

async function resolveTickerWithAI(cusip: string, companyName: string): Promise<string | null> {
  try {
    // Create timeout promise (10 seconds)
    const timeoutPromise = new Promise<null>((_, reject) => {
      setTimeout(() => reject(new Error("OpenAI timeout")), 10000);
    });

    // Race between API call and timeout
    const response = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a financial data expert. Provide ONLY the stock ticker symbol.",
          },
          {
            role: "user",
            content: `CUSIP: ${cusip}, Company: ${companyName}. Return ticker or "UNKNOWN".`,
          },
        ],
        temperature: 0,
        max_tokens: 10,
      }),
      timeoutPromise,
    ]);

    if (!response) return null;

    const ticker = response.choices[0]?.message?.content?.trim().toUpperCase();
    if (!ticker || ticker === "UNKNOWN" || ticker.length > 6) return null;
    return isValidTicker(ticker) ? ticker : null;
  } catch {
    return null;
  }
}
