import FirecrawlApp from "@mendable/firecrawl-js";

/* ------------------------------------------------------------
 * TYPES
 * ------------------------------------------------------------ */
export interface FirecrawlSearchResult {
  url: string;
  title?: string;
  description?: string;
}

/* ------------------------------------------------------------
 * FIRECRAWL CLIENT SETUP (singleton)
 * ------------------------------------------------------------ */
let firecrawlClient: FirecrawlApp | null = null;

function getFirecrawlClient(): FirecrawlApp {
  if (!firecrawlClient) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error("❌ FIRECRAWL_API_KEY is missing");
    }
    firecrawlClient = new FirecrawlApp({ apiKey });
  }
  return firecrawlClient;
}

/* ------------------------------------------------------------
 * CONFIG - Keywords, Blocklists
 * ------------------------------------------------------------ */
export const ART_TRANSACTION_KEYWORDS = [
  "sold for",
  "bought for",
  "purchased for",
  "acquired for",
  "hammer price",
  "price realized",
  "winning bid",
  "final price",
  "sale price",
  "auction result",
  "auction record",
  "lot sold",
  "sold at auction",
  "Christie's",
  "Sotheby's",
  "Phillips",
  "collector purchased",
  "museum acquired",
  "private collector",
  "record price",
  "million dollar",
  "top lot",
  "high estimate",
  "auction highlights",
  "evening sale",
  "day sale",
];

export const BLOCKED_DOMAINS = [
  "pinterest.com",
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "reddit.com",
];

/* HARD SKIP – Auction houses that block scraping */
export const PROTECTED_AUCTION_DOMAINS = [
  "christies.com",
  "sothebys.com",
  "phillips.com",
  "bonhams.com",
  "doyle.com",
  "freemansauction.com",
  "hindmanauctions.com",
];

/* ------------------------------------------------------------
 * HELPERS
 * ------------------------------------------------------------ */
function normalizeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isDomainBlocked(domain: string): boolean {
  return BLOCKED_DOMAINS.some((b) => domain.includes(b));
}

function isProtectedAuctionHouse(domain: string): boolean {
  return PROTECTED_AUCTION_DOMAINS.some((b) => domain.includes(b));
}

/**
 * Keyword filter → remove irrelevant results
 */
function containsArtKeywords(text: string = ""): boolean {
  const lower = text.toLowerCase();
  return ART_TRANSACTION_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Dynamic search query generation
 */
function generateArtSearchQueries(baseQuery?: string): string[] {
  if (!baseQuery) {
    return [
      "Christie's auction results sold",
      "Sotheby's auction sold millionaire buyer",
      "Phillips auction hammered for million",
      "art auction record price 2024",
      "fine art auction results 2025",
      "painting sold at auction record price",
      "museum acquired painting announcement",
      "gallery announced major sale",
      "high-value art purchase press release",
    ];
  }

  return [
    `${baseQuery} auction results`,
    `${baseQuery} Christie's Sotheby's sold`,
    `"${baseQuery}" sold for`,
    `"${baseQuery}" hammer price`,
    `"${baseQuery}" purchased by collector`,
    `${baseQuery} auction record price`,
  ];
}

/* ------------------------------------------------------------
 * FIRECRAWL SEARCH FUNCTIONS
 * ------------------------------------------------------------ */
export async function searchArtTransactionPages(
  query: string,
  limit = 15,
): Promise<FirecrawlSearchResult[]> {
  console.log(`🔎 Searching (query): ${query}`);

  const firecrawl = getFirecrawlClient();

  try {
    const res: any = await firecrawl.search(query, { limit });

    const items = res?.web || res?.data?.web || res?.data || res?.results || [];

    if (!Array.isArray(items)) return [];

    return items
      .map((item: any) => ({
        url: item.url || item.link || "",
        title: item.title || "",
        description: item.description || item.snippet || "",
      }))
      .filter((r: FirecrawlSearchResult) => r.url);
  } catch (err: any) {
    console.warn(`⚠️ Firecrawl search failed: ${err.message}`);
    return [];
  }
}

/* ------------------------------------------------------------
 * MAIN DISCOVERY FUNCTION
 * ------------------------------------------------------------ */
export const getScrapingLinks = async (baseQuery?: string): Promise<FirecrawlSearchResult[]> => {
  try {
    console.log("\n🎨 Discovering art + collectibles transaction pages...");

    const queries = generateArtSearchQueries(baseQuery);
    const collected: FirecrawlSearchResult[] = [];

    console.log(`   🔍 Running ${queries.length} search queries...\n`);

    for (const q of queries) {
      const results = await searchArtTransactionPages(q, 5);
      collected.push(...results);
      await new Promise((r) => setTimeout(r, 450));
    }

    // Deduplicate
    const seen = new Set<string>();
    let unique = collected.filter((item) => {
      if (!item.url) return false;
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });

    /* HARD SKIP: Known protected auction houses (skip early) */
    unique = unique.filter((item) => {
      const domain = normalizeDomain(item.url);
      if (isProtectedAuctionHouse(domain)) {
        console.log(`⏭ HARD SKIP PROTECTED AUCTION SITE: ${domain}`);
        return false;
      }
      return true;
    });

    /* Soft skip: social, irrelevant domains */
    unique = unique.filter((item) => {
      const domain = normalizeDomain(item.url);
      return !isDomainBlocked(domain);
    });

    /* Keyword filter */
    unique = unique.filter((item) => {
      const combined = `${item.title} ${item.description}`;
      return containsArtKeywords(combined);
    });

    console.log(`   ✅ Final result: ${unique.length} valid URLs\n`);

    return unique;
  } catch (err: any) {
    console.error("❌ Error in getScrapingLinks():", err.message);
    return [];
  }
};

/* ------------------------------------------------------------
 * SCRAPER STUB
 * ------------------------------------------------------------ */
export const getArtTransactionInsight = async (url: string) => {
  try {
    return { url, success: true, data: {} };
  } catch (err: any) {
    console.error(`❌ Scraper error for ${url}: ${err.message}`);
    return { url, success: false };
  }
};
