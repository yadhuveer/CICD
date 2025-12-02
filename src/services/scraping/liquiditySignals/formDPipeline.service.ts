import { Signal } from "../../../models/Signals.model.js";
import {
  extractFormDDataFromParsed,
  mapFormDToSignals,
} from "../../../tools/AiAgents/scraperAgents/liquidity/FormDParserAgent.js";
import { secRequest } from "./commonScraping.service.js";

/**
 * Form D Data structure
 */
export interface FormDData {
  accession: string;
  filingLink: string;
  rawXml?: string;
  issuerName?: string;
  filingDate?: Date;
}

/**
 * Scrape Form D from URL and directly convert to Signal(s)
 * @param xmlUrl - Direct URL to Form D XML file or filing link
 * @returns Array of Signal IDs created
 */
export const scrapeFormDToSignal = async (xmlUrl: string): Promise<string[]> => {
  try {
    console.log(`\n🔄 Scraping Form D from URL and converting to Signal(s)`);
    console.log(`   URL: ${xmlUrl}`);

    // Extract accession number from URL
    const accessionMatch = xmlUrl.match(/\/(\d{10}-\d{2}-\d{6})/);
    const accession = accessionMatch ? accessionMatch[1] : "";

    if (!accession) {
      throw new Error("Could not extract accession number from URL");
    }

    console.log(`   Accession: ${accession}`);

    // Check if already processed (check if Signal exists with this accession)
    const existingSignals = await Signal.find({ accession }).lean();
    if (existingSignals.length > 0) {
      console.log(`ℹ️  Signal(s) already exist for this accession: ${accession}`);
      console.log(`   Found ${existingSignals.length} existing signal(s)`);
      return existingSignals.map((s) => s._id.toString());
    }

    // Fetch XML content from SEC
    console.log(`📥 Fetching Form D XML...`);
    const xmlContent = await secRequest<string>(xmlUrl, {}, `Form D XML: ${xmlUrl}`);

    if (!xmlContent) {
      throw new Error("Failed to fetch XML content");
    }

    console.log(`✅ XML fetched successfully (${xmlContent.length} characters)`);

    // Process raw XML with AI agent
    console.log(`🤖 Processing with AI agent...`);
    const parsedData = await extractFormDDataFromParsed(xmlContent);

    if (!parsedData || !parsedData.relatedPersons || parsedData.relatedPersons.length === 0) {
      console.warn(`⚠️  No related persons extracted from Form D: ${accession}`);
      return [];
    }

    console.log(`✅ Extracted ${parsedData.relatedPersons.length} related person(s)`);
    console.log(`   Issuer: ${parsedData.issuerName}`);
    console.log(`   Offering Type: ${parsedData.offeringType}`);
    console.log(`   Total Offering Amount: ${parsedData.totalOfferingAmount}`);

    // Create a minimal FormD object for mapping (without saving to DB)
    const formDData: FormDData = {
      accession,
      filingLink: xmlUrl,
      rawXml: xmlContent,
      issuerName: parsedData.issuerName,
      filingDate: parsedData.filingDate ? new Date(parsedData.filingDate) : new Date(),
    };

    // Map to signals
    const signals = mapFormDToSignals(parsedData, formDData);

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
      console.log(
        `✅ Signal created: ${savedSignal.fullName} (${savedSignal.signalSource}) - ${savedSignal.designation}`,
      );
    }

    console.log(`\n✅ Scrape-to-Signal complete. Created ${signalIds.length} signal(s)`);
    return signalIds;
  } catch (error: any) {
    console.error(`❌ Failed to scrape Form D to Signal:`, error.message);
    return [];
  }
};

/**
 * Scrape latest Form D filings from SEC RSS feed and convert directly to Signals
 * @param limit - Maximum number of filings to scrape (default: 20, max: 40)
 * @returns Scraping results with signal IDs
 */
