import { SignalNew } from "../../../models/newSignal.model.js";
import {
  extractForm13DataFromParsed,
  mapForm13ToNewSignals,
} from "../../../tools/AiAgents/scraperAgents/liquidity/Form13DParserAgent.js";
// import {
//   extractForm13DataFromParsed,
//   mapForm13ToNewSignals,
// } from "../../../tools/AiAgents/Form13DParserAgent.js";
import { secRequest } from "./commonScraping.service.js";

/**
 * Schedule 13D/G Data structure for mapping
 * Only contains fields used by the mapping function
 */
export interface Form13DGData {
  filingLink: string;
}

/**
 * Scrape Schedule 13D/G from URL and directly convert to Signal(s)

 * @param xmlUrl - Direct URL to Schedule 13D/G XML file or filing link
 * @returns Array of Signal IDs created
 */
export const scrapeForm13DGToSignal = async (xmlUrl: string): Promise<string[]> => {
  try {
    console.log(`\n🔄 Scraping Schedule 13D/G from URL and converting to Signal(s)`);
    console.log(`   URL: ${xmlUrl}`);

    // Extract accession number from URL
    const accessionMatch = xmlUrl.match(/\/(\d{10}-\d{2}-\d{6})/);
    const accession = accessionMatch ? accessionMatch[1] : "";

    if (!accession) {
      throw new Error("Could not extract accession number from URL");
    }

    console.log(`   Accession: ${accession}`);

    // Check if already processed (check if SignalNew exists with this accession)
    const existingSignals = await SignalNew.find({ filingLink: { $regex: accession } }).lean();
    if (existingSignals.length > 0) {
      console.log(`ℹ️  Signal(s) already exist for this accession: ${accession}`);
      console.log(`   Found ${existingSignals.length} existing signal(s)`);
      return existingSignals.map((s) => s._id.toString());
    }

    // Fetch XML content from SEC
    console.log(`📥 Fetching Schedule 13D/G XML...`);
    const xmlContent = await secRequest<string>(xmlUrl, {}, `Schedule 13D/G XML: ${xmlUrl}`);

    if (!xmlContent) {
      throw new Error("Failed to fetch XML content");
    }

    console.log(`✅ XML fetched successfully (${xmlContent.length} characters)`);

    // Process raw XML with AI agent (lightweight approach - no pre-parsing)
    console.log(`🤖 Processing with AI agent (lightweight approach)...`);
    const parsedData = await extractForm13DataFromParsed(xmlContent);

    if (!parsedData || !parsedData.reportingPersons || parsedData.reportingPersons.length === 0) {
      console.warn(`⚠️  No reporting persons extracted from Schedule 13D/G: ${accession}`);
      return [];
    }

    console.log(`✅ Extracted ${parsedData.reportingPersons.length} reporting person(s)`);
    console.log(`   Issuer: ${parsedData.issuerName}`);
    console.log(`   Form Type: ${parsedData.formType}`);

    // Create minimal data object for mapping
    const form13DGData: Form13DGData = {
      filingLink: xmlUrl,
    };

    // Map to signals
    const signals = mapForm13ToNewSignals(parsedData, form13DGData);

    // Save signals to database
    const signalIds: string[] = [];
    for (const signalData of signals) {
      // Check if signal already exists for this entity
      const existingSignal = await SignalNew.findOne({
        filingLink: { $regex: accession },
        fullName: signalData.fullName,
      });

      if (existingSignal) {
        console.log(`ℹ️  Signal already exists for ${signalData.fullName}`);
        signalIds.push(existingSignal._id.toString());
        continue;
      }

      const savedSignal = await SignalNew.create(signalData);
      signalIds.push(savedSignal._id.toString());
      console.log(
        `✅ Signal created: ${savedSignal.fullName} (${savedSignal.signalSource}) - ${savedSignal.form13Data?.percentOfClass || "N/A"} ownership`,
      );
    }

    console.log(`\n✅ Scrape-to-Signal complete. Created ${signalIds.length} signal(s)`);
    return signalIds;
  } catch (error: any) {
    console.error(`❌ Failed to scrape Schedule 13D/G to Signal:`, error.message);
    return [];
  }
};

/**
 * Scrape latest Schedule 13D/G filings from SEC RSS feed and convert directly to Signals
 * @param limit - Maximum number of filings to scrape (default: 20, max: 40)
 * @returns Scraping results with signal IDs
 */
