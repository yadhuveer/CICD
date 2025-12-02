/**
 * Aircraft and Vessels Data Scraping Service
 *
 * Flow:
 * 1. Download ZIP file from government websites
 * 2. Extract ZIP to get comma-delimited text files
 * 3. Parse text files and extract relevant data
 * 4. Format data to match newSignal schema
 * 5. Save to SignalNewKK collection
 */

import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import unzipper from "unzipper";
import https from "https";
import logger from "../../../utils/logger.js";
import { SignalNew } from "../../../models/newSignal.model.js";
import { enrichAircraftOwnership } from "../../../tools/AiAgents/scraperAgents/nonLiquidity/AircraftEnrichmentAgent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// FAA Aircraft Registry URL
const FAA_AIRCRAFT_URL = "https://registry.faa.gov/database/ReleasableAircraft.zip";

// Temporary directory for downloads
const TEMP_DIR = path.join(__dirname, "../../../../temp");

// Maximum records to process for efficient scraping
const MAX_AIRLINE_RECORDS = 50;

interface AircraftRecord {
  nNumber?: string;
  serialNumber?: string;
  mfrMdlCode?: string;
  engMfrMdl?: string;
  yearMfr?: string;
  typeRegistrant?: string;
  registrantName?: string;
  street?: string;
  street2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  region?: string;
  county?: string;
  country?: string;
  lastActionDate?: string;
  certIssueDate?: string;
  certification?: string;
  typeAircraft?: string;
  typeEngine?: string;
  statusCode?: string;
  modeSTrans?: string;
  fractOwner?: string;
  airworthDate?: string;
  otherNames1?: string;
  otherNames2?: string;
  otherNames3?: string;
  otherNames4?: string;
  otherNames5?: string;
  expirationDate?: string;
  uniqueId?: string;
  kitMfr?: string;
  kitModel?: string;
  modeSTrans2?: string;
}

/**
 * Ensure temp directory exists
 */
const ensureTempDir = async (): Promise<void> => {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
};

/**
 * Download ZIP file from FAA
 */
const downloadAircraftZip = async (): Promise<string> => {
  try {
    await ensureTempDir();
    const zipPath = path.join(TEMP_DIR, "ReleasableAircraft.zip");

    logger.info("Downloading aircraft data from FAA...");

    const response = await axios({
      method: "GET",
      url: FAA_AIRCRAFT_URL,
      responseType: "stream",
    });

    await pipeline(response.data, createWriteStream(zipPath));

    logger.info(`Aircraft data downloaded successfully to ${zipPath}`);
    return zipPath;
  } catch (error) {
    logger.error("Error downloading aircraft ZIP:", error);
    throw error;
  }
};

/**
 * Extract ZIP file
 */
const extractZip = async (zipPath: string): Promise<string> => {
  try {
    const extractDir = path.join(TEMP_DIR, "aircraft_data");

    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
    }

    logger.info("Extracting aircraft ZIP file...");

    await fs
      .createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: extractDir }))
      .promise();

    logger.info(`ZIP extracted to ${extractDir}`);
    return extractDir;
  } catch (error) {
    logger.error("Error extracting ZIP:", error);
    throw error;
  }
};

/**
 * Parse master aircraft registration file
 * File: MASTER.txt
 * Format: Comma-delimited
 */
