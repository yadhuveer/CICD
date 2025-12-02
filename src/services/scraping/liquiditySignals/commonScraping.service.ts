import axios, { AxiosRequestConfig } from "axios";
import { FeedEntry, ScrapingResult, Form13FData } from "../../../types/signal.types.js";
import logger from "../../../utils/logger.js";
import {
  getSchedule13Xml,
  getxmlGeneral,
  getxmlGeneral2,
  getxmls13F,
} from "../../../helpers/ParseToXML.js";
import * as cheerio from "cheerio";

import { scrape13FfileNameCIK } from "../../../helpers/get13fNameandCIK.js";

/**
 * -------------------------
 * Retry helper
 * -------------------------
 */

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  context?: string,
): Promise<T> {
  let lastError: any = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const statusCode = error.response?.status ?? error.status;
      if ([429, 500, 503].includes(statusCode)) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.warn(
          `${context ?? "Request"} failed (${statusCode}), retry ${
            attempt + 1
          }/${maxRetries} in ${waitTime}ms`,
        );
        await new Promise((r) => setTimeout(r, waitTime));
      } else {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Max retries exceeded");
}

/**
 * -------------------------
 * SEC request with retry/backoff
 * -------------------------
 */
export async function secRequest<T = any>(
  url: string,
  options: AxiosRequestConfig = {},
  context?: string,
): Promise<T> {
  const SEC_USER_AGENT = "Form4Scraper/1.0 (vipul@example.com)";
  return retryWithBackoff<T>(
    async () => {
      const response = await axios.get<T>(url, {
        ...options,
        headers: {
          "User-Agent": SEC_USER_AGENT,
          Accept: options.headers?.Accept ?? "application/xml,text/html;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: options.headers?.Referer ?? "https://www.sec.gov/",
          ...options.headers,
        },
        timeout: options.timeout ?? 20000,
      });
      return response.data;
    },
    3,
    context,
  );
}

