import { Signal } from "../../../models/Signals.model.js";
import {
  extractEntitiesFromForm10K,
  mapEntitiesToSignals,
} from "../../../tools/AiAgents/scraperAgents/liquidity/Form10KParserAgent.js";
import { Form10KData, FeedEntry } from "../../../types/signal.types.js";
//import { secRequest } from "./form4Scraping.service.js";
import * as cheerio from "cheerio";
import { secRequest } from "./commonScraping.service.js";

/**
 * Scrape Form 10-K from URL and directly convert to Signal(s)
 * without saving to Form10K database
 * @param url - Direct URL to Form 10-K filing or index page
 * @returns Object with success status and signal IDs created
 */
export const scrapeForm10KToSignal = async (
  url: string,
): Promise<{ success: boolean; signalIds: string[]; error?: string }> => {
  try {
    console.log(`\n🔄 Scraping Form 10-K from URL and converting to Signal(s)`);
    console.log(`   URL: ${url}`);

    // Extract accession number from URL
    const accessionMatch = url.match(/\/(\d{10}-\d{2}-\d{6})/);
    const accession = accessionMatch ? accessionMatch[1] : "";

    if (!accession) {
      return {
        success: false,
        signalIds: [],
        error: "Could not extract accession number from URL",
      };
    }

    // Check if already processed (check if Signal exists with this accession)
    const existingSignals = await Signal.find({ accession, signalType: "10-k" }).lean();
    if (existingSignals.length > 0) {
      console.log(`ℹ️  Signal(s) already exist for this accession: ${accession}`);
      console.log(`   Found ${existingSignals.length} existing signal(s)`);
      return {
        success: true,
        signalIds: existingSignals.map((s) => s._id.toString()),
      };
    }

    // Determine if this is an index URL or direct document URL
    let documentUrl: string = "";
    let documentContent: string | null = null;

    if (url.includes("-index.htm")) {
      // This is an index page, need to find the actual 10-K document
      console.log(`📄 Detected index page, fetching to find 10-K document...`);

      const indexData = await secRequest<string>(
        url,
        {
          headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        },
        `10-K index: ${accession}`,
      );

      const $index = cheerio.load(indexData);
      const documentLinks: string[] = [];

      // Find all .htm/.html links in the /Archives/edgar/data/ path (actual SEC filings)
      $index("a").each((_idx, elem) => {
        const href = $index(elem).attr("href") || "";

        // Only process links that point to actual SEC filing documents
        // Must be in /Archives/edgar/data/ path OR wrapped in iXBRL viewer (/ix?doc=)
        if (
          (href.endsWith(".htm") || href.endsWith(".html")) &&
          (href.includes("/Archives/edgar/data/") ||
            href.includes("/ix?doc=/Archives/edgar/data/")) &&
          !href.includes("-index.htm") &&
          !href.includes("-index.html") &&
          !href.includes("/R1.htm") &&
          !href.includes("/R2.htm") &&
          !href.includes("/R3.htm") &&
          !href.includes("/R4.htm") &&
          !href.includes("xslF345X")
        ) {
          // Handle iXBRL wrapper: /ix?doc=/Archives/... -> extract the document path
          let documentPath = href;
          if (href.includes("/ix?doc=")) {
            const match = href.match(/\/ix\?doc=(.+)/);
            if (match) {
              documentPath = match[1]; // Extract the actual document path
            }
          }

          const absolute = documentPath.startsWith("http")
            ? documentPath
            : `https://www.sec.gov${documentPath}`;
          console.log(`   ✅ Adding document link: ${absolute}`);
          documentLinks.push(absolute);
        }
      });

      console.log(`   📋 Found ${documentLinks.length} potential HTML document(s)`);

      // Try to fetch document content
      for (const docUrl of documentLinks) {
        try {
          console.log(`   🔗 Attempting to fetch: ${docUrl}`);
          const docData = await secRequest<string>(
            docUrl,
            {
              headers: {
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                Referer: url,
              },
            },
            `10-K document: ${accession}`,
          );

          // Validate this is a 10-K document (check for annual report indicators)
          if (
            docData &&
            docData.length > 1000 &&
            (docData.toLowerCase().includes("annual report") ||
              docData.toLowerCase().includes("form 10-k") ||
              docData.toLowerCase().includes("item 1.") ||
              docData.toLowerCase().includes("item 10") ||
              docData.toLowerCase().includes("executive officers") ||
              docData.toLowerCase().includes("directors and executive officers"))
          ) {
            documentContent = docData;
            documentUrl = docUrl;
            console.log(`   ✅ Fetched ${docData.length} characters from: ${docUrl}`);
            // Show a sample of the content
            const sample = docData.substring(0, 200).replace(/\s+/g, " ");
            console.log(`   📄 Content preview: ${sample}...`);
            break;
          } else if (docData && docData.length > 100) {
            console.log(
              `   ⚠️  Document fetched but doesn't appear to be a 10-K (${docData.length} chars), trying next...`,
            );
          }
        } catch (err) {
          console.warn(`   ⚠️  Failed to fetch ${docUrl}, trying next...`);
          continue;
        }
      }

      // Fallback to .txt file if HTML not found
      if (!documentContent) {
        console.log(`📄 Trying .txt fallback...`);
        const txtUrl = url.replace("-index.htm", ".txt");
        try {
          const txtData = await secRequest<string>(txtUrl, {}, `10-K .txt: ${accession}`);
          if (txtData && txtData.length > 1000) {
            documentContent = txtData;
            documentUrl = txtUrl;
            console.log(`   ✅ Fetched ${txtData.length} characters from .txt file`);
          }
        } catch (err) {
          console.warn(`   ⚠️  Failed to fetch .txt file`);
        }
      }

      if (!documentContent) {
        return {
          success: false,
          signalIds: [],
          error: "Could not find valid 10-K document in index",
        };
      }
    } else {
      // Direct document URL
      documentUrl = url;
      console.log(`📥 Fetching 10-K document...`);
      documentContent = await secRequest<string>(url, {}, `10-K document: ${accession}`);
    }

    if (!documentContent) {
      return {
        success: false,
        signalIds: [],
        error: "Failed to fetch 10-K content",
      };
    }

    console.log(`✅ Document fetched successfully (${documentContent.length} characters)`);

    // Extract company information from document
    const companyNameMatch = documentContent.match(
      /COMPANY CONFORMED NAME:\s*([^\n]+)|<company-name>([^<]+)/i,
    );
    const tickerMatch = documentContent.match(/TRADING SYMBOL:\s*([^\n]+)|ticker[:\s]*([^\s\n]+)/i);
    const cikMatch = documentContent.match(/CENTRAL INDEX KEY:\s*(\d+)|CIK[:\s]*(\d+)/i);
    const fiscalYearMatch = documentContent.match(
      /FISCAL YEAR END:\s*(\d{4})|fiscal year end[:\s]*([^\n]+)/i,
    );

    const companyName = companyNameMatch ? (companyNameMatch[1] || companyNameMatch[2]).trim() : "";
    const companyTicker = tickerMatch ? (tickerMatch[1] || tickerMatch[2]).trim() : "";
    const companyCik = cikMatch ? (cikMatch[1] || cikMatch[2]).trim() : "";
    const fiscalYearEnd = fiscalYearMatch ? (fiscalYearMatch[1] || fiscalYearMatch[2]).trim() : "";

    console.log(
      `📊 Company: ${companyName} (${companyTicker || "No ticker"}) - CIK: ${companyCik}`,
    );

    // Extract entities from 10-K using AI agent
    console.log(`🤖 Extracting entities from Form 10-K...`);
    const entities = await extractEntitiesFromForm10K(documentContent);

    if (!entities || entities.length === 0) {
      console.warn(`⚠️  No entities extracted from 10-K: ${accession}`);
      return {
        success: true,
        signalIds: [],
      };
    }

    console.log(`✅ Extracted ${entities.length} entity/entities`);

    // Create a Form10K object for mapping
    const form10kData: Form10KData = {
      accession,
      filingLink: documentUrl,
      rawContent: documentContent,
      companyName: companyName || entities[0]?.companyName || "",
      companyTicker: companyTicker,
      companyCik: companyCik,
      filingDate: new Date(),
      fiscalYearEnd: fiscalYearEnd,
    };

    // Map entities to signals
    const signals = mapEntitiesToSignals(entities, form10kData);

    // Save signals to database
    const signalIds: string[] = [];
    for (const signalData of signals) {
      try {
        // Check if signal already exists for this entity
        const existingSignal = await Signal.findOne({
          accession: accession,
          fullName: signalData.fullName,
          signalType: "10-k",
        });

        if (existingSignal) {
          console.log(`ℹ️  Signal already exists for ${signalData.fullName}`);
          signalIds.push(existingSignal._id.toString());
          continue;
        }

        const savedSignal = await Signal.create(signalData);
        signalIds.push(savedSignal._id.toString());
        console.log(`✅ Signal created: ${savedSignal.fullName} (${savedSignal._id})`);
      } catch (err: any) {
        if (err.code === 11000) {
          console.log(`ℹ️  Duplicate signal for ${signalData.fullName}, skipping...`);
        } else {
          console.error(`❌ Error creating signal for ${signalData.fullName}:`, err.message);
        }
      }
    }

    console.log(`\n✅ Scrape-to-Signal complete. Created ${signalIds.length} signal(s)`);
    return {
      success: true,
      signalIds,
    };
  } catch (error: any) {
    console.error(`❌ Failed to scrape 10-K to Signal:`, error.message);
    return {
      success: false,
      signalIds: [],
      error: error.message,
    };
  }
};