const parseMasterFile = async (extractDir: string): Promise<AircraftRecord[]> => {
  const masterFilePath = path.join(extractDir, "MASTER.txt");

  if (!fs.existsSync(masterFilePath)) {
    throw new Error(`MASTER.txt not found in ${extractDir}`);
  }

  logger.info("Parsing MASTER.txt file...");

  const records: AircraftRecord[] = [];
  const fileStream = createReadStream(masterFilePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber++;

    // Skip empty lines
    if (!line.trim()) continue;

    try {
      const fields = line.split(",");

      // Parse according to FAA MASTER file structure
      // Reference: https://www.faa.gov/licenses_certificates/aircraft_certification/aircraft_registry/releasable_aircraft_download
      const record: AircraftRecord = {
        nNumber: fields[0]?.trim(),
        serialNumber: fields[1]?.trim(),
        mfrMdlCode: fields[2]?.trim(),
        engMfrMdl: fields[3]?.trim(),
        yearMfr: fields[4]?.trim(),
        typeRegistrant: fields[5]?.trim(),
        registrantName: fields[6]?.trim(),
        street: fields[7]?.trim(),
        street2: fields[8]?.trim(),
        city: fields[9]?.trim(),
        state: fields[10]?.trim(),
        zipCode: fields[11]?.trim(),
        region: fields[12]?.trim(),
        county: fields[13]?.trim(),
        country: fields[14]?.trim(),
        lastActionDate: fields[15]?.trim(),
        certIssueDate: fields[16]?.trim(),
        certification: fields[17]?.trim(),
        typeAircraft: fields[18]?.trim(),
        typeEngine: fields[19]?.trim(),
        statusCode: fields[20]?.trim(),
        modeSTrans: fields[21]?.trim(),
        fractOwner: fields[22]?.trim(),
        airworthDate: fields[23]?.trim(),
        otherNames1: fields[24]?.trim(),
        otherNames2: fields[25]?.trim(),
        otherNames3: fields[26]?.trim(),
        otherNames4: fields[27]?.trim(),
        otherNames5: fields[28]?.trim(),
        expirationDate: fields[29]?.trim(),
        uniqueId: fields[30]?.trim(),
        kitMfr: fields[31]?.trim(),
        kitModel: fields[32]?.trim(),
        modeSTrans2: fields[33]?.trim(),
      };

      records.push(record);
    } catch (error) {
      logger.warn(`Error parsing line ${lineNumber}:`, error);
    }
  }

  logger.info(`Parsed ${records.length} aircraft records`);
  return records;
};

/**
 * Filter and format aircraft data for recent and relevant records
 */
const filterRecentAircraft = (records: AircraftRecord[]): AircraftRecord[] => {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - 6); // Last 6 months

  return records.filter((record) => {
    // Filter for active registrations
    if (record.statusCode !== "V" && record.statusCode !== "N") {
      return false;
    }

    // Check if registration is recent
    if (record.certIssueDate) {
      try {
        const certDate = new Date(record.certIssueDate);
        if (certDate >= cutoffDate) {
          return true;
        }
      } catch (error) {
        // Invalid date format
      }
    }

    // Check last action date
    if (record.lastActionDate) {
      try {
        const actionDate = new Date(record.lastActionDate);
        if (actionDate >= cutoffDate) {
          return true;
        }
      } catch (error) {
        // Invalid date format
      }
    }

    return false;
  });
};

/**
 * Convert aircraft record to newSignal format
 */
const convertToSignal = (record: AircraftRecord) => {
  const fullName = record.registrantName || "Unknown Registrant";
  const location = [record.city, record.state, record.country].filter(Boolean).join(", ");

  const address = [record.street, record.street2, record.city, record.state, record.zipCode]
    .filter(Boolean)
    .join(", ");

  return {
    signalSource: "Person" as const,
    signalType: "Aircraft Registration",
    filingType: "ma-event" as const,
    filingDate: record.certIssueDate ? new Date(record.certIssueDate) : undefined,
    fullName,
    location,
    designation: record.typeRegistrant,
    companyAddress: address,
    insights: `Aircraft Registration - N-Number: ${record.nNumber}, Type: ${record.typeAircraft}, Manufacturer: ${record.mfrMdlCode}`,
    processingStatus: "Processed" as const,
    contactEnrichmentStatus: "pending" as const,
  };
};

/**
 * Save aircraft records to database
 */
const saveToDatabase = async (records: AircraftRecord[]): Promise<void> => {
  try {
    logger.info(`Saving ${records.length} aircraft records to database...`);

    let savedCount = 0;
    let errorCount = 0;

    for (const record of records) {
      try {
        const signalData = convertToSignal(record);

        // Check if record already exists
        const existing = await SignalNew.findOne({
          fullName: signalData.fullName,
          filingType: "ma-event",
          insights: { $regex: `N-Number: ${record.nNumber}` },
        });

        if (!existing) {
          await SignalNew.create(signalData);
          savedCount++;
        }
      } catch (error) {
        logger.warn("Error saving record:", error);
        errorCount++;
      }
    }

    logger.info(`Successfully saved ${savedCount} records, ${errorCount} errors`);
  } catch (error) {
    logger.error("Error in saveToDatabase:", error);
    throw error;
  }
};

