import { Signal } from "../../../models/Signals.model.js";
import {
  extractS3DataFromParsed,
  mapS3ToSignals,
} from "../../../tools/AiAgents/scraperAgents/liquidity/FormS3ParserAgent.js";
import { scrapeS3, secRequest } from "./commonScraping.service.js";
import { ScrapingResult } from "../../../types/signal.types.js";
import logger from "../../../utils/logger.js";

/**
 * =========================================
 * S-3 Scraping Pipeline
 * =========================================
 * This service handles:
 * 1. Scraping S-3 forms from SEC RSS feed
 * 2. Converting XML to structured data using AI agent
 * 3. Mapping to Signal schema
 * 4. Saving to database
 */

/**
 * Process S-3 XML data and convert to Signal(s)
 * @param xmlString - Raw XML string from SEC
 * @param accession - Accession number
 * @param filingLink - Link to the filing
 * @returns Array of created signal IDs
 */
export async function processS3XmlToSignals(
  xmlString: string,
  accession: string,
  filingLink: string,
): Promise<string[]> {
  try {
    console.log(`\n🔄 Processing S-3 XML to Signal(s)`);
    console.log(`   Accession: ${accession}`);

    // Check if already processed
    const existingSignals = await Signal.find({
      accession,
      signalType: { $in: ["form-s3", "form-s3a", "form-s3-underwriter"] },
    }).lean();

    if (existingSignals.length > 0) {
      console.log(`ℹ️  Signal(s) already exist for this accession: ${accession}`);
      console.log(`   Found ${existingSignals.length} existing signal(s)`);
      return existingSignals.map((s) => s._id.toString());
    }

    // Extract data using AI agent
    console.log(`🤖 Extracting S-3 data using AI agent...`);
    const parsed = await extractS3DataFromParsed(xmlString);

    // Map to signals
    const rawData = {
      _id: null,
      accession,
      filingLink,
      xmlContent: xmlString,
    };

    const signals = mapS3ToSignals(parsed, rawData);
    console.log(`✅ Mapped to ${signals.length} signal(s)`);

    // Save signals to database
    const signalIds: string[] = [];
    for (const signalData of signals) {
      try {
        // Check if signal already exists
        const existingSignal = await Signal.findOne({
          accession: signalData.accession,
          companyName: signalData.companyName,
          signalType: signalData.signalType,
        });

        if (existingSignal) {
          console.log(`ℹ️  Signal already exists for ${signalData.companyName}`);
          signalIds.push(existingSignal._id.toString());
          continue;
        }

        const savedSignal = await Signal.create(signalData);
        signalIds.push(savedSignal._id.toString());
        console.log(
          `✅ Signal created: ${savedSignal.companyName} (${savedSignal.signalType}) - ${savedSignal._id}`,
        );
      } catch (err: any) {
        if (err.code === 11000) {
          console.log(`ℹ️  Duplicate signal for ${signalData.companyName}, skipping...`);
        } else {
          console.error(`❌ Error creating signal for ${signalData.companyName}:`, err.message);
        }
      }
    }

    console.log(`\n✅ S-3 processing complete. Created ${signalIds.length} signal(s)`);
    return signalIds;
  } catch (error: any) {
    console.error(`❌ Failed to process S-3 XML to Signal:`, error.message);
    throw error;
  }
}

/**
 * Scrape latest S-3 filings and convert to Signals
 * @param limit - Maximum number of filings to process (default: 5)
 * @returns Statistics about scraping results
 */