/**
 * Scrape latest Form 10-K filings from SEC RSS feed
 * @param limit - Maximum number of filings to process (default: 20, max: 40)
 * @returns Statistics about scraping results
 */
export const scrapeLatest10KsToSignals = async (
  limit: number = 20,
): Promise<{
  total: number;
  successful: number;
  alreadyExists: number;
  failed: number;
  signalIds: string[];
}> => {
  try {
    console.log(`\n📡 Fetching latest 10-K filings from SEC RSS feed (limit: ${limit})`);

    // Fetch RSS feed
    const rssUrl =
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&CIK=&type=10-K&company=&dateb=&owner=include&start=0&count=100&output=atom";
    const rssData = await secRequest<string>(rssUrl, {}, "10-K RSS feed");

    // Parse RSS feed
    const $ = cheerio.load(rssData, { xmlMode: true });
    const entries: FeedEntry[] = [];

    $("entry").each((idx, elem) => {
      if (entries.length >= limit) return false;

      const title = $(elem).find("title").text().trim();
      const link = $(elem).find("link").attr("href") || "";
      const updated = $(elem).find("updated").text().trim();
      const category = $(elem).find("category").attr("term") || "";

      // Only process 10-K filings
      if (category === "10-K" && link) {
        const accessionMatch = link.match(/\/(\d{10}-\d{2}-\d{6})/);
        const accession = accessionMatch ? accessionMatch[1] : "";

        if (accession) {
          entries.push({
            title,
            link,
            updated,
            category,
            accession,
          });
        }
      }
    });

    console.log(`📋 Found ${entries.length} 10-K filings to process`);

    let successful = 0;
    let alreadyExists = 0;
    let failed = 0;
    const allSignalIds: string[] = [];

    for (const entry of entries) {
      console.log(`\n📄 Processing: ${entry.title} (${entry.accession})`);

      const result = await scrapeForm10KToSignal(entry.link);

      if (result.success) {
        if (result.signalIds.length > 0) {
          // Check if these are newly created or existing
          const existingCount = await Signal.countDocuments({
            _id: { $in: result.signalIds },
            createdAt: { $lt: new Date(Date.now() - 1000) }, // Created more than 1 second ago
          });

          if (existingCount === result.signalIds.length) {
            alreadyExists++;
          } else {
            successful++;
          }

          allSignalIds.push(...result.signalIds);
        } else {
          successful++;
        }
      } else {
        failed++;
        console.error(`❌ Failed: ${result.error}`);
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    console.log(`\n✅ Scraping completed!`);
    console.log(`   Total processed: ${entries.length}`);
    console.log(`   Successful: ${successful}`);
    console.log(`   Already exists: ${alreadyExists}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Total signals: ${allSignalIds.length}`);

    return {
      total: entries.length,
      successful,
      alreadyExists,
      failed,
      signalIds: allSignalIds,
    };
  } catch (error: any) {
    console.error(`❌ Failed to scrape latest 10-Ks:`, error.message);
    throw error;
  }
};

/**
 * Scrape historical Form 10-K filings from SEC for a date range
 * @param fromDate - Start date (YYYY-MM-DD)
 * @param toDate - End date (YYYY-MM-DD)
 * @param maxResults - Maximum number of results to fetch (default: 100, max: 100)
 * @returns Statistics about scraping results
 */
export const scrapeHistorical10KsToSignals = async (
  fromDate: string,
  toDate: string,
  maxResults: number = 100,
): Promise<{
  success: boolean;
  total: number;
  successful: number;
  alreadyExists: number;
  failed: number;
  signalIds: string[];
  error?: string;
}> => {
  try {
    console.log(`\n📅 Fetching historical 10-K filings from ${fromDate} to ${toDate}`);
    console.log(`   Max results: ${maxResults}`);

    // Use SEC EFTS search API for historical data
    const searchUrl = `https://efts.sec.gov/LATEST/search-index?dateRange=custom&category=form-cat1&forms=10-K&startdt=${fromDate}&enddt=${toDate}&page=1&from=0&size=${maxResults}`;

    console.log(`🔍 Searching SEC EFTS API...`);
    const searchData = await secRequest<any>(
      searchUrl,
      {
        headers: {
          Accept: "application/json",
        },
      },
      "10-K historical search",
    );

    if (!searchData || !searchData.hits || !searchData.hits.hits) {
      return {
        success: false,
        total: 0,
        successful: 0,
        alreadyExists: 0,
        failed: 0,
        signalIds: [],
        error: "No results found in date range",
      };
    }

    const hits = searchData.hits.hits;
    console.log(`📋 Found ${hits.length} 10-K filings in date range`);

    const entries: FeedEntry[] = hits.map((hit: any) => {
      const source = hit._source;
      const accession = source.adsh?.replace(/-/g, "").match(/(\d{10})(\d{2})(\d{6})/)
        ? `${source.adsh.replace(/-/g, "").match(/(\d{10})(\d{2})(\d{6})/)[1]}-${source.adsh.replace(/-/g, "").match(/(\d{10})(\d{2})(\d{6})/)[2]}-${source.adsh.replace(/-/g, "").match(/(\d{10})(\d{2})(\d{6})/)[3]}`
        : source.adsh;

      const cik = source.ciks?.[0]?.toString().padStart(10, "0") || "";
      const link = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&dateb=&owner=exclude&count=100&search_text=`;

      return {
        title: `${source.display_names?.[0] || "Unknown"} - 10-K`,
        link: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&dateb=${source.file_date}&owner=exclude&count=1`,
        updated: source.file_date || source.period_ending,
        category: "10-K",
        accession: accession,
      };
    });

    let successful = 0;
    let alreadyExists = 0;
    let failed = 0;
    const allSignalIds: string[] = [];

    for (const entry of entries) {
      console.log(`\n📄 Processing: ${entry.title} (${entry.accession})`);

      // Construct the actual filing URL
      const cikMatch = entry.link.match(/CIK=(\d+)/);
      const cik = cikMatch ? cikMatch[1] : "";
      const accessionForUrl = entry.accession.replace(/-/g, "");
      const filingUrl = `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${cik}&accession_number=${entry.accession}&xbrl_type=v`;

      // Try to get the index page URL
      const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionForUrl}/${entry.accession}-index.htm`;

      const result = await scrapeForm10KToSignal(indexUrl);

      if (result.success) {
        if (result.signalIds.length > 0) {
          const existingCount = await Signal.countDocuments({
            _id: { $in: result.signalIds },
            createdAt: { $lt: new Date(Date.now() - 1000) },
          });

          if (existingCount === result.signalIds.length) {
            alreadyExists++;
          } else {
            successful++;
          }

          allSignalIds.push(...result.signalIds);
        } else {
          successful++;
        }
      } else {
        failed++;
        console.error(`❌ Failed: ${result.error}`);
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    console.log(`\n✅ Historical scraping completed!`);
    console.log(`   Total processed: ${entries.length}`);
    console.log(`   Successful: ${successful}`);
    console.log(`   Already exists: ${alreadyExists}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Total signals: ${allSignalIds.length}`);

    return {
      success: true,
      total: entries.length,
      successful,
      alreadyExists,
      failed,
      signalIds: allSignalIds,
    };
  } catch (error: any) {
    console.error(`❌ Failed to scrape historical 10-Ks:`, error.message);
    return {
      success: false,
      total: 0,
      successful: 0,
      alreadyExists: 0,
      failed: 0,
      signalIds: [],
      error: error.message,
    };
  }
};

/**
 * Get enrichment statistics for 10-K signals
 * @returns Statistics about 10-K signal enrichment status
 */
export const get10KSignalEnrichmentStats = async () => {
  const total = await Signal.countDocuments({ signalType: "10-k" });
  const pending = await Signal.countDocuments({
    signalType: "10-k",
    contactEnrichmentStatus: "pending",
  });
  const processing = await Signal.countDocuments({
    signalType: "10-k",
    contactEnrichmentStatus: "processing",
  });
  const completed = await Signal.countDocuments({
    signalType: "10-k",
    contactEnrichmentStatus: "completed",
  });
  const failed = await Signal.countDocuments({
    signalType: "10-k",
    contactEnrichmentStatus: "failed",
  });

  return {
    total,
    pending,
    processing,
    completed,
    failed,
    completionRate: total > 0 ? ((completed / total) * 100).toFixed(2) + "%" : "0%",
  };
};