/**
 * Cleanup temporary files
 */
const cleanup = async (): Promise<void> => {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
      logger.info("Cleaned up temporary files");
    }
  } catch (error) {
    logger.warn("Error during cleanup:", error);
  }
};

/**
 * Main function to scrape aircraft data
 */
export const scrapeAircraftData = async (): Promise<void> => {
  try {
    logger.info("Starting aircraft data scraping...");

    // Step 1: Download ZIP
    const zipPath = await downloadAircraftZip();

    // Step 2: Extract ZIP
    const extractDir = await extractZip(zipPath);

    // Step 3: Parse MASTER file
    const allRecords = await parseMasterFile(extractDir);

    // Step 4: Filter recent and relevant records
    const recentRecords = filterRecentAircraft(allRecords);
    logger.info(`Filtered to ${recentRecords.length} recent aircraft registrations`);

    // Step 5: Save to database
    await saveToDatabase(recentRecords);

    // Step 6: Cleanup
    await cleanup();

    logger.info("Aircraft data scraping completed successfully");
  } catch (error) {
    logger.error("Error in scrapeAircraftData:", error);
    await cleanup(); // Cleanup even on error
    throw error;
  }
};

/**
 * Aircraft Ownership Transaction Record Interface
 * Tracks HNI (High Net Worth Individual) aircraft purchases/registrations
 */
interface AircraftOwnershipRecord {
  // Aircraft Details
  nNumber?: string; // N-Number (registration)
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  yearManufactured?: string;
  aircraftType?: string;

  // Owner Details (The HNI we're tracking)
  ownerName?: string;
  ownerType?: string; // Individual, LLC, Corporation, etc.
  ownerAddress?: string;
  ownerCity?: string;
  ownerState?: string;
  ownerZipCode?: string;
  ownerCountry?: string;

  // Transaction Details
  lastActionDate?: string; // YYYYMMDD - Recent ownership change/update
  certIssueDate?: string; // YYYYMMDD - Original registration
  expirationDate?: string;
  statusCode?: string;

  // Additional Owner Names (co-owners, trust names, etc.)
  otherNames?: string[];
}

/**
 * Helper: Get owner type description from code
 */
const getOwnerTypeDescription = (code: string): string => {
  const types: Record<string, string> = {
    "1": "Individual",
    "2": "Partnership",
    "3": "Corporation",
    "4": "Co-Owned",
    "5": "Government",
    "7": "LLC",
    "8": "Non-Citizen Corporation",
    "9": "Non-Citizen Co-Owned",
  };
  return types[code] || "Unknown";
};

/**
 * Helper: Parse date from YYYYMMDD format
 */
const parseFAADate = (dateStr: string): Date | undefined => {
  if (!dateStr || dateStr.trim().length !== 8) return undefined;
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  return new Date(`${year}-${month}-${day}`);
};

/**
 * Helper: Check if date is within last N days
 */
const isWithinLastDays = (dateStr: string, days: number): boolean => {
  const date = parseFAADate(dateStr);
  if (!date) return false;

  const now = new Date();
  const cutoffDate = new Date();
  cutoffDate.setDate(now.getDate() - days);

  return date >= cutoffDate && date <= now;
};

/**
 * Efficient streaming download and extraction of aircraft ownership data from FAA ZIP
 * Tracks HNI aircraft purchases by filtering for recent transactions (last 30 days)
 */