export const scrapeLatestFormDToSignals = async (
  limit: number = 20,
): Promise<{
  total: number;
  successful: number;
  failed: number;
  alreadyExists: number;
  signalsCreated: number;
  signalIds: string[];
  details: Array<{
    accession: string;
    xmlUrl?: string;
    success: boolean;
    signalIds?: string[];
    error?: string;
  }>;
}> => {
  const urlD =
    "https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=&type=D&owner=exclude&count=40&action=getcurrent&output=atom";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📡 Scraping Latest Form D from RSS Feed → Signals`);
  console.log(`   Limit: ${Math.min(limit, 40)} filings`);
  console.log(`${"=".repeat(60)}\n`);

  const results = {
    total: 0,
    successful: 0,
    failed: 0,
    alreadyExists: 0,
    signalsCreated: 0,
    signalIds: [] as string[],
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
    console.log(`📥 Fetching Form D RSS feed...`);
    const responseDataD = await secRequest(
      urlD,
      {
        headers: {
          Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      "Form D RSS feed",
    );

    // Parse feed
    const $D = cheerio.load(responseDataD, { xmlMode: true });
    const entries: Array<{ accession: string; link: string; title: string; category: string }> = [];
    const seenAccessions = new Set<string>();

    // Parse Form D entries
    $D("entry").each((_i, elem) => {
      const title = $D(elem).find("title").text();
      const category = $D(elem).find("category").attr("term");
      const link = $D(elem).find("link").attr("href") || "";
      const accessionMatch = link.match(/\/(\d{10}-\d{2}-\d{6})/);
      const accession = accessionMatch ? accessionMatch[1] : link;

      // Only process entries with category "D" (excludes D/A amendments for now)
      if (!seenAccessions.has(accession) && category === "D") {
        seenAccessions.add(accession);
        entries.push({ accession, link, title, category: category || "D" });
      }
    });

    console.log(`✅ Found ${entries.length} Form D entries in RSS feed`);

    const processLimit = Math.min(entries.length, limit);
    results.total = processLimit;

    // Process each filing entry
    for (let i = 0; i < processLimit; i++) {
      const entry = entries[i];
      console.log(`\n[${"=".repeat(56)}]`);
      console.log(`Processing ${i + 1}/${processLimit}: ${entry.title}`);
      console.log(`[${"=".repeat(56)}]`);

      try {
        // Check if already exists
        const existingSignals = await Signal.find({ accession: entry.accession }).lean();
        if (existingSignals.length > 0) {
          console.log(`ℹ️  Signal(s) already exist for: ${entry.accession}`);
          results.alreadyExists++;
          const existingIds = existingSignals.map((s) => s._id.toString());
          results.signalIds.push(...existingIds);
          results.details.push({
            accession: entry.accession,
            success: true,
            signalIds: existingIds,
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
          `Form D index: ${entry.accession}`,
        );

        const $index = cheerio.load(indexData);
        const xmlLinks: string[] = [];

        $index("a").each((_idx, elem) => {
          const href = $index(elem).attr("href") || "";
          if (href.endsWith(".xml") && !href.includes("xsl")) {
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
              `Form D XML: ${entry.accession}`,
            );

            if (xmlData && xmlData.length > 100) {
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
            `Form D TXT: ${entry.accession}`,
          );

          if (txtData && txtData.length > 100) {
            // Extract XML from .txt file
            const xmlMatch = txtData.match(/<offeringData[\s\S]*?<\/offeringData>/i);
            if (xmlMatch && xmlMatch[0]) {
              xmlContent = xmlMatch[0].trim();
              xmlUrl = txtUrl;
            }
          }
        }

        if (!xmlContent) {
          throw new Error("No valid XML content found");
        }

        console.log(`✅ XML fetched (${xmlContent.length} characters)`);

        // Process raw XML with AI agent
        console.log(`🤖 Processing with AI agent...`);
        const parsedData = await extractFormDDataFromParsed(xmlContent);

        if (!parsedData || !parsedData.relatedPersons || parsedData.relatedPersons.length === 0) {
          throw new Error("No related persons extracted from Form D");
        }

        console.log(`✅ Processed ${parsedData.relatedPersons.length} related person(s)`);

        // Create minimal FormD object
        const formDData: FormDData = {
          accession: entry.accession,
          filingLink: xmlUrl || entry.link,
          rawXml: xmlContent,
          issuerName: parsedData.issuerName,
          filingDate: parsedData.filingDate ? new Date(parsedData.filingDate) : new Date(),
        };

        // Map to signals
        const signals = mapFormDToSignals(parsedData, formDData);

        // Save signals
        const signalIds: string[] = [];
        for (const signalData of signals) {
          const savedSignal = await Signal.create(signalData);
          signalIds.push(savedSignal._id.toString());
          console.log(
            `✅ Signal created: ${savedSignal.fullName} (${savedSignal.signalSource}) - ${savedSignal.designation}`,
          );
        }

        results.successful++;
        results.signalsCreated += signalIds.length;
        results.signalIds.push(...signalIds);
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

      // Rate limiting: 150ms between requests
      if (i < processLimit - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
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
 * Process XML strings from scrapeD and convert to signals
 * @param xmlStrings - Array of XML strings from getxmlGeneral
 * @param filingLinks - Optional array of filing links (same length as xmlStrings)
 * @returns Scraping results with signal IDs
 */
export const processFormDXmlsToSignals = async (
  xmlStrings: string[],
  filingLinks?: string[],
): Promise<{
  total: number;
  successful: number;
  failed: number;
  alreadyExists: number;
  signalsCreated: number;
  signalIds: string[];
  details: Array<{
    accession?: string;
    success: boolean;
    signalIds?: string[];
    error?: string;
  }>;
}> => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔄 Processing ${xmlStrings.length} Form D XMLs → Signals`);
  console.log(`${"=".repeat(60)}\n`);

  const results = {
    total: xmlStrings.length,
    successful: 0,
    failed: 0,
    alreadyExists: 0,
    signalsCreated: 0,
    signalIds: [] as string[],
    details: [] as Array<{
      accession?: string;
      success: boolean;
      signalIds?: string[];
      error?: string;
    }>,
  };

  for (let i = 0; i < xmlStrings.length; i++) {
    const xmlContent = xmlStrings[i];
    const filingLink = filingLinks && filingLinks[i] ? filingLinks[i] : "Unknown";

    console.log(`\n[${"=".repeat(56)}]`);
    console.log(`Processing ${i + 1}/${xmlStrings.length}`);
    console.log(`[${"=".repeat(56)}]`);

    try {
      // Process raw XML with AI agent
      console.log(`🤖 Processing with AI agent...`);
      const parsedData = await extractFormDDataFromParsed(xmlContent);

      if (!parsedData || !parsedData.relatedPersons || parsedData.relatedPersons.length === 0) {
        throw new Error("No related persons extracted from Form D");
      }

      const accession = parsedData.accessionNo || "unknown";

      // Check if already exists
      if (accession !== "unknown") {
        const existingSignals = await Signal.find({ accession }).lean();
        if (existingSignals.length > 0) {
          console.log(`ℹ️  Signal(s) already exist for: ${accession}`);
          results.alreadyExists++;
          const existingIds = existingSignals.map((s) => s._id.toString());
          results.signalIds.push(...existingIds);
          results.details.push({
            accession,
            success: true,
            signalIds: existingIds,
          });
          continue;
        }
      }

      console.log(`✅ Extracted ${parsedData.relatedPersons.length} related person(s)`);
      console.log(`   Issuer: ${parsedData.issuerName}`);
      console.log(`   Offering Type: ${parsedData.offeringType}`);

      // Create minimal FormD object
      const formDData: FormDData = {
        accession: accession,
        filingLink: filingLink,
        rawXml: xmlContent,
        issuerName: parsedData.issuerName,
        filingDate: parsedData.filingDate ? new Date(parsedData.filingDate) : new Date(),
      };

      // Map to signals
      const signals = mapFormDToSignals(parsedData, formDData);

      // Save signals
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
        console.log(
          `✅ Signal created: ${savedSignal.fullName} (${savedSignal.signalSource}) - ${savedSignal.designation}`,
        );
      }

      results.successful++;
      results.signalsCreated += signalIds.length;
      results.signalIds.push(...signalIds);
      results.details.push({
        accession,
        success: true,
        signalIds,
      });

      console.log(`✅ Created ${signalIds.length} signal(s)`);
    } catch (error: any) {
      console.error(`❌ Failed: ${error.message}`);
      results.failed++;
      results.details.push({
        success: false,
        error: error.message,
      });
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`✅ Processing Complete`);
  console.log(`   Total: ${results.total}`);
  console.log(`   Successful: ${results.successful}`);
  console.log(`   Already Exists: ${results.alreadyExists}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Signals Created: ${results.signalsCreated}`);
  console.log(`${"=".repeat(60)}\n`);

  return results;
};

/**
 * Get enrichment statistics for Form D signals
 */
export const getFormDSignalEnrichmentStats = async () => {
  try {
    const total = await Signal.countDocuments({ signalType: "form-d" });
    const pending = await Signal.countDocuments({
      signalType: "form-d",
      contactEnrichmentStatus: "pending",
    });
    const processing = await Signal.countDocuments({
      signalType: "form-d",
      contactEnrichmentStatus: "processing",
    });
    const completed = await Signal.countDocuments({
      signalType: "form-d",
      contactEnrichmentStatus: "completed",
    });
    const failed = await Signal.countDocuments({
      signalType: "form-d",
      contactEnrichmentStatus: "failed",
    });

    const personSignals = await Signal.countDocuments({
      signalType: "form-d",
      signalSource: "Person",
    });
    const companySignals = await Signal.countDocuments({
      signalType: "form-d",
      signalSource: "Company",
    });

    return {
      total,
      byEnrichmentStatus: {
        pending,
        processing,
        completed,
        failed,
      },
      bySignalSource: {
        person: personSignals,
        company: companySignals,
      },
    };
  } catch (error: any) {
    console.error("Error getting Form D signal enrichment stats:", error);
    throw error;
  }
};
