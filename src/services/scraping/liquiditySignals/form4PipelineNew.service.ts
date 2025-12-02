import { SignalNew } from "../../../models/newSignal.model.js";
import {
  extractEntitiesFromForm4,
  mapEntitiesToNewSignals,
} from "../../../tools/AiAgents/scraperAgents/liquidity/Form4ParserAgent.js";
import { Form4Data } from "../../../types/signal.types.js";
import { secRequest } from "./commonScraping.service.js";

// /**
//  * Scrape Form 4 from URL and directly convert to NEW Signal(s) using SignalNew model
//  * @param xmlUrl - Direct URL to Form 4 XML file
//  * @returns Array of SignalNew IDs created
//  */
// export const scrapeForm4ToNewSignal = async (xmlUrl: string): Promise<string[]> => {
//   try {
//     console.log(`\n🔄 Scraping Form 4 from URL and converting to NEW Signal(s)`);
//     console.log(`   URL: ${xmlUrl}`);

//     // Extract accession number from URL
//     const accessionMatch = xmlUrl.match(/\/(\d{10}-\d{2}-\d{6})/);
//     const accession = accessionMatch ? accessionMatch[1] : "";

//     if (!accession) {
//       throw new Error("Could not extract accession number from URL");
//     }

//     // Check if already processed (check if SignalNew exists with this filing link)
//     const existingSignals = await SignalNew.find({ filingLink: xmlUrl }).lean();
//     if (existingSignals.length > 0) {
//       console.log(`ℹ️  Signal(s) already exist for this filing: ${xmlUrl}`);
//       console.log(`   Found ${existingSignals.length} existing signal(s)`);
//       return existingSignals.map((s) => s._id.toString());
//     }

//     // Fetch XML content from SEC
//     console.log(`📥 Fetching Form 4 XML...`);
//     const xmlContent = await secRequest<string>(xmlUrl, {}, `Form 4 XML: ${xmlUrl}`);

//     if (!xmlContent) {
//       throw new Error("Failed to fetch XML content");
//     }

//     console.log(`✅ XML fetched successfully (${xmlContent.length} characters)`);

//     // Extract entities from Form 4 XML
//     console.log(`🤖 Extracting entities from Form 4 XML...`);
//     const entities = await extractEntitiesFromForm4(xmlContent);

//     if (!entities || entities.length === 0) {
//       console.warn(`⚠️  No entities extracted from Form 4: ${accession}`);
//       return [];
//     }

//     console.log(`✅ Extracted ${entities.length} entity/entities`);

//     // Create a minimal Form4 object for mapping
//     const form4Data: Form4Data = {
//       accession,
//       filingLink: xmlUrl,
//       rawXml: xmlContent,
//       companyName: entities[0]?.companyName || "",
//       companyTicker: "",
//       insiderName: entities[0]?.name || "",
//       filingDate: new Date(),
//     };

//     // Map entities to new signals using the new helper
//     const signals = mapEntitiesToNewSignals(entities, form4Data);

//     // Save signals to database using SignalNew model
//     const signalIds: string[] = [];
//     for (const signalData of signals) {
//       // Check if signal already exists for this entity
//       const existingSignal = await SignalNew.findOne({
//         filingLink: xmlUrl,
//         fullName: signalData.fullName,
//       });

//       if (existingSignal) {
//         console.log(`ℹ️  Signal already exists for ${signalData.fullName}`);
//         signalIds.push(String(existingSignal._id));
//         continue;
//       }

//       const savedSignal = await SignalNew.create(signalData);
//       signalIds.push(String(savedSignal._id));
//       console.log(`✅ Signal created: ${savedSignal.fullName} (${savedSignal._id})`);
//     }

//     console.log(`\n✅ Scrape-to-NEW-Signal complete. Created ${signalIds.length} signal(s)`);
//     return signalIds;
//   } catch (error: any) {
//     console.error(`❌ Failed to scrape Form 4 to NEW Signal:`, error.message);
//     return [];
//   }
// };

