import axios from "axios";
import * as cheerio from "cheerio";
import FirecrawlApp from "@mendable/firecrawl-js";
import logger from "../../../utils/logger.js";

import {
  extractNextGenSignals,
  NextGenLeadershipItem,
} from "../../../tools/AiAgents/scraperAgents/nonLiquidity/NextGenLead.Agent.js";

import { SignalNew } from "../../../models/newSignal.model.js";
import { BLOCKED_DOMAINS, SCRAPING_LIMITS } from "../../../config/hiring.config.js";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}/g;

function isBlocked(url: string) {
  return BLOCKED_DOMAINS.some((d) => url.includes(d));
}

function getFirecrawl() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY required");
  return new FirecrawlApp({ apiKey });
}

function extractPageData(html: string, baseUrl: string) {
  const $ = cheerio.load(html);

  // strip noisy elements
  $("script, style, svg, path, iframe, noscript, canvas, video, audio").remove();
  $("header, footer, nav").remove();
  $('[class*="cookie"], [id*="cookie"]').remove();
  $('[class*="banner"], [id*="banner"]').remove();
  $('[class*="advert"], [id*="advert"]').remove();
  $('[class*="promo"], [id*="promo"]').remove();

  const blocks: string[] = [];

  const title = $("title").first().text().trim() || null;
  const metaDesc =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    null;

  $("h1,h2,h3,h4").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 3) blocks.push(t);
  });

  $("p").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 20) blocks.push(t);
  });

  $("li").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 5) blocks.push("• " + t);
  });

  $("a").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 5 && t.length < 200) blocks.push(t);
  });

  const emails = Array.from(new Set((html.match(EMAIL_RE) || []).map((e) => e.toLowerCase())));

  const canonical = $('link[rel="canonical"]').attr("href") || baseUrl;

  const cleanText = blocks.join("\n\n").replace(/\s+/g, " ").trim();

  return {
    text: cleanText.slice(0, SCRAPING_LIMITS.MARKDOWN_MAX_LENGTH),
    emails,
    title,
    metaDescription: metaDesc,
    website: canonical,
  };
}

/* ---------------------------------------------------
  perQueryLimit default 5
--------------------------------------------------- */
export async function searchNextGenUrls(perQueryLimit = 5): Promise<string[]> {
  const firecrawl = getFirecrawl();

  const QUERIES = [
    `"family office" "new CEO"`,
    `"family office" "named" "CEO"`,
    `"family office" "appoints"`,
    `"family office" "promoted to"`,
    `"family office" "joins as"`,
  ];

  const collected = new Set<string>();

  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i];
    logger.info(`Firecrawl searching (${i + 1}/${QUERIES.length}): ${q}`);

    try {
      const resp: any = await firecrawl.search(q, { limit: perQueryLimit });
      const web = resp?.web ?? resp?.results ?? [];

      for (const item of web) {
        const url = (item?.url || item?.link || "").toString();
        if (!url) continue;

        const low = url.toLowerCase();
        if (low.endsWith(".pdf")) continue;
        if (isBlocked(low)) continue;

        collected.add(url);
      }
    } catch (err: any) {
      logger.warn(`Firecrawl query failed (${q}): ${err?.message}`);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  const urls = Array.from(collected);
  logger.info(`Search complete → collected ${urls.length} urls (per-query limit ${perQueryLimit})`);
  return urls;
}