const scrapeAircraftOwnershipTransactions = async (): Promise<void> => {
  return new Promise((resolve, reject) => {
    logger.info("Starting aircraft ownership transaction scraping...");
    logger.info("Filtering for transactions in last 30 days...");

    let processed = 0;
    let scanned = 0;
    const ownershipRecords: AircraftOwnershipRecord[] = [];

    https
      .get(FAA_AIRCRAFT_URL, (response) => {
        logger.info(`Response received: ${response.statusCode}`);

        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error("Redirect location not provided"));
            return;
          }
          logger.info(`Following redirect to: ${redirectUrl}`);
          https
            .get(redirectUrl, (redirectResponse) => {
              handleResponse(redirectResponse);
            })
            .on("error", reject);
          return;
        }

        handleResponse(response);

        function handleResponse(res: any) {
          let bytesReceived = 0;
          const totalBytes = parseInt(res.headers["content-length"] || "0");
          let lastProgress = 0;

          res.on("data", (chunk: Buffer) => {
            bytesReceived += chunk.length;
            const progress = Math.floor((bytesReceived / totalBytes) * 100);
            if (progress >= lastProgress + 10) {
              logger.info(
                `Downloaded: ${progress}% (${(bytesReceived / 1024 / 1024).toFixed(1)} MB) - Found ${processed} records`,
              );
              lastProgress = progress;
            }
          });

          const unzipStream = res.pipe(unzipper.Parse());

          unzipStream.on("entry", async (entry: any) => {
            const fileName = entry.path;

            // Process MASTER.txt which contains ownership and transaction data
            if (!fileName.endsWith("MASTER.txt")) {
              entry.autodrain();
              return;
            }

            // If we've already collected enough, skip
            if (processed >= MAX_AIRLINE_RECORDS) {
              entry.autodrain();
              return;
            }

            try {
              logger.info(`Processing ${fileName}...`);
              const chunks: Buffer[] = [];

              for await (const chunk of entry) {
                chunks.push(chunk);
              }

              const fileData = Buffer.concat(chunks).toString("utf8");
              const lines = fileData.split("\n");

              // Skip header row
              for (let i = 1; i < lines.length && processed < MAX_AIRLINE_RECORDS; i++) {
                const line = lines[i];
                if (!line.trim()) continue;

                scanned++;
                if (scanned % 100000 === 0) {
                  logger.info(
                    `Scanned ${scanned} records, found ${processed} recent transactions...`,
                  );
                }

                try {
                  const fields = line.split(",");

                  // Field 15: LAST ACTION DATE (YYYYMMDD)
                  const lastActionDate = fields[15]?.trim();

                  // Only process transactions from last 30 days
                  if (!isWithinLastDays(lastActionDate, 30)) {
                    continue;
                  }

                  // Field 18: TYPE AIRCRAFT (4 = Large aircraft, good indicator of HNI)
                  const aircraftType = fields[18]?.trim();

                  // Field 5: TYPE REGISTRANT
                  const ownerTypeCode = fields[5]?.trim();

                  // Filter: Large aircraft (type 4) owned by individuals (type 1) or LLCs (type 7)
                  // These are most likely HNI purchases
                  if (aircraftType === "4" && (ownerTypeCode === "1" || ownerTypeCode === "7")) {
                    const record: AircraftOwnershipRecord = {
                      // Aircraft Details
                      nNumber: fields[0]?.trim(),
                      serialNumber: fields[1]?.trim(),
                      manufacturer: fields[2]?.trim(),
                      model: fields[3]?.trim(),
                      yearManufactured: fields[4]?.trim(),
                      aircraftType: aircraftType,

                      // Owner Details (The HNI)
                      ownerName: fields[6]?.trim(),
                      ownerType: getOwnerTypeDescription(ownerTypeCode),
                      ownerAddress: fields[7]?.trim(),
                      ownerCity: fields[9]?.trim(),
                      ownerState: fields[10]?.trim(),
                      ownerZipCode: fields[11]?.trim(),
                      ownerCountry: fields[14]?.trim(),

                      // Transaction Details
                      lastActionDate: lastActionDate,
                      certIssueDate: fields[16]?.trim(),
                      expirationDate: fields[29]?.trim(),
                      statusCode: fields[20]?.trim(),

                      // Additional Names
                      otherNames: [
                        fields[24]?.trim(),
                        fields[25]?.trim(),
                        fields[26]?.trim(),
                        fields[27]?.trim(),
                        fields[28]?.trim(),
                      ].filter((name) => name && name.length > 0),
                    };

                    ownershipRecords.push(record);
                    processed++;

                    if (processed % 10 === 0) {
                      logger.info(`✓ Found ${processed} HNI aircraft transactions`);
                    }
                  }
                } catch (err: any) {
                  logger.warn(`Error parsing line ${i}: ${err.message}`);
                }
              }

              logger.info(
                `✓ Processed ${fileName}. Found ${processed} HNI transactions (scanned ${scanned} total records)`,
              );

              // Stop download if we have enough
              if (processed >= MAX_AIRLINE_RECORDS) {
                logger.info("✓ Target reached! Stopping download...");
                res.destroy();
                unzipStream.destroy();
              }
            } catch (err: any) {
              logger.error(`Error processing ${fileName}:`, err.message);
              entry.autodrain();
            }
          });

          unzipStream.on("error", (err: any) => {
            // Don't treat stream destruction as an error
            if (err.message.includes("unexpected end") && processed >= MAX_AIRLINE_RECORDS) {
              logger.info(`✓ Extraction complete. Total saved: ${processed}`);
              saveAircraftOwnershipToDatabase(ownershipRecords).then(resolve).catch(reject);
            } else {
              logger.error("Stream error:", err.message);
              reject(err);
            }
          });

          unzipStream.on("close", () => {
            logger.info(`✓ Extraction complete. Total saved: ${processed}`);
            saveAircraftOwnershipToDatabase(ownershipRecords).then(resolve).catch(reject);
          });

          unzipStream.on("finish", () => {
            if (processed < MAX_AIRLINE_RECORDS) {
              logger.info(`✓ Finished processing. Total saved: ${processed}`);
              saveAircraftOwnershipToDatabase(ownershipRecords).then(resolve).catch(reject);
            }
          });
        }
      })
      .on("error", (err: Error) => {
        logger.error("Download error:", err.message);
        reject(err);
      });
  });
};

