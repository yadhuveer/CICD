import FirecrawlApp from "@mendable/firecrawl-js";
import axios from "axios";
import * as cheerio from "cheerio";
import { BLOCKED_DOMAINS } from "../../../config/hiring.config.js";
import { parseLifeInsuranceFromText } from "../../../tools/AiAgents/scraperAgents/nonLiquidity/LifeInsurenceAgent.js";

/**
 * High-signal queries tuned for actual liquidity actions:
 */
const FIRECRAWL_QUERIES = [
  "life insurance policy surrendered case study",
  'life insurance surrender news "policyholder"',
  "life insurance policy loan taken said",
  '"borrowed against" "life insurance" real story',
];

export default class LifeInsuranceLiquidityService {
  firecrawl: any;

  constructor(apiKey: string) {
    this.firecrawl = new FirecrawlApp({ apiKey });
  }

  normalizeFirecrawl(res: any) {
    return res?.results || res?.web || res?.data?.results || res?.data?.web || res?.data || [];
  }

  async discoverUrls(totalLimit = 30, perQuery = 5, maxQueries?: number) {
    const urls = new Set<string>();
    const queries = maxQueries ? FIRECRAWL_QUERIES.slice(0, maxQueries) : FIRECRAWL_QUERIES;

    for (const q of queries) {
      if (urls.size >= totalLimit) break;

      try {
        const res = await this.firecrawl.search(q, { num_results: perQuery });
        const items = this.normalizeFirecrawl(res);
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          const url = item?.url;
          if (!url) continue;

          const domain = new URL(url).hostname;
          if (BLOCKED_DOMAINS.some((b) => domain.includes(b))) continue;

          urls.add(url);
          if (urls.size >= totalLimit) break;
        }
      } catch {
        // Silent fail (prod-safe)
        continue;
      }
    }

    return Array.from(urls);
  }

  async fetchPageText(url: string) {
    try {
      const { data: html } = await axios.get(url, {
        timeout: 15000,
        headers: { "User-Agent": "Mozilla/5.0" },
      });

      const $ = cheerio.load(html);
      $("script,style,noscript").remove();
      const text = $("body").text().replace(/\s+/g, " ").trim();
      const title = $("title").text() || null;

      return { text, title };
    } catch {
      return null;
    }
  }

  /**
   * Relaxed Model (Option A):
   * - No strict name check
   * - actionType optional
   * - Only basic sanity checks
   */
  async processUrl(url: string) {
    const page = await this.fetchPageText(url);
    if (!page) return null;

    // basic minimum for meaningful content
    if (!page.text || page.text.length < 300) return null;

    const parsed = await parseLifeInsuranceFromText({
      url,
      text: page.text,
      title: page.title,
    });

    if (!parsed) return null;

    return {
      filingLink: url,
      ...parsed,
    };
  }

  async runOnce(opts?: {
    totalLimit?: number;
    perQuery?: number;
    maxQueries?: number;
    concurrency?: number;
  }) {
    const { totalLimit = 30, perQuery = 5, maxQueries, concurrency = 3 } = opts || {};

    console.log("LifeInsurance: discovering URLs...");
    const urls = await this.discoverUrls(totalLimit, perQuery, maxQueries);
    console.log(`LifeInsurance: discovered ${urls.length} urls; processing...`);

    const queue = [...urls];
    const results: any[] = [];

    const workers = Array.from({ length: concurrency }).map(async () => {
      while (queue.length) {
        const url = queue.shift();
        if (!url) break;

        try {
          const r = await this.processUrl(url);
          if (r) results.push(r);
        } catch {
          continue;
        }
      }
    });

    await Promise.all(workers);

    console.log(`LifeInsurance: completed; extracted ${results.length} signals.`);
    return results;
  }
}
