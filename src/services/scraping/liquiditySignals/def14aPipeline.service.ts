import { Signal } from "../../../models/Signals.model.js";
import {
  extractEntitiesFromDEF14A,
  mapEntitiesToSignals,
} from "../../../tools/AiAgents/scraperAgents/liquidity/DEF14AParserAgent.js";
import { DEF14AData } from "../../../types/signal.types.js";
import { secRequest } from "./commonScraping.service.js";

/**
 * Scrape DEF 14A from URL and directly convert to Signal(s)
 * without saving to a separate DEF14A database
 * @param url - Direct URL to DEF 14A filing
 * @returns Array of Signal IDs created
 */
export const scrapeDEF14AToSignal = async (url: string): Promise<string[]> => {
  try {
    console.log(`\n🔄 Scraping DEF 14A from URL and converting to Signal(s)`);
    console.log(`   URL: ${url}`);

    // Extract accession number from URL
    const accessionMatch = url.match(/\/(\d{10}-\d{2}-\d{6})/);
    const accession = accessionMatch ? accessionMatch[1] : "";

    if (!accession) {
      throw new Error("Could not extract accession number from URL");
    }

    // Check if already processed (check if Signal exists with this accession)
    const existingSignals = await Signal.find({ accession }).lean();
    if (existingSignals.length > 0) {
      console.log(`ℹ️  Signal(s) already exist for this accession: ${accession}`);
      console.log(`   Found ${existingSignals.length} existing signal(s)`);
      return existingSignals.map((s) => s._id.toString());
    }

    // Fetch content from SEC
    console.log(`📥 Fetching DEF 14A content...`);
    const content = await secRequest<string>(url, {}, `DEF 14A: ${url}`);

    if (!content) {
      throw new Error("Failed to fetch DEF 14A content");
    }

    console.log(`✅ Content fetched successfully (${content.length} characters)`);

    // Extract entities from DEF 14A using AI agent
    console.log(`🤖 Extracting entities from DEF 14A...`);
    const entities = await extractEntitiesFromDEF14A(content);

    if (!entities || entities.length === 0) {
      console.warn(`⚠️  No entities extracted from DEF 14A: ${accession}`);
      return [];
    }

    console.log(`✅ Extracted ${entities.length} entity/entities`);

    // Create a minimal DEF14A object for mapping (without saving to DB)
    const def14aData: DEF14AData = {
      accession,
      filingLink: url,
      rawContent: content,
      companyName: entities[0]?.companyName || "",
      companyTicker: "",
      filingDate: new Date(),
    };

    // Map entities to signals
    const signals = mapEntitiesToSignals(entities, def14aData);

    // Save signals to database
    const signalIds: string[] = [];
    for (const signalData of signals) {
      // Check if signal already exists for this entity
      const existingSignal = await Signal.findOne({
        accession: accession,
        fullName: signalData.fullName,
      });

      if (existingSignal) {
        console.log(`ℹ️  Signal already exists for ${signalData.fullName}`);
        signalIds.push(existingSignal._id.toString());
        continue;
      }

      const savedSignal = await Signal.create(signalData);
      signalIds.push(savedSignal._id.toString());
      console.log(`✅ Signal created: ${savedSignal.fullName} (${savedSignal._id})`);
    }

    console.log(`\n✅ Scrape-to-Signal complete. Created ${signalIds.length} signal(s)`);
    return signalIds;
  } catch (error: any) {
    console.error(`❌ Failed to scrape DEF 14A to Signal:`, error.message);
    return [];
  }
};

/**
 * Scrape latest DEF 14As from SEC RSS feed and convert directly to Signals
 * This is a helper function that scrapes the RSS feed and converts to signals
 * @param limit - Maximum number of DEF 14As to scrape (default: 20, max: 40)
 * @returns Scraping results with signal IDs
 */
