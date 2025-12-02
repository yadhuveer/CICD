import FirecrawlApp from "@mendable/firecrawl-js";
import axios from "axios";
import logger from "../../../utils/logger.js";
import { SignalNew } from "../../../models/newSignal.model.js";
import {
  parseDAFContributionsDirect,
  DafContributionItem,
} from "../../../tools/AiAgents/scraperAgents/nonLiquidity/DafScraper.agent.js";

// Config
const BLOCKED_DOMAINS = ["example.com", "linkedin.com", "glassdoor.com"];
const DEFAULT_QUERY = "recurring donor advised fund contributions";

let firecrawlClient: FirecrawlApp | null = null;
function getClient() {
  if (!firecrawlClient) {
    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) throw new Error("FIRECRAWL_API_KEY missing");
    firecrawlClient = new FirecrawlApp({ apiKey: key });
  }
  return firecrawlClient;
}

function isDomainBlocked(domain: string) {
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  return BLOCKED_DOMAINS.some((d) => normalized.includes(d));
}

// Firecrawl wrapper
export async function searchDAFPages(query: string, limit = 20) {
  logger.info(`🔎 Firecrawl search: ${query}`);
  const client = getClient();
  try {
    const res: any = await client.search(query, { limit });
    const web = res?.web || res?.data?.web || [];
    return (Array.isArray(web) ? web : [])
      .map((r: any) => ({
        url: r.url || r.link || "",
        title: r.title || r.snippet || r.description || "",
        description: r.description || r.snippet || "",
      }))
      .filter((x: any) => x.url);
  } catch (err: any) {
    logger.warn("⚠️ searchDAFPages failed:", err?.message ?? err);
    return [];
  }
}

// axios scrape
export async function scrapeDAFPage(url: string): Promise<string | null> {
  try {
    logger.info(`   🌐 Scraping via axios: ${url}`);
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DAFScraper/1.0; +https://example.com/bot)",
        Accept: "text/html,application/xhtml+xml",
      },
      validateStatus: () => true,
    });

    const contentType = (res.headers["content-type"] || "").toLowerCase();
    if (contentType.includes("application/pdf") || contentType.includes("octet-stream")) {
      logger.warn(`   ⚠️ Skipping PDF/binary: ${url}`);
      return null;
    }

    return String(res.data || "");
  } catch (err: any) {
    logger.error(`   ❌ Axios scrape error for ${url}:`, err?.message || err);
    return null;
  }
}

function calculateRelevanceScore(content: string): number {
  const lower = content.toLowerCase();
  let score = 0;
  const high = [
    "donor advised fund",
    "donor-advised fund",
    "recurring grant",
    "sustained giving",
    "multi-year",
  ];
  const medium = ["daf grant", "daf contribution", "grantmaking", "annual report", "impact report"];

  for (const kw of high) {
    const matches = (lower.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || [])
      .length;
    score += matches * 3;
  }
  for (const kw of medium) {
    const matches = (lower.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || [])
      .length;
    score += matches * 2;
  }
  return score;
}

// Batch helper
async function processBatch<T, R>(
  items: T[],
  processor: (t: T) => Promise<R>,
  batchSize = 3,
  delayMs = 500,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const res = await Promise.all(batch.map(processor));
    out.push(...res);
    if (i + batchSize < items.length) await new Promise((r) => setTimeout(r, delayMs));
  }
  return out;
}