export const scrapeLatestForm13DGsToSignals = async (
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
  const url13D =
    "https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=&type=schedule+13d&owner=include&count=40&action=getcurrent&output=atom";
  const url13G =
    "https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=&type=schedule+13g&owner=include&count=40&action=getcurrent&output=atom";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📡 Scraping Latest Schedule 13D/G from RSS Feed → Signals`);
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

    // Fetch both RSS feeds
    console.log(`📥 Fetching Schedule 13D RSS feed...`);
    const responseData13D = await secRequest(
      url13D,
      {
        headers: {
          Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      "Schedule 13D RSS feed",
    );

    console.log(`📥 Fetching Schedule 13G RSS feed...`);
    const responseData13G = await secRequest(
      url13G,
      {
        headers: {
          Accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      "Schedule 13G RSS feed",
    );

    // Parse both feeds
    const $13D = cheerio.load(responseData13D, { xmlMode: true });
    const $13G = cheerio.load(responseData13G, { xmlMode: true });
    const entries: Array<{ accession: string; link: string; title: string; category: string }> = [];
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
        entries.push({ accession, link, title, category: category || "SCHEDULE 13D" });
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
        entries.push({ accession, link, title, category: category || "SCHEDULE 13G" });
      }
    });

    console.log(`✅ Found ${entries.length} Schedule 13D/G entries in RSS feeds`);

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
          `Schedule 13D/G index: ${entry.accession}`,
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
              `Schedule 13 XML: ${entry.accession}`,
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
            `Schedule 13 TXT: ${entry.accession}`,
          );

          if (txtData && txtData.length > 100) {
            const xmlMatch = txtData.match(/<SC13[DG][\s\S]*?<\/SC13[DG]>/i);
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

        // Process raw XML with AI agent (lightweight)
        console.log(`🤖 Processing with AI agent...`);
        const parsedData = await extractForm13DataFromParsed(xmlContent);

        if (
          !parsedData ||
          !parsedData.reportingPersons ||
          parsedData.reportingPersons.length === 0
        ) {
          throw new Error("No reporting persons extracted from Schedule 13D/G");
        }

        console.log(`✅ Processed ${parsedData.reportingPersons.length} reporting person(s)`);

        // Create minimal Form13DG object
        const form13DGData: Form13DGData = {
          filingLink: xmlUrl || entry.link,
        };

        // Map to signals
        const signals = mapForm13ToNewSignals(parsedData, form13DGData);

        // Save signals
        const signalIds: string[] = [];
        for (const signalData of signals) {
          const savedSignal = await SignalNew.create(signalData);
          signalIds.push(savedSignal._id.toString());
          console.log(
            `✅ Signal created: ${savedSignal.fullName} (${savedSignal.signalSource}) - ${savedSignal.form13Data?.percentOfClass || "N/A"} ownership`,
          );
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
 * Process XML strings from scrapeLatest13DG and convert to signals
 * @param xmlStrings - Array of XML strings from getSchedule13Xml
 * @param filingLinks - Optional array of filing links (same length as xmlStrings)
 * @returns Scraping results with signal IDs
 */
export const processForm13DGXmlsToSignals = async (
  xmlStrings: string[],
  filingLinks?: string[],
): Promise<{
  total: number;
  successful: number;
  failed: number;
  alreadyExists: number;
  signalsCreated: number;
  details: Array<{
    accession?: string;
    success: boolean;
    signalIds?: string[];
    error?: string;
  }>;
}> => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔄 Processing ${xmlStrings.length} Schedule 13D/G XMLs → Signals`);
  console.log(`${"=".repeat(60)}\n`);

  const results = {
    total: xmlStrings.length,
    successful: 0,
    failed: 0,
    alreadyExists: 0,
    signalsCreated: 0,
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
      // Process raw XML with AI agent (lightweight)
      console.log(`🤖 Processing with AI agent...`);
      const parsedData = await extractForm13DataFromParsed(xmlContent);

      if (!parsedData || !parsedData.reportingPersons || parsedData.reportingPersons.length === 0) {
        throw new Error("No reporting persons extracted from Schedule 13D/G");
      }

      const accession = parsedData.accessionNo || "unknown";

      // Check if already exists
      if (accession !== "unknown") {
        const existingSignals = await SignalNew.find({ filingLink: { $regex: accession } }).lean();
        if (existingSignals.length > 0) {
          console.log(`ℹ️  Signal(s) already exist for: ${accession}`);
          results.alreadyExists++;
          results.details.push({
            accession,
            success: true,
            signalIds: existingSignals.map((s) => s._id.toString()),
          });
          continue;
        }
      }

      console.log(`✅ Extracted ${parsedData.reportingPersons.length} reporting person(s)`);
      console.log(`   Issuer: ${parsedData.issuerName}`);
      console.log(`   Form Type: ${parsedData.formType}`);

      // Create minimal Form13DG object
      const form13DGData: Form13DGData = {
        filingLink: filingLink,
      };

      // Map to signals
      const signals = mapForm13ToNewSignals(parsedData, form13DGData);

      // Save signals
      const signalIds: string[] = [];
      for (const signalData of signals) {
        // Check if signal already exists for this entity
        const existingSignal = await SignalNew.findOne({
          filingLink: { $regex: accession },
          fullName: signalData.fullName,
        });

        if (existingSignal) {
          console.log(`ℹ️  Signal already exists for ${signalData.fullName}`);
          signalIds.push(existingSignal._id.toString());
          continue;
        }

        const savedSignal = await SignalNew.create(signalData);
        signalIds.push(savedSignal._id.toString());
        console.log(
          `✅ Signal created: ${savedSignal.fullName} (${savedSignal.signalSource}) - ${savedSignal.form13Data?.percentOfClass || "N/A"} ownership`,
        );
      }

      results.successful++;
      results.signalsCreated += signalIds.length;
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