export const scrapeLatestDEF14AsToSignals = async (
  limit: number = 20,
): Promise<{
  total: number;
  successful: number;
  failed: number;
  alreadyExists: number;
  signalsCreated: number;
  details: Array<{
    accession: string;
    url?: string;
    success: boolean;
    signalIds?: string[];
    error?: string;
  }>;
}> => {
  const rssUrl =
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=DEF+14A&count=40&output=atom";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📡 Scraping Latest DEF 14A from RSS Feed → Signals`);
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
      url?: string;
      success: boolean;
      signalIds?: string[];
      error?: string;
    }>,
  };

  try {
    const cheerio = await import("cheerio");

    console.log(`📥 Fetching DEF 14A RSS feed...`);
    const responseData = await secRequest(
      rssUrl,
      {
        headers: {
          Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      "DEF 14A RSS feed",
    );

    const $ = cheerio.load(responseData, { xmlMode: true });
    const entries: Array<{ accession: string; link: string; title: string }> = [];
    const seenAccessions = new Set<string>();

    $("entry").each((_i, elem) => {
      const title = $(elem).find("title").text();
      const category = $(elem).find("category").attr("term");

      if (category === "DEF 14A" || title.includes("DEF 14A")) {
        const link = $(elem).find("link").attr("href") || "";
        const accessionMatch = link.match(/\/(\d{10}-\d{2}-\d{6})/);
        const accession = accessionMatch ? accessionMatch[1] : link;

        if (!seenAccessions.has(accession)) {
          seenAccessions.add(accession);
          entries.push({ accession, link, title });
        }
      }
    });

    console.log(`✅ Found ${entries.length} DEF 14A entries in RSS feed`);

    const processLimit = Math.min(entries.length, limit);
    results.total = processLimit;

    for (let i = 0; i < processLimit; i++) {
      const entry = entries[i];
      console.log(`\n[${"=".repeat(56)}]`);
      console.log(`Processing ${i + 1}/${processLimit}: ${entry.title}`);
      console.log(`[${"=".repeat(56)}]`);

      try {
        const existingSignals = await Signal.find({ accession: entry.accession }).lean();
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

        console.log(`📥 Fetching filing index page...`);
        const indexData = await secRequest(
          entry.link,
          {
            headers: {
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          },
          `DEF 14A index: ${entry.accession}`,
        );

        const $index = cheerio.load(indexData);
        const documentLinks: string[] = [];

        // Find all .htm/.html links
        $index("a").each((_idx, elem) => {
          const href = $index(elem).attr("href") || "";

          // Only process links that point to actual SEC filing documents
          // Must be in /Archives/edgar/data/ path OR wrapped in iXBRL v
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

        let documentUrl: string | null = null;
        let documentContent: string | null = null;

        // Try to fetch document content
        for (const url of documentLinks) {
          try {
            console.log(`   🔗 Attempting to fetch: ${url}`);
            const docData = await secRequest(
              url,
              {
                headers: {
                  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                  Referer: entry.link,
                },
              },
              `DEF 14A document: ${entry.accession}`,
            );

            // Validate this is a DEF 14A document (check for proxy statement indicators)
            if (
              docData &&
              docData.length > 1000 &&
              (docData.toLowerCase().includes("proxy statement") ||
                docData.toLowerCase().includes("annual meeting") ||
                docData.toLowerCase().includes("board of directors") ||
                docData.toLowerCase().includes("director") ||
                docData.toLowerCase().includes("proposal"))
            ) {
              documentContent = docData;
              documentUrl = url;
              console.log(`   ✅ Fetched ${docData.length} characters from: ${url}`);
              // Show a sample of the content
              const sample = docData.substring(0, 200).replace(/\s+/g, " ");
              console.log(`   📄 Content preview: ${sample}...`);
              break;
            } else if (docData && docData.length > 100) {
              console.log(
                `   ⚠️  Document fetched but doesn't appear to be a DEF 14A (${docData.length} chars), trying next...`,
              );
            }
          } catch (err) {
            console.warn(`   ⚠️  Failed to fetch ${url}, trying next...`);
            continue;
          }
        }

        // Fallback to .txt file if HTML not found
        if (!documentContent) {
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
            `DEF 14A TXT: ${entry.accession}`,
          );

          if (txtData && txtData.length > 100) {
            documentContent = txtData;
            documentUrl = txtUrl;
          }
        }

        if (!documentContent) {
          throw new Error("No valid document content found");
        }

        console.log(`✅ Document fetched (${documentContent.length} characters)`);

        // Extract entities using AI agent
        console.log(`🤖 Extracting entities from document...`);
        const entities = await extractEntitiesFromDEF14A(documentContent);

        if (!entities || entities.length === 0) {
          throw new Error("No entities extracted from DEF 14A");
        }

        console.log(`✅ Extracted ${entities.length} entity/entities`);

        // Create minimal DEF14A object
        const def14aData: DEF14AData = {
          accession: entry.accession,
          filingLink: documentUrl || entry.link,
          rawContent: documentContent,
          companyName: entities[0]?.companyName || "",
          companyTicker: "",
          filingDate: new Date(),
        };

        // Map to signals
        const signals = mapEntitiesToSignals(entities, def14aData);

        // Save signals
        const signalIds: string[] = [];
        for (const signalData of signals) {
          const savedSignal = await Signal.create(signalData);
          signalIds.push(savedSignal._id.toString());
          console.log(`✅ Signal created: ${savedSignal.fullName} (${savedSignal._id})`);
        }

        results.successful++;
        results.signalsCreated += signalIds.length;
        results.details.push({
          accession: entry.accession,
          url: documentUrl || undefined,
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
 * Scrape historical DEF 14As by date range and convert directly to Signals
 * This bypasses any separate filing database and goes straight to Signal creation
 * @param fromDate - Start date (YYYY-MM-DD)
 * @param toDate - End date (YYYY-MM-DD)
 * @param maxResults - Maximum results to process (default: 100)
 * @returns Scraping results with signal IDs
 */
export const scrapeHistoricalDEF14AsToSignals = async (
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
    error?: string;
  }>;
  error?: string;
}> => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📅 Historical DEF 14A Scraping → Signals`);
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
    details: [] as Array<{
      accession: string;
      success: boolean;
      signalIds?: string[];
      company?: string;
      error?: string;
    }>,
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
    const searchUrl = `https://efts.sec.gov/LATEST/search-index?forms=DEF+14A&startdt=${fromDate}&enddt=${toDate}&from=0&size=${resultsPerPage}`;

    console.log(`🔗 Search URL: ${searchUrl}`);

    // Fetch from EFTS API
    console.log(`📥 Fetching DEF 14A filings from SEC EFTS API...`);
    const responseData = await secRequest(
      searchUrl,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      },
      "DEF 14A Historical Search (EFTS)",
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
            title: `DEF 14A - ${companyName}`,
            companyName,
          });
        }
      }
    }

    console.log(`✅ Found ${entries.length} DEF 14A filings in date range`);

    if (entries.length === 0) {
      results.success = true;
      return results;
    }

    results.total = entries.length;

    // Process each DEF 14A entry
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      console.log(`\n[${"=".repeat(56)}]`);
      console.log(`Processing ${i + 1}/${entries.length}: ${entry.title}`);
      console.log(`[${"=".repeat(56)}]`);

      try {
        // Check if already exists
        const existingSignals = await Signal.find({ accession: entry.accession }).lean();
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
          `DEF 14A index: ${entry.accession}`,
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

        let documentContent: string | null = null;

        // Try to fetch document content
        for (const url of documentLinks) {
          try {
            console.log(`   🔗 Attempting to fetch: ${url}`);
            const docData = await secRequest(
              url,
              {
                headers: {
                  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                  Referer: entry.link,
                },
              },
              `DEF 14A document: ${entry.accession}`,
            );

            // Validate this is a DEF 14A document (check for proxy statement indicators)
            if (
              docData &&
              docData.length > 1000 &&
              (docData.toLowerCase().includes("proxy statement") ||
                docData.toLowerCase().includes("annual meeting") ||
                docData.toLowerCase().includes("board of directors") ||
                docData.toLowerCase().includes("director") ||
                docData.toLowerCase().includes("proposal"))
            ) {
              documentContent = docData;
              console.log(`   ✅ Fetched ${docData.length} characters from: ${url}`);
              // Show a sample of the content
              const sample = docData.substring(0, 200).replace(/\s+/g, " ");
              console.log(`   📄 Content preview: ${sample}...`);
              break;
            } else if (docData && docData.length > 100) {
              console.log(
                `   ⚠️  Document fetched but doesn't appear to be a DEF 14A (${docData.length} chars), trying next...`,
              );
            }
          } catch (err) {
            console.warn(`   ⚠️  Failed to fetch ${url}, trying next...`);
            continue;
          }
        }

        // Fallback to .txt file
        if (!documentContent) {
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
            `DEF 14A TXT: ${entry.accession}`,
          );

          if (txtData && txtData.length > 100) {
            documentContent = txtData;
          }
        }

        if (!documentContent) {
          throw new Error("No valid document content found");
        }

        console.log(`✅ Document fetched (${documentContent.length} characters)`);

        // Extract entities using AI agent
        console.log(`🤖 Extracting entities from document...`);
        const entities = await extractEntitiesFromDEF14A(documentContent);

        if (!entities || entities.length === 0) {
          throw new Error("No entities extracted from DEF 14A");
        }

        console.log(`✅ Extracted ${entities.length} entity/entities`);

        // Create minimal DEF14A object
        const def14aData: DEF14AData = {
          accession: entry.accession,
          filingLink: entry.link,
          rawContent: documentContent,
          companyName: entities[0]?.companyName || entry.companyName,
          companyTicker: "",
          filingDate: new Date(),
        };

        // Map to signals
        const signals = mapEntitiesToSignals(entities, def14aData);

        // Save signals
        const signalIds: string[] = [];
        for (const signalData of signals) {
          const savedSignal = await Signal.create(signalData);
          signalIds.push(savedSignal._id.toString());
          console.log(`✅ Signal created: ${savedSignal.fullName} (${savedSignal._id})`);
        }

        results.successful++;
        results.signalsCreated += signalIds.length;
        results.details.push({
          accession: entry.accession,
          success: true,
          signalIds,
          company: def14aData.companyName,
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

      // Rate limiting: 200ms between requests
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

/**
 * Get signal enrichment statistics for DEF 14A signals
 * @returns Statistics about signal enrichment status
 */
export const getDEF14ASignalEnrichmentStats = async (): Promise<{
  total: number;
  enriched: number;
  pending: number;
  failed: number;
  enrichmentRate: string;
  recentlyEnriched: Array<{
    signalId: string;
    fullName?: string;
    companyName: string;
    contactCount: number;
    enrichedAt: Date;
  }>;
  pendingSignals: Array<{
    signalId: string;
    fullName?: string;
    companyName: string;
    signalSource: string;
    createdAt: Date;
  }>;
}> => {
  try {
    // Count signals by enrichment status for DEF 14A signals only
    const totalSignals = await Signal.countDocuments({
      filingType: "DEF 14A proxy statement",
    });
    const enrichedSignals = await Signal.countDocuments({
      filingType: "DEF 14A proxy statement",
      contactEnrichmentStatus: "completed",
    });
    const pendingSignals = await Signal.countDocuments({
      filingType: "DEF 14A proxy statement",
      contactEnrichmentStatus: { $in: [null, "pending"] },
    });
    const failedSignals = await Signal.countDocuments({
      filingType: "DEF 14A proxy statement",
      contactEnrichmentStatus: "failed",
    });

    // Calculate enrichment rate
    const enrichmentRate =
      totalSignals > 0 ? ((enrichedSignals / totalSignals) * 100).toFixed(2) : "0";

    // Get recently enriched signals (last 10)
    const recentlyEnrichedSignals = await Signal.find({
      filingType: "DEF 14A proxy statement",
      contactEnrichmentStatus: "completed",
      contactEnrichmentDate: { $exists: true },
    })
      .sort({ contactEnrichmentDate: -1 })
      .limit(10)
      .select("_id fullName companyName keyPeople contactEnrichmentDate")
      .lean();

    const recentlyEnriched = recentlyEnrichedSignals.map((signal) => ({
      signalId: signal._id.toString(),
      fullName: signal.fullName,
      companyName: signal.companyName || "",
      contactCount: signal.keyPeople?.length || 0,
      enrichedAt: signal.contactEnrichmentDate || new Date(),
    }));

    // Get pending signals (first 20)
    const pendingSignalsData = await Signal.find({
      filingType: "DEF 14A proxy statement",
      contactEnrichmentStatus: { $in: [null, "pending"] },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select("_id fullName companyName signalSource createdAt")
      .lean();

    const pendingSignalsList = pendingSignalsData.map((signal) => ({
      signalId: signal._id.toString(),
      fullName: signal.fullName,
      companyName: signal.companyName || "",
      signalSource: signal.signalSource || "",
      createdAt: signal.createdAt || new Date(),
    }));

    return {
      total: totalSignals,
      enriched: enrichedSignals,
      pending: pendingSignals,
      failed: failedSignals,
      enrichmentRate,
      recentlyEnriched,
      pendingSignals: pendingSignalsList,
    };
  } catch (error: any) {
    console.error(`❌ Failed to get DEF 14A enrichment stats:`, error.message);
    throw error;
  }
};