/**
 * Scrape latest Form 4s from SEC RSS feed and convert directly to NEW Signals (SignalNew model)
 * @param limit - Maximum number of Form 4s to scrape (default: 20, max: 40)
 * @returns Scraping results with signal IDs
 */
export const scrapeLatestForm4sToNewSignals = async (
  limit: number = 20,
): Promise<{
  total: number;
  successful: number;
  failed: number;
  alreadyExists: number;
  signalsCreated: number;
  details: Array<{
    accession: string;
    xmlUrl?: string;
    success: boolean;
    signalIds?: string[];
    error?: string;
  }>;
}> => {
  const rssUrl =
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=40&output=atom";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📡 Scraping Latest Form 4s from RSS Feed → NEW Signals`);
  console.log(`   Limit: ${Math.min(limit, 40)} filings`);
  console.log(`${"=".repeat(60)}\n`);

  const results = {
    total: 0,
    successful: 0,
    failed: 0,
    alreadyExists: 0,
    signalsCreated: 0,
    details: [] as Array<{
      accession: string;
      xmlUrl?: string;
      success: boolean;
      signalIds?: string[];
      error?: string;
    }>,
  };

  try {
    // Import cheerio dynamically
    const cheerio = await import("cheerio");

    // Fetch RSS feed
    console.log(`📥 Fetching Form 4 RSS feed...`);
    const responseData = await secRequest(
      rssUrl,
      {
        headers: {
          Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      "Form 4 RSS feed",
    );

    const $ = cheerio.load(responseData, { xmlMode: true });
    const entries: Array<{ accession: string; link: string; title: string }> = [];
    const seenAccessions = new Set<string>();

    // Parse RSS feed entries
    $("entry").each((_i, elem) => {
      const title = $(elem).find("title").text();
      const category = $(elem).find("category").attr("term");

      if (category === "4" || title.includes("4 -")) {
        const link = $(elem).find("link").attr("href") || "";
        const accessionMatch = link.match(/\/(\d{10}-\d{2}-\d{6})/);
        const accession = accessionMatch ? accessionMatch[1] : link;

        if (!seenAccessions.has(accession)) {
          seenAccessions.add(accession);
          entries.push({ accession, link, title });
        }
      }
    });

    console.log(`✅ Found ${entries.length} Form 4 entries in RSS feed`);

    const processLimit = Math.min(entries.length, limit);
    results.total = processLimit;

    // Process each Form 4 entry
    for (let i = 0; i < processLimit; i++) {
      const entry = entries[i];
      console.log(`\n[${"=".repeat(56)}]`);
      console.log(`Processing ${i + 1}/${processLimit}: ${entry.title}`);
      console.log(`[${"=".repeat(56)}]`);

      try {
        // Check if already exists by looking for signals with this accession in filingLink
        const existingSignals = await SignalNew.find({
          filingLink: { $regex: entry.accession },
        }).lean();
        if (existingSignals.length > 0) {
          console.log(`ℹ️  Signal(s) already exist for: ${entry.accession}`);
          results.alreadyExists++;
          results.details.push({
            accession: entry.accession,
            success: true,
            signalIds: existingSignals.map((s) => s._id.toString()),
          });
          continue;
        }

        // Fetch the filing index page to get XML URL
        console.log(`📥 Fetching filing index page...`);
        const indexData = await secRequest(
          entry.link,
          {
            headers: {
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          },
          `Form 4 index: ${entry.accession}`,
        );

        const $index = cheerio.load(indexData);
        const xmlLinks: string[] = [];

        $index("a").each((_idx, elem) => {
          const href = $index(elem).attr("href") || "";
          if (href.endsWith(".xml") && !href.includes("xslF345X05")) {
            const absolute = href.startsWith("http") ? href : `https://www.sec.gov${href}`;
            xmlLinks.push(absolute);
          }
        });

        let xmlUrl: string | null = null;
        let xmlContent: string | null = null;

        // Try to fetch XML content
        for (const url of xmlLinks) {
          try {
            const xmlData = await secRequest(
              url,
              {
                headers: {
                  Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
                  Referer: entry.link,
                },
              },
              `Form 4 XML: ${entry.accession}`,
            );

            if (xmlData && xmlData.length > 100 && xmlData.includes("ownershipDocument")) {
              xmlContent = xmlData;
              xmlUrl = url;
              break;
            }
          } catch (err) {
            console.warn(`Failed to fetch ${url}, trying next...`);
            continue;
          }
        }

        // Fallback to .txt file if XML not found
        if (!xmlContent) {
          console.log(`📄 Trying .txt fallback...`);
          const txtUrl = entry.link.replace("-index.htm", ".txt");
          const txtData = await secRequest(
            txtUrl,
            {
              headers: {
                Accept: "text/plain, */*;q=0.8",
                Referer: entry.link,
              },
            },
            `Form 4 TXT: ${entry.accession}`,
          );

          if (txtData && txtData.length > 100) {
            const xmlMatch = txtData.match(/<XML>([\s\S]*?)<\/XML>/i);
            if (xmlMatch && xmlMatch[1]) {
              const extractedXml = xmlMatch[1].trim();
              if (extractedXml.includes("ownershipDocument")) {
                xmlContent = extractedXml;
                xmlUrl = txtUrl;
              }
            }
          }
        }

        if (!xmlContent) {
          throw new Error("No valid XML content found");
        }

        console.log(`✅ XML fetched (${xmlContent.length} characters)`);
        ///////////////////////////////////////
        // Extract entities using AI agent
        ///////////////////////////////////////
        console.log(`🤖 Extracting entities from XML...`);
        const entities = await extractEntitiesFromForm4(xmlContent);

        if (!entities || entities.length === 0) {
          throw new Error("No entities extracted from Form 4");
        }

        console.log(`✅ Extracted ${entities.length} entity/entities`);

        // Create minimal Form4 object
        const form4Data: Form4Data = {
          accession: entry.accession,
          filingLink: xmlUrl || entry.link,
          rawXml: xmlContent,
          companyName: entities[0]?.companyName || "",
          companyTicker: "",
          insiderName: entities[0]?.name || "",
          filingDate: new Date(),
        };

        // Map to new signals
        const signals = mapEntitiesToNewSignals(entities, form4Data);

        // Save signals
        const signalIds: string[] = [];
        for (const signalData of signals) {
          const savedSignal = await SignalNew.create(signalData);
          signalIds.push(String(savedSignal._id));
          console.log(`✅ Signal created: ${savedSignal.fullName} (${savedSignal._id})`);
        }

        results.successful++;
        results.signalsCreated += signalIds.length;
        results.details.push({
          accession: entry.accession,
          xmlUrl: xmlUrl || undefined,
          success: true,
          signalIds,
        });

        console.log(`✅ Created ${signalIds.length} signal(s)`);
      } catch (error: any) {
        console.error(`❌ Failed: ${error.message}`);
        results.failed++;
        results.details.push({
          accession: entry.accession,
          success: false,
          error: error.message,
        });
      }

      // Rate limiting: 100ms between requests
      if (i < processLimit - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`✅ Scraping Complete`);
    console.log(`   Total: ${results.total}`);
    console.log(`   Successful: ${results.successful}`);
    console.log(`   Already Exists: ${results.alreadyExists}`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Signals Created: ${results.signalsCreated}`);
    console.log(`${"=".repeat(60)}\n`);

    return results;
  } catch (error: any) {
    console.error(`❌ RSS feed scraping failed:`, error.message);
    throw error;
  }
};

/**
 * Scrape historical Form 4s by date range and convert directly to NEW Signals (SignalNew model)
 * @param fromDate - Start date (YYYY-MM-DD)
 * @param toDate - End date (YYYY-MM-DD)
 * @param maxResults - Maximum results to process (default: 100)
 * @returns Scraping results with signal IDs
 */
export const scrapeHistoricalForm4sToNewSignals = async (
  fromDate: string,
  toDate: string,
  maxResults: number = 100,
): Promise<{
  success: boolean;
  dateRange: { from: string; to: string };
  total: number;
  successful: number;
  failed: number;
  alreadyExists: number;
  signalsCreated: number;
  details: Array<{
    accession: string;
    success: boolean;
    signalIds?: string[];
    company?: string;
    insider?: string;
    error?: string;
  }>;
  error?: string;
}> => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📅 Historical Form 4 Scraping → NEW Signals`);
  console.log(`   Date Range: ${fromDate} to ${toDate}`);
  console.log(`   Max Results: ${maxResults}`);
  console.log(`${"=".repeat(60)}\n`);

  const results: {
    success: boolean;
    dateRange: { from: string; to: string };
    total: number;
    successful: number;
    failed: number;
    alreadyExists: number;
    signalsCreated: number;
    details: Array<{
      accession: string;
      success: boolean;
      signalIds?: string[];
      company?: string;
      insider?: string;
      error?: string;
    }>;
    error?: string;
  } = {
    success: false,
    dateRange: { from: fromDate, to: toDate },
    total: 0,
    successful: 0,
    failed: 0,
    alreadyExists: 0,
    signalsCreated: 0,
    details: [],
    error: undefined,
  };

  try {
    // Import cheerio dynamically
    const cheerio = await import("cheerio");

    // Validate dates
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      throw new Error("Invalid date format. Use YYYY-MM-DD");
    }

    if (new Date(fromDate) > new Date(toDate)) {
      throw new Error("fromDate must be before or equal to toDate");
    }

    // Use SEC EDGAR Full-Text Search API
    const resultsPerPage = Math.min(maxResults, 100);
    const searchUrl = `https://efts.sec.gov/LATEST/search-index?forms=4&startdt=${fromDate}&enddt=${toDate}&from=0&size=${resultsPerPage}`;

    console.log(`🔗 Search URL: ${searchUrl}`);

    // Fetch from EFTS API
    console.log(`📥 Fetching Form 4 filings from SEC EFTS API...`);
    const responseData = await secRequest(
      searchUrl,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      },
      "Form 4 Historical Search (EFTS)",
    );

    // Parse JSON response
    const jsonResponse = typeof responseData === "string" ? JSON.parse(responseData) : responseData;
    const entries: Array<{
      accession: string;
      link: string;
      title: string;
      companyName: string;
    }> = [];
    const seenAccessions = new Set<string>();

    console.log(`📊 EFTS API returned ${jsonResponse.hits?.total?.value || 0} total hits`);

    if (jsonResponse.hits && jsonResponse.hits.hits) {
      for (const hit of jsonResponse.hits.hits) {
        const source = hit._source;
        const accession = source.adsh;
        const cik = source.ciks?.[0];
        const companyName = source.display_names?.[0] || "Unknown";

        // Build filing URL
        const accessionNoHyphens = accession.replace(/-/g, "");
        const filingLink = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoHyphens}/${accession}-index.htm`;

        if (accession && !seenAccessions.has(accession)) {
          seenAccessions.add(accession);
          entries.push({
            accession,
            link: filingLink,
            title: `Form 4 - ${companyName}`,
            companyName,
          });
        }
      }
    }

    console.log(`✅ Found ${entries.length} Form 4 filings in date range`);

    if (entries.length === 0) {
      results.success = true;
      return results;
    }

    results.total = entries.length;

    // Process each Form 4 entry
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      console.log(`\n[${"=".repeat(56)}]`);
      console.log(`Processing ${i + 1}/${entries.length}: ${entry.title}`);
      console.log(`[${"=".repeat(56)}]`);

      try {
        // Check if already exists
        const existingSignals = await SignalNew.find({
          filingLink: { $regex: entry.accession },
        }).lean();
        if (existingSignals.length > 0) {
          console.log(`ℹ️  Signal(s) already exist for: ${entry.accession}`);
          results.alreadyExists++;
          results.details.push({
            accession: entry.accession,
            success: true,
            signalIds: existingSignals.map((s) => s._id.toString()),
            company: entry.companyName,
          });
          continue;
        }

        // Fetch the filing index page
        console.log(`📥 Fetching filing index page...`);
        const indexData = await secRequest(
          entry.link,
          {
            headers: {
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          },
          `Form 4 index: ${entry.accession}`,
        );

        const $index = cheerio.load(indexData);
        const xmlLinks: string[] = [];

        $index("a").each((_idx, elem) => {
          const href = $index(elem).attr("href") || "";
          if (href.endsWith(".xml") && !href.includes("xslF345X05")) {
            const absolute = href.startsWith("http") ? href : `https://www.sec.gov${href}`;
            xmlLinks.push(absolute);
          }
        });

        let xmlContent: string | null = null;
        let xmlUrl: string | null = null;

        // Try to fetch XML content
        for (const url of xmlLinks) {
          try {
            const xmlData = await secRequest(
              url,
              {
                headers: {
                  Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
                  Referer: entry.link,
                },
              },
              `Form 4 XML: ${entry.accession}`,
            );

            if (xmlData && xmlData.length > 100 && xmlData.includes("ownershipDocument")) {
              xmlContent = xmlData;
              xmlUrl = url;
              break;
            }
          } catch (err) {
            console.warn(`Failed to fetch ${url}, trying next...`);
            continue;
          }
        }

        // Fallback to .txt file
        if (!xmlContent) {
          console.log(`📄 Trying .txt fallback...`);
          const txtUrl = entry.link.replace("-index.htm", ".txt");
          const txtData = await secRequest(
            txtUrl,
            {
              headers: {
                Accept: "text/plain, */*;q=0.8",
                Referer: entry.link,
              },
            },
            `Form 4 TXT: ${entry.accession}`,
          );

          if (txtData && txtData.length > 100) {
            const xmlMatch = txtData.match(/<XML>([\s\S]*?)<\/XML>/i);
            if (xmlMatch && xmlMatch[1]) {
              const extractedXml = xmlMatch[1].trim();
              if (extractedXml.includes("ownershipDocument")) {
                xmlContent = extractedXml;
                xmlUrl = txtUrl;
              }
            }
          }
        }

        if (!xmlContent) {
          throw new Error("No valid XML content found");
        }

        console.log(`✅ XML fetched (${xmlContent.length} characters)`);

        // Extract entities using AI agent
        console.log(`🤖 Extracting entities from XML...`);
        const entities = await extractEntitiesFromForm4(xmlContent);

        if (!entities || entities.length === 0) {
          throw new Error("No entities extracted from Form 4");
        }

        console.log(`✅ Extracted ${entities.length} entity/entities`);

        // Create minimal Form4 object
        const form4Data: Form4Data = {
          accession: entry.accession,
          filingLink: xmlUrl || entry.link,
          rawXml: xmlContent,
          companyName: entities[0]?.companyName || entry.companyName,
          companyTicker: "",
          insiderName: entities[0]?.name || "",
          filingDate: new Date(),
        };

        // Map to new signals
        const signals = mapEntitiesToNewSignals(entities, form4Data);

        // Save signals
        const signalIds: string[] = [];
        for (const signalData of signals) {
          const savedSignal = await SignalNew.create(signalData);
          signalIds.push(String(savedSignal._id));
          console.log(`✅ Signal created: ${savedSignal.fullName} (${savedSignal._id})`);
        }

        results.successful++;
        results.signalsCreated += signalIds.length;
        results.details.push({
          accession: entry.accession,
          success: true,
          signalIds,
          company: form4Data.companyName,
          insider: form4Data.insiderName,
        });

        console.log(`✅ Created ${signalIds.length} signal(s)`);
      } catch (error: any) {
        console.error(`❌ Failed: ${error.message}`);
        results.failed++;
        results.details.push({
          accession: entry.accession,
          success: false,
          error: error.message,
        });
      }

      // Rate limit
      if (i < entries.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`✅ Historical Scraping Complete`);
    console.log(`   Total: ${results.total}`);
    console.log(`   Successful: ${results.successful}`);
    console.log(`   Already Exists: ${results.alreadyExists}`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Signals Created: ${results.signalsCreated}`);
    console.log(`${"=".repeat(60)}\n`);

    results.success = true;
    return results;
  } catch (error: any) {
    console.error(`❌ Historical scraping failed:`, error.message);
    results.error = error.message;
    return results;
  }
};