// ------------------------
// DISCOVERY PIPELINE
// ------------------------
export async function discoverAndScrapeDAFContributions(
  query: string = DEFAULT_QUERY,
  limit = 20,
): Promise<DafContributionItem[]> {
  logger.info(`\n🔍 Discovering DAF-related pages for: ${query}`);

  const queries = [
    query,
    `${query} "donor advised fund"`,
    `${query} "donor-advised fund"`,
    `${query} DAF recurring grants`,
    `${query} sustained giving`,
    `${query} annual report donors`,
  ];

  const searchResults = await processBatch(
    queries,
    async (q) => {
      try {
        return await searchDAFPages(q, Math.ceil(limit / 2));
      } catch (e: any) {
        logger.warn("search error", e?.message ?? e);
        return [];
      }
    },
    3,
    300,
  );

  const all: any[] = [];
  for (const r of searchResults) all.push(...r);

  const seen = new Set<string>();
  const unique = all.filter((r) => {
    if (!r.url) return false;
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

  logger.info(`   ✅ Found ${unique.length} unique candidate page(s)`);

  const scraped = await processBatch(
    unique.slice(0, limit * 2),
    async (c) => {
      const html = await scrapeDAFPage(c.url);
      if (!html) return null;
      const score = calculateRelevanceScore(html);
      return { url: c.url, html, score };
    },
    3,
    400,
  );

  const validPages = scraped
    .filter((s): s is { url: string; html: string; score: number } => s != null)
    .sort((a, b) => b.score - a.score);

  logger.info(`   📊 Successfully scraped ${validPages.length} pages`);

  const relevantPages = validPages.filter((p) => p.score >= 3);

  logger.info(`   ✅ ${relevantPages.length} pages meet relevance threshold`);

  const parseResults = await processBatch(
    relevantPages.slice(0, limit),
    async (page) => {
      const items = await parseDAFContributionsDirect(page.html, page.url);
      return items.map((i) => (i.sourceUrl ? i : { ...i, sourceUrl: page.url }));
    },
    2,
    800,
  );

  const extracted: DafContributionItem[] = [];
  for (const arr of parseResults) extracted.push(...arr);

  logger.info(`\n✅ Extraction complete: ${extracted.length} item(s) found`);
  return extracted;
}

/** Normalize name so dedupe does not break on case/spacing */
function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Strong dedupe check */
async function dedupeExists(item: DafContributionItem, normalizedName: string) {
  return SignalNew.findOne({
    filingType: "daf-contribution",
    filingLink: item.sourceUrl,
    fullName: normalizedName, // normalized
    "dafContributionData.contributionType": item.contributionType,
    "dafContributionData.amount": item.amount || null,
    "dafContributionData.frequency": item.frequency || null,
  }).lean();
}

/** Convert GPT result to DB doc */
function convertToSignalDoc(item: DafContributionItem, normalizedName: string) {
  return {
    signalSource: item.entityType === "person" ? "Person" : "Company",
    signalType: "DAF Contribution",
    filingType: "daf-contribution",
    filingLink: item.sourceUrl,

    fullName: normalizedName, // normalized key to prevent duplicates
    displayName: item.organizationName || item.personName || "Unknown", // human readable

    companyName: item.organizationName,
    designation: item.entityType === "person" ? "Donor" : undefined,

    insights: item.contextSummary || item.insights,

    dafContributionData: item,
    aiModelUsed: "gpt-4o-mini",

    processingStatus: "Processed",
    contactEnrichmentStatus: "pending",
  };
}

export async function saveDAFContributionsToDB(items: DafContributionItem[]) {
  let saved = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of items) {
    try {
      const rawName = item.organizationName || item.personName || "Unknown";

      const normalizedName = normalizeName(rawName);

      const exists = await dedupeExists(item, normalizedName);

      if (exists) {
        skipped++;
        logger.info(
          `⏭️ Skipped duplicate: ${rawName} (${item.contributionType}) - ${item.sourceUrl}`,
        );
        continue;
      }

      const doc = convertToSignalDoc(item, normalizedName);

      try {
        await SignalNew.create(doc);
        saved++;
        logger.info(`✓ Saved: ${rawName} (${item.contributionType})`);
      } catch (err: any) {
        errors++;
        logger.error("❌ Error saving document:", err?.message || err);
      }
    } catch (err: any) {
      errors++;
      logger.error("❌ Error processing item:", err?.message || err);
    }
  }

  return { saved, skipped, errors };
}

/* =======================================================================
   FULL PIPELINE
   ======================================================================= */
export async function runDAFPipeline(query?: string, limit = 25) {
  const q = query || DEFAULT_QUERY;

  try {
    logger.info(`🚀 Starting DAF pipeline for query: ${q}`);

    const items = await discoverAndScrapeDAFContributions(q, limit);

    logger.info(`📄 Extracted ${items.length} items — saving to DB...`);

    const saveResult = await saveDAFContributionsToDB(items);

    logger.info(
      `🎯 DAF pipeline complete — extracted: ${items.length}, saved: ${saveResult.saved}, skipped: ${saveResult.skipped}, errors: ${saveResult.errors}`,
    );

    return {
      success: true,
      totalExtracted: items.length,
      saved: saveResult.saved,
      skipped: saveResult.skipped,
      errors: saveResult.errors,
    };
  } catch (err: any) {
    logger.error("❌ Error in runDAFPipeline:", err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

export default {
  searchDAFPages,
  scrapeDAFPage,
  discoverAndScrapeDAFContributions,
  saveDAFContributionsToDB,
  runDAFPipeline,
};