/**
 * Helper: Get aircraft type description from code
 */
const getAircraftTypeDescription = (code: string): string => {
  const types: Record<string, string> = {
    "1": "Glider",
    "2": "Balloon",
    "3": "Blimp/Dirigible",
    "4": "Fixed Wing Single Engine",
    "5": "Fixed Wing Multi Engine",
    "6": "Rotorcraft",
    "7": "Weight-Shift-Control",
    "8": "Powered Parachute",
    "9": "Gyroplane",
  };
  return types[code] || "Unknown";
};

/**
 * Helper: Get engine type description from code
 */
const getEngineTypeDescription = (code: string): string => {
  const types: Record<string, string> = {
    "0": "None",
    "1": "Reciprocating",
    "2": "Turbo-prop",
    "3": "Turbo-shaft",
    "4": "Turbo-jet",
    "5": "Turbo-fan",
    "6": "Ramjet",
    "7": "2 Cycle",
    "8": "4 Cycle",
    "9": "Unknown",
    "10": "Electric",
    "11": "Rotary",
  };
  return types[code] || "Unknown";
};

/**
 * Helper: Get status code description
 */
const getStatusDescription = (code: string): string => {
  const statuses: Record<string, string> = {
    V: "Valid",
    R: "Revoked",
    P: "Pending",
    E: "Expired",
    C: "Cancelled",
  };
  return statuses[code] || "Unknown";
};

/**
 * Helper: Determine wealth indicators based on aircraft details
 */
const getWealthIndicators = (record: AircraftOwnershipRecord): string[] => {
  const indicators: string[] = [];

  // Check for luxury aircraft manufacturers
  const luxuryManufacturers = [
    "GULFSTREAM",
    "BOMBARDIER",
    "DASSAULT",
    "CESSNA CITATION",
    "EMBRAER PHENOM",
    "EMBRAER LEGACY",
    "BOEING",
    "AIRBUS",
  ];

  const mfr = record.manufacturer?.toUpperCase() || "";
  if (luxuryManufacturers.some((luxury) => mfr.includes(luxury))) {
    indicators.push("Luxury Aircraft");
  }

  // Aircraft type indicates wealth
  if (record.aircraftType === "4" || record.aircraftType === "5") {
    indicators.push("Private Jet Owner");
  }

  // Recent purchase
  const actionDate = parseFAADate(record.lastActionDate || "");
  if (actionDate && actionDate >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) {
    indicators.push("Recent Acquisition");
  }

  // LLC ownership often indicates wealth management
  if (record.ownerType === "LLC") {
    indicators.push("LLC-Structured Ownership");
  }

  // Trust or co-owners indicate family office/wealth planning
  if (record.otherNames && record.otherNames.length > 0) {
    indicators.push("Trust/Family Office Structure");
  }

  return indicators;
};

