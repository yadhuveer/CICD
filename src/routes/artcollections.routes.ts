// src/routes/artMarket.routes.ts
import express, { Request, Response } from "express";
import { getScrapingLinks } from "../services/scraping/nonLiquidity/artcollections.service.js";
import { extractArtCollectibleSignals } from "../tools/AiAgents/scraperAgents/nonLiquidity/ArtCollectionsAgent.js";
import axios from "axios";
import * as cheerio from "cheerio";

const router = express.Router();

/* ------------------------------------------------------------
 * CLOUDLFARE / HARD-SCRAPE BLOCKED DOMAINS
 * ------------------------------------------------------------ */
const BLOCKED_SCRAPE_DOMAINS = ["christies.com", "sothebys.com", "phillips.com", "bonhams.com"];

/* ------------------------------------------------------------
 * HELPER — SCRAPE PAGE USING AXIOS + CHEERIO (with timeout)
 * ------------------------------------------------------------ */
async function scrapePage(url: string) {
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
      timeout: 8000, // ⏱ Prevent hanging on Cloudflare sites
      validateStatus: () => true, // Prevent axios throwing for 403/503/redirect loops
    });

    if (!response || !response.data) {
      console.warn(`⚠️ No response body for ${url}`);
      return { title: "", cleanText: "" };
    }

    const $ = cheerio.load(response.data);

    $("script, style, noscript").remove();
    const cleanText = $("body").text().replace(/\s+/g, " ").trim();
    const title = $("title").first().text().trim();

    return { title, cleanText };
  } catch (err: any) {
    console.error(`❌ Axios scrape timeout or error for ${url}: ${err.message}`);
    return { title: "", cleanText: "" };
  }
}

/* ------------------------------------------------------------
 * MAIN ROUTE — Test endpoint
 * ------------------------------------------------------------ */
router.post("/test-art-market", async (_req: Request, res: Response) => {
  try {
    console.log("\n🎨 Starting Art/Collectibles scraper test...\n");

    const baseQuery = undefined;

    // STEP 1: Discover links
    const links = await getScrapingLinks(baseQuery);

    const topLinks = links.slice(0, 5);
    const finalResults: any[] = [];

    // STEP 2: Scrape & Extract
    for (const item of topLinks) {
      console.log(`\n🔎 Processing URL: ${item.url}`);

      // ⛔ Skip Cloudflare-protected, heavy JS, hard-to-scrape domains
      if (BLOCKED_SCRAPE_DOMAINS.some((domain) => item.url.includes(domain))) {
        console.log(`⏭ Skipping ${item.url} — Cloudflare/JS protected`);
        continue;
      }

      // Scrape with Axios (timed)
      const { cleanText } = await scrapePage(item.url);

      if (!cleanText || cleanText.length < 50) {
        console.log(`⚠️ Not enough text scraped from ${item.url}. Skipping.`);
        continue;
      }

      // GPT extraction
      const extracted = await extractArtCollectibleSignals(cleanText, item.url);

      finalResults.push({
        url: item.url,
        title: item.title,
        rawTextLength: cleanText.length,
        extracted,
      });
    }

    return res.json({
      success: true,
      testedUrls: topLinks.length,
      results: finalResults,
    });
  } catch (e: any) {
    console.error("❌ Error in /test-art-market:", e.message);
    return res.status(500).json({
      success: false,
      message: "Error testing art market scraper",
      error: e.message,
    });
  }
});

export default router;
