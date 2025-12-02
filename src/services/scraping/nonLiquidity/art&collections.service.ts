import FirecrawlApp from "@mendable/firecrawl-js";

/** -----------------------------
 * TYPES
 * ------------------------------ */
interface FirecrawlSearchResult {
  url: string;
  title?: string;
  description?: string;
}

/** -----------------------------
 * FIRECRAWL CLIENT SETUP
 * ------------------------------ */
let firecrawlClient: FirecrawlApp | null = null;

function getFirecrawlClient(): FirecrawlApp {
  if (!firecrawlClient) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error("FIRECRAWL_API_KEY is required in environment variables");
    }
    firecrawlClient = new FirecrawlApp({ apiKey });
  }
  return firecrawlClient;
}

/** -----------------------------
 * CONFIG
 * ------------------------------ */

// Art transaction keywords (similar to DAF_KEYWORDS pattern)
const ART_TRANSACTION_KEYWORDS = [
  // Direct transaction terms
  "sold for",
  "bought for",
  "purchased for",
  "acquired for",
  "hammer price",
  "price realized",
  "winning bid",
  "final price",
  "sale price",

  // Auction-specific terms
  "auction result",
  "auction record",
  "lot sold",
  "sold at auction",
  "Christie's sold",
  "Sotheby's sold",
  "Phillips sold",

  // Buyer/seller mentions
  "collector purchased",
  "buyer acquired",
  "private collector",
  "museum acquired",
  "foundation purchased",

  // High-value transactions
  "million dollar",
  "record price",
  "top lot",
  "highest price",
  "notable sale",
];

// Blocked domains
const BLOCKED_DOMAINS = [
  "pinterest.com",
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "reddit.com",
];

/** -----------------------------
 * HELPER FUNCTIONS
 * ------------------------------ */

/**
 * Check if domain is blocked
 */
function isDomainBlocked(domain: string): boolean {
  const normalized = domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
  return BLOCKED_DOMAINS.some((blocked) => normalized.includes(blocked));
}

/**
 * Generate search queries for art transactions
 * Similar to generateSearchQueries in DAF scraper
 */
function generateArtSearchQueries(baseQuery?: string): string[] {
  const queries: string[] = [];

  // If no base query, search for recent high-value art transactions
  if (!baseQuery) {
    queries.push(
      "Christie's auction sold for million",
      "Sotheby's auction sold for million",
      "Phillips auction sold for million",
      "art auction record price 2024",
      "art auction record price 2025",
      "museum acquired artwork",
      "private collector purchased art",
      "auction house sold painting",
      "contemporary art sold for",
      "fine art auction results",
    );
  } else {
    // Search for specific entity/artist
    queries.push(
      baseQuery,
      `${baseQuery} auction sold`,
      `${baseQuery} purchased by collector`,
      `${baseQuery} acquired by museum`,
      `${baseQuery} Christie's Sotheby's`,
      `"${baseQuery}" sold for`,
      `"${baseQuery}" auction result`,
      `"${baseQuery}" hammer price`,
    );
  }

  return queries;
}

/**
 * Search for art transaction pages using FireCrawl
 * Similar to searchDAFPages in DAF scraper
 */
export async function searchArtTransactionPages(
  query: string,
  limit: number = 20,
): Promise<FirecrawlSearchResult[]> {
  console.log(`🔎 Firecrawl search: ${query.substring(0, 120)}...`);
  const firecrawl = getFirecrawlClient();

  try {
    const res: any = await firecrawl.search(query, { limit });
    const web = res?.web || res?.data?.web || [];
    return (Array.isArray(web) ? web : [])
      .map((r: any) => ({
        url: r.url || r.link || "",
        title: r.title || "",
        description: r.description || r.snippet || "",
      }))
      .filter((r: any) => r.url);
  } catch (err: any) {
    console.warn(`   ⚠️  Search failed for '${query}': ${err?.message}`);
    return [];
  }
}

/**
 * Main function: Discover art transaction links
 * This follows the same pattern as discoverAndScrapeDAFContributions
 */
export const getScrapingLinks = async (baseQuery?: string): Promise<FirecrawlSearchResult[]> => {
  try {
    console.log("\n🔍 Discovering art transaction pages...");

    // Generate search queries dynamically
    const searchQueries = generateArtSearchQueries(baseQuery);
    const allResults: FirecrawlSearchResult[] = [];

    console.log(`   🔎 Running ${searchQueries.length} search queries...`);

    // Search each query
    for (const query of searchQueries) {
      try {
        const results = await searchArtTransactionPages(query, 10);
        allResults.push(...results);

        // Small delay to respect rate limits
        await new Promise((res) => setTimeout(res, 500));
      } catch (e: any) {
        console.warn(`   ⚠️  Search error for '${query}': ${e?.message || e}`);
      }
    }

    // Deduplicate & remove blocked domains
    const seen = new Set<string>();
    const unique = allResults.filter((r) => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "");
        if (isDomainBlocked(host)) return false;
      } catch {
        return false;
      }

      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    console.log(`   ✅ Found ${unique.length} unique art transaction page(s)`);
    return unique;
  } catch (error: any) {
    console.error("❌ Error in getScrapingLinks():", error.message);
    return [];
  }
};

/**
 * ---------------------------------------------
 * Placeholder: Your custom scraper on a URL
 * ---------------------------------------------
 */
export const getArtTransactionInsight = async (url: string) => {
  try {
    // parse the data

    return {
      url,
      success: true,
      data: {}, // fill with your parsed data
    };
  } catch (error: any) {
    console.log(`❌ Error scraping ${url}:`, error.message);
    return { url, success: false };
  }
};
