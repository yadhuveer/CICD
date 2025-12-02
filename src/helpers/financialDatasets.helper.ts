import axios from "axios";
import logger from "../utils/logger.js";

/**
 * =========================================
 * Financial Datasets API Service
 * =========================================
 * Fetches company sector, industry, and fundamental data
 * API Docs: https://financialdatasets.ai/
 */

const API_BASE_URL = "https://api.financialdatasets.ai";
const API_KEY = process.env.FINANCIAL_DATASET_API;

type CompanyFacts = {
  ticker: string;
  name?: string;
  sector?: string;
  industry?: string;
  marketCap?: number;
  exchange?: string;
  [key: string]: any;
};

type SectorLookupCache = {
  [ticker: string]: {
    sector: string | null;
    industry: string | null;
    timestamp: number;
  };
};

const sectorCache: SectorLookupCache = {};
const CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Fetch company facts from Financial Datasets API
 */
export async function fetchCompanyFacts(ticker: string): Promise<CompanyFacts | null> {
  if (!API_KEY) {
    logger.warn("FINANCIAL_DATASET_API not configured. Skipping sector lookup.");
    return null;
  }

  if (!ticker) {
    return null;
  }

  // Normalize ticker (uppercase, trim)
  const normalizedTicker = ticker.trim().toUpperCase();

  try {
    logger.debug(`Fetching company facts for ticker: ${normalizedTicker}`);

    const response = await axios.get(`${API_BASE_URL}/company/facts`, {
      params: { ticker: normalizedTicker },
      headers: {
        "X-API-KEY": API_KEY,
      },
      timeout: 10000, // 10 second timeout
    });

    if (response.data) {
      logger.debug(
        `Successfully fetched facts for ${normalizedTicker}: ${response.data.sector || "N/A"}`,
      );
      return response.data;
    }

    return null;
  } catch (err: any) {
    if (err.response?.status === 404) {
      logger.debug(`Ticker ${normalizedTicker} not found in Financial Datasets API`);
    } else if (err.response?.status === 401) {
      logger.error("Financial Datasets API authentication failed. Check API key.");
    } else if (err.response?.status === 429) {
      logger.warn("Financial Datasets API rate limit exceeded");
    } else {
      logger.error(`Error fetching company facts for ${normalizedTicker}: ${err.message}`);
    }
    return null;
  }
}

/**
 * Get sector for a ticker (with caching)
 */
export async function getSectorForTicker(ticker: string): Promise<string | null> {
  if (!ticker) return null;

  const normalizedTicker = ticker.trim().toUpperCase();

  // Check cache first
  const cached = sectorCache[normalizedTicker];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug(`Using cached sector for ${normalizedTicker}: ${cached.sector || "N/A"}`);
    return cached.sector;
  }

  // Fetch from API
  const facts = await fetchCompanyFacts(normalizedTicker);
  const sector = facts?.sector || null;

  // Cache the result
  sectorCache[normalizedTicker] = {
    sector,
    industry: facts?.industry || null,
    timestamp: Date.now(),
  };

  return sector;
}

/**
 * Batch fetch sectors for multiple tickers (with rate limiting)
 */
export async function batchGetSectors(
  tickers: string[],
  delayMs: number = 100,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();

  logger.info(`Batch fetching sectors for ${tickers.length} tickers...`);

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    if (!ticker) continue;

    const sector = await getSectorForTicker(ticker);
    results.set(ticker.toUpperCase(), sector);

    // Rate limiting: delay between requests
    if (i < tickers.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  logger.info(
    `Batch fetch complete. ${Array.from(results.values()).filter((s) => s !== null).length}/${tickers.length} sectors found.`,
  );

  return results;
}

/**
 * Clear the sector cache (useful for testing or manual refresh)
 */
export function clearSectorCache() {
  Object.keys(sectorCache).forEach((key) => delete sectorCache[key]);
  logger.info("Sector cache cleared");
}
