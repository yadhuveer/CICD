import axios from "axios";
import { getUniqueTickers } from "../../utils/institutional/holdings-deduplication.util.js";
import type { DeduplicatedHolding, SectorData } from "../../types/institutional.types.js";

const FINANCIAL_DATASETS_API_URL = "https://api.financialdatasets.ai/company/facts";
const RATE_LIMIT_DELAY_MS = 100;

// In-memory cache for sector data (cleared on server restart)
const sectorCache = new Map<string, SectorData | null>();

export async function enrichHoldingsWithSectors(
  holdings: DeduplicatedHolding[],
): Promise<DeduplicatedHolding[]> {
  const uniqueTickers = getUniqueTickers(holdings);
  const tickersToFetch = uniqueTickers.filter((t) => t);
  if (tickersToFetch.length === 0) return holdings;

  const tickerToSectorMap = await fetchSectorsForTickers(tickersToFetch);

  const updatedHoldings = holdings.map((holding) => {
    if (!holding.ticker) return { ...holding, sector: "Unknown" };
    const sectorData = tickerToSectorMap.get(holding.ticker.toUpperCase());
    return { ...holding, sector: sectorData?.sector || "Unknown" };
  });

  const enrichedCount = updatedHoldings.filter((h) => h.sector && h.sector !== "Unknown").length;
  console.log(
    `Sectors: ${enrichedCount}/${holdings.length} (${((enrichedCount / holdings.length) * 100).toFixed(1)}%)`,
  );

  return updatedHoldings;
}

async function fetchSectorsForTickers(tickers: string[]): Promise<Map<string, SectorData>> {
  const apiKey = process.env.FINANCIAL_DATASETS_API_KEY;
  if (!apiKey) return new Map();

  const tickerToSectorMap = new Map<string, SectorData>();

  // Check cache first
  const uncachedTickers = tickers.filter((ticker) => {
    const tickerUpper = ticker.toUpperCase();
    const cached = sectorCache.get(tickerUpper);
    if (cached !== undefined) {
      if (cached) tickerToSectorMap.set(tickerUpper, cached);
      return false; // Skip API call
    }
    return true; // Need to fetch
  });

  if (uncachedTickers.length === 0) {
    console.log(`Sectors: ${tickers.length}/${tickers.length} (100.0% cached)`);
    return tickerToSectorMap;
  }

  console.log(`Fetching ${uncachedTickers.length}/${tickers.length} uncached sectors`);

  // Process ALL tickers in parallel (much faster)
  const allResults = await Promise.allSettled(
    uncachedTickers.map(async (ticker) => {
      const tickerUpper = ticker.toUpperCase();
      const tickerVariants = ticker
        .split(/[,;/]/)
        .map((t) => t.trim())
        .filter((t) => t);

      for (const variant of tickerVariants) {
        const sectorData = await fetchSectorForTicker(variant, apiKey);
        if (sectorData) {
          return { ticker: tickerUpper, sectorData };
        }
      }
      return { ticker: tickerUpper, sectorData: null };
    }),
  );

  // Collect results and cache them
  allResults.forEach((result) => {
    if (result.status === "fulfilled") {
      const { ticker, sectorData } = result.value;
      sectorCache.set(ticker, sectorData); // Cache both hits and misses
      if (sectorData) {
        tickerToSectorMap.set(ticker, sectorData);
      }
    }
  });

  return tickerToSectorMap;
}

async function fetchSectorForTicker(ticker: string, apiKey: string): Promise<SectorData | null> {
  try {
    const response = await axios.get(FINANCIAL_DATASETS_API_URL, {
      params: { ticker },
      headers: { "X-API-KEY": apiKey },
      timeout: 10000,
    });

    const data = response.data;
    if (data?.company_facts?.sector) {
      return {
        ticker: ticker.toUpperCase(),
        sector: data.company_facts.sector,
        industry: data.company_facts.industry,
        marketCap: data.company_facts.market_cap,
      };
    }
    return null;
  } catch (error: any) {
    if (error.response?.status === 429) await sleep(2000);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
