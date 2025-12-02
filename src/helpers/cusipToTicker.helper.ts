import axios from "axios";
import logger from "../utils/logger.js";

/**
 * =========================================
 * Company Name to Ticker Mapping Service
 * =========================================
 * Uses OpenFIGI API to accurately map company names to ticker symbols
 */

/**
 * Clean and validate ticker symbol
 * Returns null if invalid
 */
function cleanTickerSymbol(ticker: string): string | null {
  if (!ticker) return null;

  // Remove whitespace and convert to uppercase
  let cleaned = ticker.trim().toUpperCase();

  // Remove common prefixes/suffixes that might be included
  cleaned = cleaned.replace(/^TICKER:?\s*/i, "");
  cleaned = cleaned.replace(/\s*(INC|CORP|LTD|LLC|LP|CLASS\s+[A-Z])$/i, "");

  // Valid ticker: 1-5 uppercase letters, optionally followed by a dot and more letters (e.g., BRK.B)
  const tickerRegex = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

  if (!tickerRegex.test(cleaned)) {
    return null;
  }

  return cleaned;
}

/**
 * Map CUSIP to ticker using OpenFIGI API
 * OpenFIGI is a free, reliable service for CUSIP→Ticker mapping
 */
async function mapCusipToTickerViaFIGI(cusip: string): Promise<string | null> {
  try {
    const response = await axios.post(
      "https://api.openfigi.com/v3/mapping",
      [
        {
          idType: "ID_CUSIP",
          idValue: cusip,
          exchCode: "US", // US exchanges only
        },
      ],
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 10000,
      },
    );

    if (response.data && response.data[0]?.data) {
      const results = response.data[0].data;

      // Find the primary listing (prefer common stock)
      const primaryListing = results.find(
        (item: any) =>
          item.marketSector === "Equity" &&
          (item.exchCode === "US" || item.exchCode === "UN") &&
          item.ticker,
      );

      if (primaryListing?.ticker) {
        const ticker = cleanTickerSymbol(primaryListing.ticker);
        if (ticker) {
          logger.debug(`FIGI: ${cusip} → ${ticker}`);
          return ticker;
        }
      }
    }

    return null;
  } catch (err: any) {
    if (err.response?.status === 404 || err.response?.status === 400) {
      logger.debug(`FIGI: CUSIP ${cusip} not found`);
    } else {
      logger.warn(`FIGI API error for ${cusip}: ${err.message}`);
    }
    return null;
  }
}

async function mapCompanyNameToTicker(companyName: string, cusip: string): Promise<string | null> {
  try {
    const cleanName = companyName
      .replace(/\b(INC|CORP|CORPORATION|LTD|LIMITED|LLC|LP|PLC)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    const searchUrl = `https://financialmodelingprep.com/api/v3/search?query=${encodeURIComponent(cleanName)}&limit=5&apikey=demo`;

    const response = await axios.get(searchUrl, { timeout: 10000 });

    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
      // Find best match
      const bestMatch = response.data.find(
        (item: any) =>
          item.symbol &&
          item.exchangeShortName &&
          (item.exchangeShortName === "NASDAQ" ||
            item.exchangeShortName === "NYSE" ||
            item.exchangeShortName === "AMEX"),
      );

      if (bestMatch?.symbol) {
        const ticker = cleanTickerSymbol(bestMatch.symbol);
        if (ticker) {
          logger.debug(`Name search: ${companyName} → ${ticker}`);
          return ticker;
        }
      }
    }

    return null;
  } catch (err: any) {
    logger.debug(`Name search failed for ${companyName}: ${err.message}`);
    return null;
  }
}

/**
 * Map CUSIPs to tickers with company name context
 * Processes ALL holdings with accurate ticker lookup
 */
export async function mapCusipsWithContext(
  holdings: Array<{ cusip: string; issuerName: string }>,
  chunkSize: number = 10, // Smaller chunks for API rate limiting
): Promise<Map<string, string>> {
  if (holdings.length === 0) {
    return new Map();
  }

  logger.info(`🔍 Mapping ${holdings.length} holdings to tickers using OpenFIGI API...`);

  const allMappings = new Map<string, string>();
  let successCount = 0;
  let failCount = 0;

  // Process ALL holdings - SEQUENTIAL to respect API rate limits
  let processed = 0;
  for (const holding of holdings) {
    processed++;

    if (processed % 10 === 1) {
      logger.info(`Processing ${processed}/${holdings.length} holdings...`);
    }

    try {
      // Try CUSIP lookup first (most accurate)
      let ticker = await mapCusipToTickerViaFIGI(holding.cusip);

      // Fallback to company name search
      if (!ticker) {
        ticker = await mapCompanyNameToTicker(holding.issuerName, holding.cusip);
      }

      if (ticker) {
        allMappings.set(holding.cusip, ticker);
        successCount++;
        logger.debug(`✓ ${holding.issuerName} → ${ticker}`);
      } else {
        failCount++;
        logger.debug(`✗ ${holding.issuerName} - no ticker found`);
      }
    } catch (err: any) {
      failCount++;
      logger.warn(`Error mapping ${holding.cusip} (${holding.issuerName}): ${err.message}`);
    }

    // Small delay between each request to respect rate limits (300ms = ~200 requests/minute)
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  logger.info(
    `✅ Mapping complete: ${successCount} succeeded, ${failCount} failed (${((successCount / holdings.length) * 100).toFixed(1)}% success rate)`,
  );

  return allMappings;
}

/**
 * Legacy function - redirects to mapCusipsWithContext
 */
export async function batchMapCusipsToTickers(
  cusips: string[],
  chunkSize: number = 10,
): Promise<Map<string, string>> {
  const holdings = cusips.map((cusip) => ({
    cusip,
    issuerName: "", // No name context available
  }));

  return mapCusipsWithContext(holdings, chunkSize);
}

/**
 * Map individual CUSIP to ticker (for testing)
 */
export async function mapCusipToTicker(cusip: string): Promise<string | null> {
  return mapCusipToTickerViaFIGI(cusip);
}
