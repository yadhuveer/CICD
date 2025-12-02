import { Signal } from "../../../models/Signals.model.js";
import {
  extract8KDataFromParsed,
  map8KToSignals,
} from "../../../tools/AiAgents/scraperAgents/liquidity/Form8KParserAgent.js";
import { scrape8K, secRequest } from "./commonScraping.service.js";
import { ScrapingResult } from "../../../types/signal.types.js";
import logger from "../../../utils/logger.js";

/**
 * =========================================
 * Form 8-K Scraping Pipeline
 * =========================================
 * This service handles:
 * 1. Scraping Form 8-K filings from SEC RSS feed
 * 2. Converting XML/XBRL to structured data using AI agent
 * 3. Mapping to Signal schema
 * 4. Saving to database
 *
 * Form 8-K is a "current report" that companies must file to announce
 * major events that shareholders should know about, such as:
 * - Acquisitions or dispositions of assets
 * - Changes in officers or directors
 * - Financial results
 * - Material agreements
 * - Bankruptcy or receivership
 */

/**
 * Process Form 8-K XML data and convert to Signal(s)
 * @param xmlString - Raw XML/XBRL string from SEC
 * @param accession - Accession number
 * @param filingLink - Link to the filing
 * @returns Array of created signal IDs
 */
export async function process8KXmlToSignals(
  xmlString: string,
  accession: string,
  filingLink: string,
): Promise<string[]> {
  try {
    console.log(`\n🔄 Processing Form 8-K XML to Signal(s)`);
    console.log(`   Accession: ${accession}`);

    // Check if already processed
    const existingSignals = await Signal.find({
      accession,
      signalType: { $in: ["form-8k", "form-8ka"] },
    }).lean();

    if (existingSignals.length > 0) {
      console.log(`ℹ️  Signal(s) already exist for this accession: ${accession}`);
      console.log(`   Found ${existingSignals.length} existing signal(s)`);
      return existingSignals.map((s) => s._id.toString());
    }

    // Extract data using AI agent
    console.log(`🤖 Extracting Form 8-K data using AI agent...`);
    const parsed = await extract8KDataFromParsed(xmlString);

    // Map to signals
    const rawData = {
      _id: null,
      accession,
      filingLink,
      xmlContent: xmlString,
    };

    const signals = map8KToSignals(parsed, rawData);
    console.log(`✅ Mapped to ${signals.length} signal(s)`);

    // Log signal details
    signals.forEach((sig, idx) => {
      console.log(
        `   Signal ${idx + 1}: ${sig.signalSource} - ${sig.fullName} (${sig.signalType})`,
      );
      if (sig.eventItems && sig.eventItems.length > 0) {
        console.log(`      Event Items: ${sig.eventItems.join(", ")}`);
      }
      if (sig.eventDescription) {
        console.log(`      Description: ${sig.eventDescription}`);
      }
    });

    // Save signals to database
    const signalIds: string[] = [];
    for (const signalData of signals) {
      try {
        // Check if signal already exists
        const existingSignal = await Signal.findOne({
          accession: signalData.accession,
          fullName: signalData.fullName,
          signalType: signalData.signalType,
        });

        if (existingSignal) {
          console.log(`ℹ️  Signal already exists for ${signalData.fullName}`);
          signalIds.push(existingSignal._id.toString());
          continue;
        }

        const savedSignal = await Signal.create(signalData);
        signalIds.push(savedSignal._id.toString());
        console.log(
          `✅ Signal created: ${savedSignal.fullName} (${savedSignal.signalSource} - ${savedSignal.signalType}) - ${savedSignal._id}`,
        );
      } catch (err: any) {
        if (err.code === 11000) {
          console.log(`ℹ️  Duplicate signal for ${signalData.fullName}, skipping...`);
        } else {
          console.error(`❌ Error creating signal for ${signalData.fullName}:`, err.message);
        }
      }
    }

    console.log(`\n✅ Form 8-K processing complete. Created ${signalIds.length} signal(s)`);
    return signalIds;
  } catch (error: any) {
    console.error(`❌ Failed to process Form 8-K XML to Signal:`, error.message);
    throw error;
  }
}

/**
 * Scrape latest Form 8-K filings and convert to Signals
 * @param limit - Maximum number of filings to process (default: 5)
 * @returns Statistics about scraping results
 */