async function upsertNextGenSignalsToDB(items: NextGenLeadershipItem[], modelUsed = "gpt-4o-mini") {
  const created: { personId?: string; companyId?: string; item?: NextGenLeadershipItem }[] = [];

  for (const it of items) {
    try {
      // normalize required fields
      const personName = (it.personName || "").trim();
      const orgName = (it.organizationName || "").trim();
      const roleNew = (it.roleNew || "unknown").trim();
      const eventType = it.eventType || "unknown";

      const nextGenData = {
        eventType,
        roleNew,
        roleOld: it.roleOld || null,
        evidence: it.evidence || null,
        insights: it.insights || null,
        sourceUrl: it.sourceUrl,
        confidenceScore: it.confidenceScore ?? null,
        tags: it.tags ?? [],
      };

      const personFilter = {
        signalSource: "Person",
        fullName: personName,
        companyName: orgName,
        filingType: "nextgen-leadership",
        "nextGenData.eventType": eventType,
        "nextGenData.roleNew": roleNew,
      };

      const personDoc = {
        signalSource: "Person",
        signalType: "nextgen-leadership",
        filingType: "nextgen-leadership",
        filingLink: it.sourceUrl,
        insights: it.insights ?? "",
        aiModelUsed: modelUsed,
        fullName: personName,
        companyName: orgName,
        designation: roleNew,
        processingStatus: "Processed",
        nextGenData,
        ...(it.emails && it.emails.length ? { email: it.emails[0] } : {}),
      };

      const personRes = await SignalNew.findOneAndUpdate(
        personFilter,
        { $set: personDoc, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      const companyFilter = {
        signalSource: "Company",
        companyName: orgName,
        filingType: "nextgen-leadership",
        "nextGenData.eventType": eventType,
        "nextGenData.roleNew": roleNew,
      };

      const companyDoc = {
        signalSource: "Company",
        signalType: "nextgen-leadership",
        filingType: "nextgen-leadership",
        filingLink: it.sourceUrl,
        insights: it.insights ?? "",
        aiModelUsed: modelUsed,
        companyName: orgName,
        fullName: personName,
        companyNameVariants: [],
        processingStatus: "Processed",
        nextGenData,
        ...(it.emails && it.emails.length ? { companyAddress: null } : {}),
      };

      const companyRes = await SignalNew.findOneAndUpdate(
        companyFilter,
        { $set: companyDoc, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      created.push({
        personId: personRes?._id?.toString?.(),
        companyId: companyRes?._id?.toString?.(),
        item: it,
      });
    } catch (err: any) {
      logger.error(`DB upsert failed for item ${it.sourceUrl}: ${err?.message}`);
    }
  }

  return created;
}

export async function scrapeNextGenLeadership(): Promise<any> {
  logger.info("Starting Next-Gen Leadership scrape (Firecrawl → axios → GPT → DB)");

  const urls = await searchNextGenUrls(5);

  if (!urls || urls.length === 0) {
    logger.info("No urls returned from Firecrawl.");
    return { success: true, created: [], message: "no urls" };
  }

  const allItems: NextGenLeadershipItem[] = [];

  for (const url of urls) {
    try {
      logger.info(`Scraping: ${url}`);

      const resp = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; longwall-bot/1.0)" },
        responseType: "text",
      });

      const html = resp.data || "";

      if (typeof html !== "string" || /<\?xml|%PDF-/.test(html.slice(0, 200))) {
        logger.info(`Skipping non-HTML or PDF: ${url}`);
        continue;
      }

      const page = extractPageData(html, url);

      // Build agent input (title/meta + emails + text)
      const agentInput = [
        `TITLE: ${page.title || "N/A"}`,
        `META: ${page.metaDescription || "N/A"}`,
        `EXTRACTED EMAILS: ${page.emails.length ? page.emails.join(", ") : "none"}`,
        "",
        "PAGE TEXT:",
        page.text,
      ]
        .filter(Boolean)
        .join("\n\n");

      // call agent
      const items = await extractNextGenSignals(agentInput, url);

      // attach page-level emails if agent didn't provide any
      for (const it of items) {
        it.sourceUrl = it.sourceUrl || url;
        if ((!it.emails || it.emails.length === 0) && page.emails.length > 0) {
          it.emails = page.emails;
        }
        allItems.push(it);
      }

      logger.info(`✔ Agent returned ${items.length} items from ${url}`);
    } catch (err: any) {
      logger.error(`Error scraping ${url}: ${err?.message}`);
    }
  }

  if (allItems.length === 0) {
    logger.info("Completed scrape: 0 total signals");
    return { success: true, created: [], message: "no signals found" };
  }

  // persist to DB
  const created = await upsertNextGenSignalsToDB(allItems, "gpt-4o-mini");

  logger.info(`Completed scrape: ${created.length} items upserted (person+company each)`);

  return {
    success: true,
    createdCount: created.length,
    created,
  };
}