/**
 * Convert aircraft ownership record to newSignal format with AI enrichment
 * Maps HNI aircraft purchases to the SignalNew schema with structured aircraftOwnershipData
 */
const convertOwnershipToSignal = async (record: AircraftOwnershipRecord) => {
  const actionDate = parseFAADate(record.lastActionDate || "");
  const certDate = parseFAADate(record.certIssueDate || "");
  const expDate = parseFAADate(record.expirationDate || "");

  // Determine if this is a purchase (new registration) or ownership change
  const isNewPurchase = record.lastActionDate === record.certIssueDate;
  const transactionType = isNewPurchase ? "New Registration" : "Ownership Transfer";

  // Build location from owner details
  const location = [record.ownerCity, record.ownerState, record.ownerCountry]
    .filter(Boolean)
    .join(", ");

  // Build complete address
  const address = [record.ownerAddress, record.ownerCity, record.ownerState, record.ownerZipCode]
    .filter(Boolean)
    .join(", ");

  // Get descriptive names for human readability
  const aircraftTypeDesc = getAircraftTypeDescription(record.aircraftType || "");
  const engineTypeDesc = getEngineTypeDescription(record.model || "");
  const statusDesc = getStatusDescription(record.statusCode || "");

  // Prepare enriched record for AI analysis
  const enrichedRecord = {
    ...record,
    aircraftTypeDescription: aircraftTypeDesc,
    engineTypeDescription: engineTypeDesc,
    statusDescription: statusDesc,
    transactionType,
  };

  // ✨ AI ENRICHMENT - Get insights, wealth indicators, lead scoring
  let aiEnrichment;
  try {
    aiEnrichment = await enrichAircraftOwnership(enrichedRecord);
  } catch (error: any) {
    logger.warn(
      `AI enrichment failed for ${record.ownerName}, using fallback data:`,
      error.message,
    );
    // Fallback if AI fails - basic signalSource detection
    const ownerName = record.ownerName || "Unknown";
    const isCompany =
      ownerName.includes("LLC") ||
      ownerName.includes("Inc") ||
      ownerName.includes("Corp") ||
      ownerName.includes("Aviation") ||
      ownerName.includes("Airlines") ||
      ownerName.includes("Jet");

    aiEnrichment = {
      signalSource: isCompany ? ("Company" as const) : ("Person" as const),
      summary: `${record.ownerName || "Unknown owner"} owns a ${record.manufacturer || "aircraft"} ${record.model || ""} in ${record.ownerState || "Unknown location"}`,
      leadQualityScore: 50,
      wealthIndicators: getWealthIndicators(record),
      estimatedNetWorth: "Unknown",
      lifestyleSignals: ["Private aircraft owner"],
      businessContext: "Aircraft owner - requires additional research",
      leadPotential: "Potential for aviation-related financial services",
      keyTakeaways: ["Aircraft ownership transaction detected"],
      aircraftCategory: "mid-tier" as const,
      usageCategory: "personal" as const,
      estimatedAircraftValue: "Unknown",
    };
  }

  // Use AI summary as main insights, fallback to manual if needed
  const insights =
    aiEnrichment.summary ||
    `${transactionType} - ${record.ownerType} acquired ${aircraftTypeDesc.toLowerCase()} (${record.manufacturer} ${record.model})`;

  // Determine correct filingType based on transaction
  const filingType =
    transactionType === "New Registration"
      ? ("aircraft-registration" as const)
      : ("aircraft-transfer" as const);

  return {
    signalSource: aiEnrichment.signalSource, // ✅ AI-determined Person vs Company
    signalType: "Aircraft and Vessels",
    filingType, // ✅ Specific: "aircraft-registration" or "aircraft-transfer"
    filingDate: actionDate || certDate || new Date(),

    // Owner (HNI) information - use fullName for both Person and Company
    fullName: record.ownerName || "Unknown Owner",
    designation: aiEnrichment.signalSource === "Person" ? record.ownerType : undefined, // ✅ Only for Person
    location,
    // For companies, use companyName and companyAddress
    companyName: aiEnrichment.signalSource === "Company" ? record.ownerName : undefined,
    companyAddress: aiEnrichment.signalSource === "Company" ? address : undefined,

    // Additional owner names (co-owners, trusts)
    keyPeople:
      record.otherNames && record.otherNames.length > 0
        ? record.otherNames.map((name) => ({
            fullName: name,
            relationship: "Co-owner/Trust",
            sourceOfInformation: "FAA Aircraft Registry",
          }))
        : undefined,

    // AI-generated insights as main signal insight
    insights,
    aiModelUsed: "gpt-4o-mini",

    processingStatus: "Processed" as const,
    contactEnrichmentStatus: "pending" as const,

    // ✅ NEW STRUCTURED SUB-SCHEMA WITH AI INSIGHTS
    aircraftOwnershipData: {
      // AI-Generated Insights (simplified)
      insights: {
        transactionContext: aiEnrichment.transactionContext,
        estimatedValue: aiEnrichment.estimatedValue,
        businessContext: aiEnrichment.businessContext,
      },

      // Structured Owner Information
      owner: {
        fullName: record.ownerName,
        ownerType: record.ownerType as any,
        location,
        address,
        city: record.ownerCity,
        state: record.ownerState,
        zipCode: record.ownerZipCode,
        country: record.ownerCountry,
        coOwners: record.otherNames,
        trustStructure:
          record.ownerType === "Trust" || (record.otherNames && record.otherNames.length > 0)
            ? `Trust-based ownership with ${record.otherNames?.length || 0} co-owners/trustees`
            : undefined,
      },

      // Aircraft Technical Specs
      aircraft: {
        nNumber: record.nNumber,
        serialNumber: record.serialNumber,
        manufacturer: record.manufacturer,
        model: record.model,
        aircraftType: aircraftTypeDesc,
        engineType: engineTypeDesc,
        yearManufactured: record.yearManufactured,
        statusCode: statusDesc,
        estimatedValue: aiEnrichment.estimatedValue,
        aircraftCategory: aiEnrichment.aircraftCategory,
        usageCategory: aiEnrichment.usageCategory,
      },

      // Transaction Information
      transaction: {
        transactionType: transactionType as any,
        transactionDate: actionDate,
        certIssueDate: certDate,
        expirationDate: expDate,
        sourceUrl: "https://registry.faa.gov/aircraftinquiry",
        sourceRegistry: "FAA" as const,
        registryFileDate: new Date(),
      },
    },
  };
};

