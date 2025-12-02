/**
 * SEC Company Tickers Cache Service
 * Downloads and caches SEC's free company_tickers.json file
 * Source: https://www.sec.gov/files/company_tickers.json
 * Updated daily by SEC, 100% free, no API key needed
 */

import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const CACHE_FILE_PATH = path.join(__dirname, "../../data/sec-company-tickers.json");
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory cache for fast lookups
let tickersCache: Map<string, CompanyTickerInfo> | null = null;
let lastCacheUpdate: number = 0;

export interface CompanyTickerInfo {
  cik: string;
  ticker: string;
  title: string; // Company name
}

/**
 * Get company ticker info from SEC's database
 * OPTIMIZED: Uses indexed lookups instead of full cache iteration
 */
export async function getTickerInfoByCusipOrName(
  cusip?: string,
  issuerName?: string,
): Promise<CompanyTickerInfo | null> {
  const cache = await getTickersCache();

  if (!issuerName) return null;

  // Normalize issuer name for matching
  const normalizedName = normalizeCompanyName(issuerName);

  // 1. Try direct index lookup first (O(1))
  const directMatch = cache.get(`NAME:${normalizedName}`);
  if (directMatch) {
    return directMatch;
  }

  // 2. Try fuzzy matching (only if no direct match)
  // This is still O(n) but only runs if step 1 fails
  for (const [key, info] of cache.entries()) {
    // Skip indexed entries (they start with prefixes)
    if (key.startsWith("CIK:") || key.startsWith("NAME:")) continue;

    const cachedName = normalizeCompanyName(info.title);

    // If normalized name contains the cached name or vice versa
    if (normalizedName.includes(cachedName) || cachedName.includes(normalizedName)) {
      return info;
    }
  }

  // 3. Try word-by-word matching (last resort)
  const nameWords = normalizedName.split(" ").filter((w) => w.length > 3);
  if (nameWords.length >= 2) {
    for (const [key, info] of cache.entries()) {
      // Skip indexed entries
      if (key.startsWith("CIK:") || key.startsWith("NAME:")) continue;

      const cachedName = normalizeCompanyName(info.title);
      const matchedWords = nameWords.filter((word) => cachedName.includes(word));

      // If at least 2 significant words match
      if (matchedWords.length >= 2) {
        return info;
      }
    }
  }

  return null;
}

/**
 * Get or load tickers cache
 */
async function getTickersCache(): Promise<Map<string, CompanyTickerInfo>> {
  const now = Date.now();

  // Return in-memory cache if fresh
  if (tickersCache && now - lastCacheUpdate < CACHE_DURATION_MS) {
    return tickersCache;
  }

  // Try to load from file cache
  try {
    const stats = await fs.stat(CACHE_FILE_PATH);
    const fileAge = now - stats.mtimeMs;

    // If file is fresh, load it
    if (fileAge < CACHE_DURATION_MS) {
      logger.info("📂 Loading SEC tickers from cache file...");
      const data = await fs.readFile(CACHE_FILE_PATH, "utf-8");
      const parsed = JSON.parse(data);
      tickersCache = buildTickerCache(parsed);
      lastCacheUpdate = now;
      logger.info(`✅ Loaded ${tickersCache.size} tickers from cache`);
      return tickersCache;
    }
  } catch (error) {
    // File doesn't exist or error reading, will download fresh
  }

  // Download fresh data
  return await downloadAndCacheTickers();
}

/**
 * Download fresh ticker data from SEC
 */
async function downloadAndCacheTickers(): Promise<Map<string, CompanyTickerInfo>> {
  logger.info("🌐 Downloading fresh SEC company tickers...");

  try {
    const response = await axios.get(SEC_TICKERS_URL, {
      headers: {
        "User-Agent": "Longwall Research Tool contact@longwall.com",
      },
      timeout: 30000,
    });

    const data = response.data;

    // Ensure data directory exists
    const dataDir = path.dirname(CACHE_FILE_PATH);
    await fs.mkdir(dataDir, { recursive: true });

    // Save to file
    await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(data, null, 2), "utf-8");
    logger.info("💾 Saved SEC tickers to cache file");

    // Build in-memory cache
    tickersCache = buildTickerCache(data);
    lastCacheUpdate = Date.now();

    logger.info(`✅ Downloaded and cached ${tickersCache.size} SEC tickers`);
    return tickersCache;
  } catch (error: any) {
    logger.error(`Failed to download SEC tickers: ${error.message}`);

    // If download fails, try to use stale cache
    try {
      const data = await fs.readFile(CACHE_FILE_PATH, "utf-8");
      const parsed = JSON.parse(data);
      tickersCache = buildTickerCache(parsed);
      lastCacheUpdate = Date.now();
      logger.warn(`⚠️  Using stale SEC tickers cache (${tickersCache.size} tickers)`);
      return tickersCache;
    } catch {
      // No cache available
      throw new Error("Failed to download SEC tickers and no cache available");
    }
  }
}