export async function scrapeLatest8KToSignals(limit: number = 5): Promise<{
  total: number;
  successful: number;
  alreadyExists: number;
  failed: number;
  signalIds: string[];
}> {
  try {
    console.log(
      `\n📡 Fetching latest Form 8-K filings and converting to Signals (limit: ${limit})`,
    );

    // Use the existing scrape8K function to get XML data
    const scrapingResult: ScrapingResult = await scrape8K();

    if (!scrapingResult.data || scrapingResult.data.length === 0) {
      console.log(`⚠️  No Form 8-K data scraped`);
      return {
        total: 0,
        successful: 0,
        alreadyExists: 0,
        failed: 0,
        signalIds: [],
      };
    }

    console.log(`📋 Found ${scrapingResult.data.length} Form 8-K filing(s) to process`);

    let successful = 0;
    let alreadyExists = 0;
    let failed = 0;
    const allSignalIds: string[] = [];

    // Process each XML entry
    for (let i = 0; i < Math.min(scrapingResult.data.length, limit); i++) {
      const xmlString = scrapingResult.data[i];
      const entryMetadata = scrapingResult.metadata?.[i]; // Get corresponding RSS entry metadata

      try {
        // Use accession from RSS feed metadata if available, otherwise extract from XML
        let accession = entryMetadata?.accession || "";
        if (!accession) {
          const accessionMatch = xmlString.match(
            /<accession-number>([^<]+)<\/accession-number>|<accessionNumber>([^<]+)<\/accessionNumber>/i,
          );
          accession = accessionMatch
            ? accessionMatch[1] || accessionMatch[2]
            : `8k-${Date.now()}-${i}`;
        }

        // Use filing link from RSS feed metadata (most reliable source!)
        let filingLink = entryMetadata?.link || "";

        // Fallback 1: Try to extract from <filing-href> tag in XML
        if (!filingLink) {
          const filingHrefMatch = xmlString.match(/<filing-href>([^<]+)<\/filing-href>/i);
          if (filingHrefMatch) {
            filingLink = filingHrefMatch[1];
          }
        }

        // Fallback 2: Try to construct from accession number
        if (!filingLink && accession && accession.match(/\d{10}-\d{2}-\d{6}/)) {
          // Format: https://www.sec.gov/Archives/edgar/data/CIK/ACCESSION/ACCESSION-index.htm
          const cikMatch = xmlString.match(/<cik>([^<]+)<\/cik>/i);
          if (cikMatch) {
            const cik = cikMatch[1].padStart(10, "0");
            const accessionClean = accession.replace(/-/g, "");
            filingLink = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionClean}/${accession}-index.htm`;
          }
        }

        // Final fallback (generic search URL)
        if (!filingLink) {
          filingLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=8-K&dateb=&owner=exclude&count=40`;
        }

        console.log(
          `\n📄 Processing Form 8-K filing ${i + 1}/${Math.min(scrapingResult.data.length, limit)}`,
        );
        console.log(`   Accession: ${accession}`);
        console.log(`   Filing Link: ${filingLink}`);
        if (entryMetadata) {
          console.log(`   Title: ${entryMetadata.title}`);
        }

        const signalIds = await process8KXmlToSignals(xmlString, accession, filingLink);

        if (signalIds.length > 0) {
          // Check if these are newly created or existing
          const existingCount = await Signal.countDocuments({
            _id: { $in: signalIds },
            createdAt: { $lt: new Date(Date.now() - 1000) }, // Created more than 1 second ago
          });

          if (existingCount === signalIds.length) {
            alreadyExists++;
          } else {
            successful++;
          }

          allSignalIds.push(...signalIds);
        } else {
          successful++;
        }
      } catch (err: any) {
        failed++;
        console.error(`❌ Failed to process Form 8-K filing:`, err.message);
      }

      // Rate limiting to avoid SEC blocking
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    console.log(`\n✅ Form 8-K scraping completed!`);
    console.log(`   Total processed: ${Math.min(scrapingResult.data.length, limit)}`);
    console.log(`   Successful: ${successful}`);
    console.log(`   Already exists: ${alreadyExists}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Total signals: ${allSignalIds.length}`);

    return {
      total: Math.min(scrapingResult.data.length, limit),
      successful,
      alreadyExists,
      failed,
      signalIds: allSignalIds,
    };
  } catch (error: any) {
    console.error(`❌ Failed to scrape latest Form 8-K filings:`, error.message);
    throw error;
  }
}

/**
 * Scrape Form 8-K from a specific URL and convert to Signal(s)
 * @param url - URL to Form 8-K filing
 * @returns Object with success status and signal IDs created
 */
export async function scrape8KFromUrl(
  url: string,
): Promise<{ success: boolean; signalIds: string[]; error?: string }> {
  try {
    console.log(`\n🔄 Scraping Form 8-K from URL and converting to Signal(s)`);
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

    // Check if already processed
    const existingSignals = await Signal.find({
      accession,
      signalType: { $in: ["form-8k", "form-8ka"] },
    }).lean();

    if (existingSignals.length > 0) {
      console.log(`ℹ️  Signal(s) already exist for this accession: ${accession}`);
      console.log(`   Found ${existingSignals.length} existing signal(s)`);
      return {
        success: true,
        signalIds: existingSignals.map((s) => s._id.toString()),
      };
    }

    // Fetch the filing content
    console.log(`📥 Fetching Form 8-K filing...`);
    let documentContent: string;

    if (url.includes("-index.htm")) {
      // This is an index page, fetch the XML file
      // Form 8-K typically uses XBRL format with _htm.xml or _ins.xml extension
      const baseUrl = url.replace("-index.htm", "");
      const xmlUrl = `${baseUrl}_htm.xml`;
      documentContent = await secRequest<string>(xmlUrl, {}, `Form 8-K XML: ${accession}`);
    } else if (url.endsWith(".xml")) {
      documentContent = await secRequest<string>(url, {}, `Form 8-K XML: ${accession}`);
    } else {
      documentContent = await secRequest<string>(url, {}, `Form 8-K document: ${accession}`);
    }

    if (!documentContent) {
      return {
        success: false,
        signalIds: [],
        error: "Failed to fetch Form 8-K content",
      };
    }

    console.log(`✅ Document fetched successfully (${documentContent.length} characters)`);

    // Process the XML
    const signalIds = await process8KXmlToSignals(documentContent, accession, url);

    return {
      success: true,
      signalIds,
    };
  } catch (error: any) {
    console.error(`❌ Failed to scrape Form 8-K from URL:`, error.message);
    return {
      success: false,
      signalIds: [],
      error: error.message,
    };
  }
}

/**
 * Get enrichment statistics for Form 8-K signals
 * @returns Statistics about Form 8-K signal enrichment status
 */
export async function get8KSignalEnrichmentStats() {
  const total = await Signal.countDocuments({
    signalType: { $in: ["form-8k", "form-8ka"] },
  });
  const pending = await Signal.countDocuments({
    signalType: { $in: ["form-8k", "form-8ka"] },
    contactEnrichmentStatus: "pending",
  });
  const processing = await Signal.countDocuments({
    signalType: { $in: ["form-8k", "form-8ka"] },
    contactEnrichmentStatus: "processing",
  });
  const completed = await Signal.countDocuments({
    signalType: { $in: ["form-8k", "form-8ka"] },
    contactEnrichmentStatus: "completed",
  });
  const failed = await Signal.countDocuments({
    signalType: { $in: ["form-8k", "form-8ka"] },
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
}

/**
 * Get statistics about types of events in Form 8-K signals
 * @returns Object with counts of different event types
 */
export async function get8KEventTypeStats() {
  const signals = await Signal.find({
    signalType: { $in: ["form-8k", "form-8ka"] },
    eventItems: { $exists: true, $ne: [] },
  })
    .select("eventItems")
    .lean();

  const eventCounts: Record<string, number> = {};

  signals.forEach((signal: any) => {
    if (signal.eventItems && Array.isArray(signal.eventItems)) {
      signal.eventItems.forEach((item: string) => {
        eventCounts[item] = (eventCounts[item] || 0) + 1;
      });
    }
  });

  // Sort by count descending
  const sortedEvents = Object.entries(eventCounts)
    .sort(([, a], [, b]) => b - a)
    .reduce(
      (acc, [key, value]) => {
        acc[key] = value;
        return acc;
      },
      {} as Record<string, number>,
    );

  return {
    totalForms: signals.length,
    eventTypes: sortedEvents,
    topEvents: Object.entries(sortedEvents).slice(0, 10),
  };
}