/**
 * Save aircraft ownership records to database with AI enrichment
 */
const saveAircraftOwnershipToDatabase = async (
  records: AircraftOwnershipRecord[],
): Promise<void> => {
  try {
    logger.info(`Saving ${records.length} aircraft ownership records to database...`);
    logger.info(`🤖 AI enrichment will be applied to each record`);

    let savedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const record of records) {
      try {
        // ✨ AI ENRICHMENT - This is now async
        const signalData = await convertOwnershipToSignal(record);

        // Check if record already exists (by N-Number and owner)
        const existing = await SignalNew.findOne({
          fullName: signalData.fullName,
          signalType: "Aircraft and Vessels",
          "aircraftOwnershipData.aircraft.nNumber": record.nNumber,
        });

        if (!existing) {
          await SignalNew.create(signalData);
          savedCount++;

          if (savedCount % 10 === 0) {
            logger.info(`Saved ${savedCount}/${records.length} records (with AI enrichment)...`);
          }
        } else {
          skippedCount++;
        }
      } catch (error) {
        logger.warn(`Error saving ownership record for ${record.ownerName}:`, error);
        errorCount++;
      }
    }

    logger.info(
      `✓ Completed: ${savedCount} saved, ${skippedCount} skipped (duplicates), ${errorCount} errors`,
    );
  } catch (error) {
    logger.error("Error in saveAircraftOwnershipToDatabase:", error);
    throw error;
  }
};

/**
 * Main function to scrape HNI aircraft ownership transactions (efficient version)
 * Renamed from scrapeAirlinesData to reflect actual purpose
 */
export const scrapeAirlinesData = async (): Promise<void> => {
  try {
    logger.info("Starting HNI aircraft ownership transaction scraping...");
    await scrapeAircraftOwnershipTransactions();
    logger.info("Aircraft ownership transaction scraping completed successfully");
  } catch (error) {
    logger.error("Error in scrapeAirlinesData:", error);
    throw error;
  }
};
