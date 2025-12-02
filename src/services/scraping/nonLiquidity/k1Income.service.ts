import FirecrawlApp from "@mendable/firecrawl-js";
import axios from "axios";
import * as cheerio from "cheerio";
import { extractK1IncomeSignals } from "../../../tools/AiAgents/scraperAgents/nonLiquidity/K1IncomeAgent.js";
import { SignalNew } from "../../../models/newSignal.model.js";

/* ------------------------------------------------------------
 * TYPES
 * ------------------------------------------------------------ */
export interface K1ScrapeCandidate {
  url: string;
  title?: string;
  description?: string;
}

/* ---------------------------
 * Firecrawl client singleton
 * --------------------------- */
let firecrawlClient: FirecrawlApp | null = null;
function getClient() {
  if (!firecrawlClient) {
    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) throw new Error("FIRECRAWL_API_KEY missing");
    firecrawlClient = new FirecrawlApp({ apiKey: key });
  }
  return firecrawlClient;
}

/* ---------------------------
 * Filters / keywords
 * --------------------------- */
const GOOD_PATTERNS = [
  "partner",
  "partners",
  "equity-partner",
  "managing-partner",
  "senior-partner",
  "promotion",
  "promoted",
  "leadership",
  "team",
  "our-team",
];

const BAD_PATTERNS = ["apple.news", "/story/", "/video/", "execed", "program", "training"];

const K1_KEYWORDS = [
  "equity partner",
  "managing partner",
  "senior partner",
  "general partner",
  "promoted to partner",
];

const BLOCKED_DOMAINS = ["facebook.com", "instagram.com", "reddit.com", "twitter.com"];

/* ---------------------------
 * Helpers
 * --------------------------- */
function normalizeDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isBlocked(url: string) {
  const domain = normalizeDomain(url);
  return BLOCKED_DOMAINS.some((d) => domain.includes(d));
}

function isLikelyK1Item(item: K1ScrapeCandidate) {
  const combined = `${item.url} ${item.title || ""} ${item.description || ""}`.toLowerCase();
  if (BAD_PATTERNS.some((b) => combined.includes(b))) return false;
  if (!GOOD_PATTERNS.some((g) => combined.includes(g))) return false;
  if (!K1_KEYWORDS.some((k) => combined.includes(k))) return false;
  return true;
}

/* ---------------------------
 * Scrape page (axios+cheerio)
 * --------------------------- */
export async function scrapePage(url: string) {
  try {
    const response = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000,
      validateStatus: () => true,
    });

    const $ = cheerio.load(response.data || "");
    $("script, style, noscript").remove();

    return {
      title: $("title").first().text().trim(),
      cleanText: $("body").text().replace(/\s+/g, " ").trim(),
    };
  } catch (err: any) {
    console.warn("scrapePage error:", err?.message ?? err);
    return { title: "", cleanText: "" };
  }
}

/* ---------------------------
 * Firecrawl search helper
 * --------------------------- */
async function searchQuery(query: string, limit = 5) {
  console.log("🔎 Searching:", query);
  const client = getClient();
  try {
    const res: any = await client.search(query, { limit });
    const w = res?.web || res?.data?.web || res?.data || [];
    if (!Array.isArray(w)) return [];
    return w
      .map((r: any) => ({
        url: r.url || r.link || "",
        title: r.title || "",
        description: r.description || r.snippet || "",
      }))
      .filter((r: K1ScrapeCandidate) => r.url);
  } catch (err: any) {
    console.warn("⚠️ searchQuery failed:", err?.message ?? err);
    return [];
  }
}

/* ---------------------------
 * runK1IncomePipeline
 * --------------------------- */
export async function runK1IncomePipeline(baseQuery?: string) {
  console.log("\n Running K-1 Income Pipeline...");

  const queries = baseQuery
    ? [
        `${baseQuery} equity partner`,
        `${baseQuery} senior partner`,
        `${baseQuery} managing partner`,
      ]
    : [
        "top law firm equity partner promoted 2025",
        "managing partner private equity appointment",
        "partner biography profile",
        "promoted to partner press release",
      ];

  // DISCOVER
  const collected: K1ScrapeCandidate[] = [];
  for (const q of queries) {
    const found = await searchQuery(q, 5);
    collected.push(...found);
    await new Promise((r) => setTimeout(r, 200)); // throttle
  }

  // Dedupe urls
  const seen = new Set<string>();
  let candidates = collected.filter((c) => {
    if (!c.url) return false;
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  // block & medium-filter
  candidates = candidates.filter((c) => !isBlocked(c.url));
  candidates = candidates.filter(isLikelyK1Item);

  console.log(`Candidates after filtering: ${candidates.length}`);

  // SCRAPE + EXTRACT + SAVE
  const finalResults: any[] = [];
  const savedSignals: string[] = [];
  const skippedExisting: string[] = [];

  for (const item of candidates.slice(0, 10)) {
    console.log("Processing:", item.url);
    const { title, cleanText } = await scrapePage(item.url);

    if (!cleanText || cleanText.length < 120) {
      finalResults.push({
        url: item.url,
        title,
        rawTextLength: cleanText.length,
        extracted: [],
        note: "insufficient-text",
      });
      continue;
    }

    // run the agent (returns uniq signals already)
    const extracted = await extractK1IncomeSignals(cleanText, item.url);

    // iterate over extracted person signals and save each as a Person signal
    const savedForPage: any[] = [];
    for (const s of extracted) {
      // ensure personName exists (agent-level schema enforces that)
      const fullName = (s.personName || "").trim();
      if (!fullName) continue;

      // avoid duplicates by filingLink + fullName + filingType
      const exists = await SignalNew.findOne({
        filingLink: item.url,
        fullName,
        filingType: "k1-income",
      }).lean();

      if (exists) {
        skippedExisting.push(`${fullName} @ ${item.url}`);
        continue;
      }

      // Build the document
      const doc = {
        signalSource: "Person",
        signalType: "k1-income",
        filingType: "k1-income",

        filingLink: item.url,
        fullName: s.personName,
        designation: s.roleTitle,
        companyName: s.organizationName,

        insights: s.insights || "",
        aiModelUsed: "gpt-4o-mini",

        k1IncomeData: {
          contacts: {
            emails: Array.isArray(s.contacts?.emails) ? s.contacts.emails : [],
            phones: Array.isArray(s.contacts?.phones) ? s.contacts.phones : [],
          },

          partnerType: s.partnerType || "unknown",
          modeledK1Income: s.modeledK1Income || "300k-750k",
          industry: s.industry || "other",
          confidenceScore: typeof s.confidenceScore === "number" ? s.confidenceScore : 0,
        },
      };

      try {
        const created = await SignalNew.create(doc);
        savedSignals.push(String(created._id));
        savedForPage.push(created._id);
      } catch (err: any) {
        console.error("Failed to save SignalNew:", err?.message ?? err);
      }
    }

    finalResults.push({
      url: item.url,
      title,
      rawTextLength: cleanText.length,
      extracted,
      savedCount: savedForPage.length,
    });

    // short throttle between pages
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    success: true,
    count: finalResults.length,
    savedSignals: savedSignals.length,
    skippedExisting: skippedExisting.length,
    results: finalResults,
  };
}