/**
 * Build ticker cache from SEC data
 * SEC format: { "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, ... }
 */
function buildTickerCache(data: any): Map<string, CompanyTickerInfo> {
  const cache = new Map<string, CompanyTickerInfo>();

  // SEC data is an object with numeric keys
  for (const key in data) {
    const entry = data[key];
    if (entry && entry.ticker && entry.title) {
      const cik = String(entry.cik_str).padStart(10, "0"); // Pad CIK to 10 digits
      const ticker = String(entry.ticker).toUpperCase();
      const title = String(entry.title);

      const info: CompanyTickerInfo = { cik, ticker, title };

      // Index by ticker (primary key)
      cache.set(ticker, info);

      // Also index by CIK for quick lookups
      cache.set(`CIK:${cik}`, info);

      // Index by normalized company name for fuzzy matching
      const normalizedTitle = normalizeCompanyName(title);
      cache.set(`NAME:${normalizedTitle}`, info);
    }
  }

  return cache;
}

/**
 * Normalize company name for matching
 */
function normalizeCompanyName(name: string): string {
  let normalized = name.toUpperCase();

  // Expand common abbreviations BEFORE removing suffixes
  const abbreviations: Record<string, string> = {
    " PRODS ": " PRODUCTS ",
    " PROD ": " PRODUCTS ",
    " CHEMS ": " CHEMICALS ",
    " CHEM ": " CHEMICAL ",
    " HLDGS ": " HOLDINGS ",
    " HLDG ": " HOLDING ",
    " FINL ": " FINANCIAL ",
    " WTR ": " WATER ",
    " WKS ": " WORKS ",
    " MFG ": " MANUFACTURING ",
    " INTL ": " INTERNATIONAL ",
    " NATL ": " NATIONAL ",
    " SVCS ": " SERVICES ",
    " SVC ": " SERVICE ",
    " TECH ": " TECHNOLOGY ",
    " COMM ": " COMMUNICATIONS ",
    " CMNTYS ": " COMMUNITIES ",
    " PPTY ": " PROPERTY ",
    " PRTS ": " PARTS ",
    " MGMT ": " MANAGEMENT ",
    " INVT ": " INVESTMENT ",
    " INVS ": " INVESTMENTS ",
    " BANCORP": " BANK CORP",
  };

  // Add spaces around to match word boundaries
  normalized = ` ${normalized} `;

  // Expand abbreviations
  for (const [abbr, full] of Object.entries(abbreviations)) {
    normalized = normalized.replace(new RegExp(abbr, "g"), full);
  }

  // Replace "&" with "AND"
  normalized = normalized.replace(/\s+&\s+/g, " AND ");

  // Remove common suffixes (at the end)
  normalized = normalized
    .replace(/\s+(INC|CORP|LLC|LTD|CO|LP|COMPANY|INCORPORATED|CORPORATION)\.?\s*$/i, "")
    .replace(/\s+NEW\s*$/i, "") // Handle "NEW" suffix
    .replace(/\s+COMMON STOCK\s*$/i, "")
    .replace(/\s+CLASS [A-Z]\s*$/i, "")
    .replace(/\s+CL [A-Z]\s*$/i, "");

  // Remove special characters (except dots for .com)
  normalized = normalized
    .replace(/[^A-Z0-9\s.]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}

/**
 * Force refresh the cache (useful for testing or manual updates)
 */
export async function refreshTickersCache(): Promise<void> {
  logger.info("🔄 Forcing SEC tickers cache refresh...");
  await downloadAndCacheTickers();
}
