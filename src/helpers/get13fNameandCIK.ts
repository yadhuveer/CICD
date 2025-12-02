import logger from "../utils/logger.js";

import { FeedEntry } from "../types/signal.types.js";
import * as cheerio from "cheerio";
import { secRequest } from "../services/scraping/liquiditySignals/commonScraping.service.js";

export async function scrape13FfileNameCIK(): Promise<Array<{ name: string; cik: string }>> {
  try {
    logger.info(`Fetching 13F filings...`);

    const url13F =
      "https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=&type=13F-HR&owner=exclude&count=20&action=getcurrent&output=atom";

    const responseData13F = await secRequest(
      url13F,
      {
        headers: {
          Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      "13F RSS feed",
    );

    console.log("===== 13F Response (first 1000 chars) =====");
    console.log(responseData13F.substring(0, 1000));
    console.log("===== End 13F Response =====\n");

    // Parse the XML feeds
    const $13F = cheerio.load(responseData13F, { xmlMode: true });

    const results: Array<{ name: string; cik: string }> = [];
    const seenCIKs = new Set<string>();

    // Parse 13F entries
    $13F("entry").each((_i, elem) => {
      const title = $13F(elem).find("title").text();

      // Parse title format: "13F-HR - Compass Wealth Management LLC (0001965653) (Filer)"
      // Extract name and CIK using regex/
      const match = title.match(/13F-HR\s*-\s*(.+?)\s*\((\d+)\)\s*\(Filer\)/);

      if (match) {
        const name = match[1].trim();
        const cik = match[2];

        // Avoid duplicates based on CIK
        if (!seenCIKs.has(cik)) {
          seenCIKs.add(cik);
          results.push({ name, cik });
        }
      }
    });

    logger.info(`Found ${results.length} unique 13F filers`);

    // Log sample entries
    console.log("\n===== Sample 13F Filers =====");
    results.slice(0, 5).forEach((entry, idx) => {
      console.log(`\nEntry ${idx + 1}:`);
      console.log(`  Name: ${entry.name}`);
      console.log(`  CIK: ${entry.cik}`);
    });

    return results;
  } catch (err) {
    logger.error("Error scraping 13F filings:", err);
    return [];
  }
}