export async function scrapeLatestS3ToSignals(limit: number = 5): Promise<{
  total: number;
  successful: number;
  alreadyExists: number;
  failed: number;
  signalIds: string[];
}> {
  try {
    console.log(`\n📡 Fetching latest S-3 filings and converting to Signals (limit: ${limit})`);

    // Use the existing scrapeS3 function to get XML data
    const scrapingResult: ScrapingResult = await scrapeS3();

    if (!scrapingResult.data || scrapingResult.data.length === 0) {
      console.log(`⚠️  No S-3 data scraped`);
      return {
        total: 0,
        successful: 0,
        alreadyExists: 0,
        failed: 0,
        signalIds: [],
      };
    }

    console.log(`📋 Found ${scrapingResult.data.length} S-3 filing(s) to process`);

    let successful = 0;
    let alreadyExists = 0;
    let failed = 0;
    const allSignalIds: string[] = [];

    // Process each XML entry
    for (let i = 0; i < Math.min(scrapingResult.data.length, limit); i++) {
      const xmlString = scrapingResult.data[i];

      try {
        // Extract accession number from XML
        const accessionMatch = xmlString.match(
          /<accessionNumber>([^<]+)<\/accessionNumber>|<accession[^>]*>([^<]+)<\/accession>/i,
        );
        const accession = accessionMatch
          ? accessionMatch[1] || accessionMatch[2]
          : `s3-${Date.now()}-${i}`;

        // Extract filing link from XML if available
        const linkMatch = xmlString.match(
          /<filingHref>([^<]+)<\/filingHref>|<link[^>]*>([^<]+)<\/link>/i,
        );
        const filingLink = linkMatch
          ? linkMatch[1] || linkMatch[2]
          : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=S-3&dateb=&owner=exclude&count=40`;

        console.log(
          `\n📄 Processing S-3 filing ${i + 1}/${Math.min(scrapingResult.data.length, limit)}`,
        );
        console.log(`   Accession: ${accession}`);

        const signalIds = await processS3XmlToSignals(xmlString, accession, filingLink);

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
        console.error(`❌ Failed to process S-3 filing:`, err.message);
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    console.log(`\n✅ S-3 scraping completed!`);
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
    console.error(`❌ Failed to scrape latest S-3 filings:`, error.message);
    throw error;
  }
}

/**
 * Scrape S-3 from a specific URL and convert to Signal(s)
 * @param url - URL to S-3 filing
 * @returns Object with success status and signal IDs created
 */
export async function scrapeS3FromUrl(
  url: string,
): Promise<{ success: boolean; signalIds: string[]; error?: string }> {
  try {
    console.log(`\n🔄 Scraping S-3 from URL and converting to Signal(s)`);
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
      signalType: { $in: ["form-s3", "form-s3a", "form-s3-underwriter"] },
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
    console.log(`📥 Fetching S-3 filing...`);
    let documentContent: string;

    if (url.includes("-index.htm")) {
      // This is an index page, fetch the XML file
      const xmlUrl = url.replace("-index.htm", ".xml");
      documentContent = await secRequest<string>(xmlUrl, {}, `S-3 XML: ${accession}`);
    } else {
      documentContent = await secRequest<string>(url, {}, `S-3 document: ${accession}`);
    }

    if (!documentContent) {
      return {
        success: false,
        signalIds: [],
        error: "Failed to fetch S-3 content",
      };
    }

    console.log(`✅ Document fetched successfully (${documentContent.length} characters)`);

    // Process the XML
    const signalIds = await processS3XmlToSignals(documentContent, accession, url);

    return {
      success: true,
      signalIds,
    };
  } catch (error: any) {
    console.error(`❌ Failed to scrape S-3 from URL:`, error.message);
    return {
      success: false,
      signalIds: [],
      error: error.message,
    };
  }
}

/**
 * Get enrichment statistics for S-3 signals
 * @returns Statistics about S-3 signal enrichment status
 */
export async function getS3SignalEnrichmentStats() {
  const total = await Signal.countDocuments({
    signalType: { $in: ["form-s3", "form-s3a", "form-s3-underwriter"] },
  });
  const pending = await Signal.countDocuments({
    signalType: { $in: ["form-s3", "form-s3a", "form-s3-underwriter"] },
    contactEnrichmentStatus: "pending",
  });
  const processing = await Signal.countDocuments({
    signalType: { $in: ["form-s3", "form-s3a", "form-s3-underwriter"] },
    contactEnrichmentStatus: "processing",
  });
  const completed = await Signal.countDocuments({
    signalType: { $in: ["form-s3", "form-s3a", "form-s3-underwriter"] },
    contactEnrichmentStatus: "completed",
  });
  const failed = await Signal.countDocuments({
    signalType: { $in: ["form-s3", "form-s3a", "form-s3-underwriter"] },
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