//13dg
export async function scrapeLatest13DG(): Promise<ScrapingResult> {
  try {
    let xmlStringEntries: string[] = [];
    logger.info(`📡 Fetching Schedule 13D and 13G filings...`);

    // Use the correct URL format as shown in the screenshot
    // action=getcurrent with type=schedule+13g and owner=include
    const url13D =
      "https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=&type=schedule+13d&owner=include&count=40&action=getcurrent&output=atom";
    const url13G =
      "https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=&type=schedule+13g&owner=include&count=40&action=getcurrent&output=atom";

    logger.info(`Fetching Schedule 13D filings...`);

    const responseData13D = await secRequest(
      url13D,
      {
        headers: {
          Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      "Schedule 13D RSS feed",
    );

    logger.info(`Fetching Schedule 13G filings...`);

    const responseData13G = await secRequest(
      url13G,
      {
        headers: {
          Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      "Schedule 13G RSS feed",
    );

    // Parse the XML feeds
    const $13D = cheerio.load(responseData13D, { xmlMode: true });
    const $13G = cheerio.load(responseData13G, { xmlMode: true });

    const entries13D: FeedEntry[] = [];
    const entries13G: FeedEntry[] = [];
    const seenAccessions = new Set<string>();

    // Parse 13D entries
    $13D("entry").each((_i, elem) => {
      const title = $13D(elem).find("title").text();
      const category = $13D(elem).find("category").attr("term");
      const link = $13D(elem).find("link").attr("href") || "";
      const accessionMatch = link.match(/\/(\d{10}-\d{2}-\d{6})/);
      const accession = accessionMatch ? accessionMatch[1] : link;

      if (!seenAccessions.has(accession)) {
        seenAccessions.add(accession);
        entries13D.push({
          title,
          link,
          updated: $13D(elem).find("updated").text(),
          category: category || "SCHEDULE 13D",
          accession,
        });
      }
    });

    // Parse 13G entries
    $13G("entry").each((_i, elem) => {
      const title = $13G(elem).find("title").text();
      const category = $13G(elem).find("category").attr("term");
      const link = $13G(elem).find("link").attr("href") || "";
      const accessionMatch = link.match(/\/(\d{10}-\d{2}-\d{6})/);
      const accession = accessionMatch ? accessionMatch[1] : link;

      if (!seenAccessions.has(accession)) {
        seenAccessions.add(accession);
        entries13G.push({
          title,
          link,
          updated: $13G(elem).find("updated").text(),
          category: category || "SCHEDULE 13G",
          accession,
        });
      }
    });

    logger.info(
      `Found ${entries13D.length} Schedule 13D entries and ${entries13G.length} Schedule 13G entries`,
    );

    const allEntries = [...entries13D, ...entries13G];

    for (const ent of allEntries) {
      const res = await getSchedule13Xml(ent);
      if (res) {
        xmlStringEntries.push(res);
      }
    }

    return {
      scraped: allEntries.length,
      saved: 0,
      errors: 0,
      data: xmlStringEntries,
    };
  } catch (err: any) {
    console.error("Error fetching Schedule 13D/G data:", err);
    logger.error(`Schedule 13D/G fetch failed: ${err.message}`);
    return { scraped: 0, saved: 0, errors: 1, data: [] };
  }
}

export async function scrapeS3(): Promise<ScrapingResult> {
  try {
    let xmlStringEntries: string[] = [];

    logger.info(` Fetching Schedule S3 filings...`);

    // Use the correct URL format as shown in the screenshot

    // action=getcurrent with type=schedule+13g and owner=include

    const urls3 =
      "https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=&type=S-3&owner=include&count=5&action=getcurrent&output=atom";

    logger.info(`Fetching S3 filings...`);

    const responseDataS3 = await secRequest(
      urls3,

      {
        headers: {
          Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },

      "S-3 RSS feed",
    );

    logger.info(`Fetching Schedule S3 filings...`);

    // Parse the XML feeds

    const $S3 = cheerio.load(responseDataS3, { xmlMode: true });

    const entriesS3: FeedEntry[] = [];

    const seenAccessions = new Set<string>();

    // Parse S3 entries

    $S3("entry").each((_i, elem) => {
      const title = $S3(elem).find("title").text();

      const category = $S3(elem).find("category").attr("term");

      const link = $S3(elem).find("link").attr("href") || "";

      const accessionMatch = link.match(/\/(\d{10}-\d{2}-\d{6})/);

      const accession = accessionMatch ? accessionMatch[1] : link;

      if (!seenAccessions.has(accession)) {
        seenAccessions.add(accession);

        entriesS3.push({
          title,

          link,

          updated: $S3(elem).find("updated").text(),

          category: category || "SS3",

          accession,
        });
      }
    });

    logger.info(
      `Found ${entriesS3.length} Schedule S3 entries and ${entriesS3.length} Schedule S3 entries`,
    );

    const allEntries = [...entriesS3];

    for (const ent of allEntries) {
      const res = await getxmlGeneral(ent, "S-3");

      if (res) {
        xmlStringEntries.push(res);
      }
    }

    return {
      scraped: allEntries.length,

      saved: 0,

      errors: 0,

      data: xmlStringEntries,
    };
  } catch (err: any) {
    console.error("Error fetching S3:", err);

    logger.error(`S3 fetch failed: ${err.message}`);

    return { scraped: 0, saved: 0, errors: 1, data: [] };
  }
}

//D
export async function scrapeD(): Promise<ScrapingResult> {
  try {
    let xmlStringEntries: string[] = [];
    logger.info(` Fetching Schedule D filings...`);

    // Use the correct URL format as shown in the screenshot
    // action=getcurrent with type=schedule+13g and owner=include
    const urlD =
      "https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=&type=D&owner=exclude&count=40&action=getcurrent&output=atom";

    logger.info(`Fetching D filings...`);

    const responseDataD = await secRequest(
      urlD,
      {
        headers: {
          Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      "D RSS feed",
    );

    logger.info(`Fetching D  filings...`);

    // Parse the XML feeds
    const $d = cheerio.load(responseDataD, { xmlMode: true });

    const entriesd: FeedEntry[] = [];

    const seenAccessions = new Set<string>();

    // Parse SD entries
    $d("entry").each((_i, elem) => {
      const title = $d(elem).find("title").text();
      const category = $d(elem).find("category").attr("term");
      const link = $d(elem).find("link").attr("href") || "";
      const accessionMatch = link.match(/\/(\d{10}-\d{2}-\d{6})/);
      const accession = accessionMatch ? accessionMatch[1] : link;

      if (!seenAccessions.has(accession) && category == "D") {
        seenAccessions.add(accession);
        entriesd.push({
          title,
          link,
          updated: $d(elem).find("updated").text(),
          category: category || "d",
          accession,
        });
      }
    });

    logger.info(
      `Found ${entriesd.length} Schedule d entries and ${entriesd.length} Schedule d entries`,
    );

    const allEntries = [...entriesd];

    for (const ent of allEntries) {
      const res = await getxmlGeneral(ent, "d");
      if (res) {
        xmlStringEntries.push(res);
      }
    }

    return {
      scraped: allEntries.length,
      saved: 0,
      errors: 0,
      data: xmlStringEntries,
    };
  } catch (err: any) {
    console.error("Error fetching 8k:", err);
    logger.error(`8k fetch failed: ${err.message}`);
    return { scraped: 0, saved: 0, errors: 1, data: [] };
  }
}

export async function scrape8K(): Promise<ScrapingResult> {
  try {
    let xmlStringEntries: string[] = [];
    let entryMetadata: FeedEntry[] = []; // Store entry metadata alongside XML

    logger.info(` Fetching Schedule 8K filings...`);

    // Use the correct URL format as shown in the screenshot

    // action=getcurrent with type=schedule+13g and owner=include

    const url8k =
      "https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=&type=8-k&owner=include&count=5&action=getcurrent&output=atom";

    logger.info(`Fetching 8K filings...`);

    const responseData8k = await secRequest(
      url8k,

      {
        headers: {
          Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },

      "8-k RSS feed",
    );

    logger.info(`Fetching Schedule 8-k filings...`);

    // Parse the XML feeds

    const $8k = cheerio.load(responseData8k, { xmlMode: true });

    const entries8k: FeedEntry[] = [];

    const seenAccessions = new Set<string>();

    // Parse S3 entries

    $8k("entry").each((_i, elem) => {
      const title = $8k(elem).find("title").text();

      const category = $8k(elem).find("category").attr("term");

      const link = $8k(elem).find("link").attr("href") || "";

      const accessionMatch = link.match(/\/(\d{10}-\d{2}-\d{6})/);

      const accession = accessionMatch ? accessionMatch[1] : link;

      if (!seenAccessions.has(accession)) {
        seenAccessions.add(accession);

        entries8k.push({
          title,

          link,

          updated: $8k(elem).find("updated").text(),

          category: category || "8k",

          accession,
        });
      }
    });

    logger.info(
      `Found ${entries8k.length} Schedule 8k entries and ${entries8k.length} Schedule 8k entries`,
    );

    const allEntries = [...entries8k];

    for (const ent of allEntries) {
      const res = await getxmlGeneral2(ent, "8-k");

      if (res) {
        xmlStringEntries.push(res);
        entryMetadata.push(ent); // Store the entry metadata for this XML
      }
    }

    return {
      scraped: allEntries.length,

      saved: 0,

      errors: 0,

      data: xmlStringEntries,

      metadata: entryMetadata, // Include entry metadata in response
    };
  } catch (err: any) {
    console.error("Error fetching 8k:", err);

    logger.error(`8k fetch failed: ${err.message}`);

    return { scraped: 0, saved: 0, errors: 1, data: [] };
  }
}

export async function scrape13FNew(): Promise<ScrapingResult> {
  try {
    // Target companies with their CIK numbers
    const targetCompanies = [
      { name: "Wolf Hill Capital Management, LP", cik: "0001785988" },
      { name: "Soleus Capital Management, L.P.", cik: "0001802630" },
      { name: "Starboard Value LP", cik: "0001517137" },
      { name: "Corvex Management LP", cik: "0001535472" },
      { name: "PointState Capital LP", cik: "0001509842" },
      { name: "BNP Paribas Asset Management Holding S.A.", cik: "0001520354" },
    ];

    const general13F: { name: string; cik: string }[] = await scrape13FfileNameCIK();

    targetCompanies.push(...general13F);

    logger.info(`📡 Fetching 13F-HR filings for ${targetCompanies.length} companies...\n`);

    const filingData: Array<Form13FData & { company: string; cik: string }> = [];
    const companySummary: Array<{
      name: string;
      cik: string;
      filingsFound: number;
      filingsProcessed: number;
    }> = [];

    for (const company of targetCompanies) {
      let filingsFoundCount = 0;
      let filingsProcessedCount = 0;

      try {
        // Use SEC's submissions JSON endpoint
        const cikPadded = company.cik.padStart(10, "0");
        const submissionsUrl = `https://data.sec.gov/submissions/CIK${cikPadded}.json`;

        const submissionsData = await secRequest(
          submissionsUrl,
          {
            headers: {
              Accept: "application/json",
            },
          },
          `Submissions JSON for ${company.name}`,
        );

        // Parse JSON response
        const submissions =
          typeof submissionsData === "string" ? JSON.parse(submissionsData) : submissionsData;

        // Get recent filings
        const filings = submissions.filings?.recent;
        if (!filings) {
          logger.warn(`No filings data found for ${company.name}`);
          continue;
        }

        const entries: FeedEntry[] = [];
        let count = 0;

        // Find first 4 13F-HR filings
        for (let i = 0; i < filings.form.length && count < 4; i++) {
          const form = filings.form[i];
          const filingDate = filings.filingDate[i];
          const accessionNumber = filings.accessionNumber[i];

          if (form === "13F-HR") {
            // Build the filing URL
            const accessionNoHyphens = accessionNumber.replace(/-/g, "");
            const filingUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(company.cik)}/${accessionNoHyphens}/${accessionNumber}-index.htm`;

            entries.push({
              title: `${submissions.name} - 13F-HR`,
              link: filingUrl,
              updated: filingDate,
              category: "13F-HR",
              accession: accessionNumber,
            });

            count++;
          }
        }

        filingsFoundCount = entries.length;

        // Fetch XML data for each filing
        for (const entry of entries) {
          const res = await getxmls13F(entry, "13F-HR");

          if (res) {
            filingData.push({
              company: company.name,
              cik: company.cik,
              accession: res.accession,
              primaryXml: res.primaryXml,
              infoTableXml: res.infoTableXml,
            });
            filingsProcessedCount++;
          }
        }

        companySummary.push({
          name: company.name,
          cik: company.cik,
          filingsFound: filingsFoundCount,
          filingsProcessed: filingsProcessedCount,
        });
      } catch (err: any) {
        logger.error(`❌ ${company.name}: ${err.message}`);
        companySummary.push({
          name: company.name,
          cik: company.cik,
          filingsFound: 0,
          filingsProcessed: 0,
        });
      }
    }

    // Log summary for each company
    logger.info(`\n${"=".repeat(80)}`);
    logger.info(`📊 13F-HR SCRAPING SUMMARY`);
    logger.info(`${"=".repeat(80)}`);
    companySummary.forEach((summary) => {
      const status =
        summary.filingsProcessed > 0
          ? `✅ ${summary.filingsProcessed}/${summary.filingsFound} processed`
          : summary.filingsFound > 0
            ? `⚠️  0/${summary.filingsFound} processed`
            : "❌ No filings found";
      logger.info(`${summary.name} (CIK: ${summary.cik}): ${status}`);
    });
    logger.info(`${"=".repeat(80)}`);
    logger.info(`Total filings collected: ${filingData.length}`);

    return {
      scraped: filingData.length,
      saved: 0,
      errors: 0,
      data: filingData,
    };
  } catch (err: any) {
    console.error("Error fetching 13F-HR:", err);
    logger.error(`13F-HR fetch failed: ${err.message}`);
    return { scraped: 0, saved: 0, errors: 1, data: [] };
  }
}
