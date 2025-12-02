import { InstitutionalFiler } from "../../../models/13FInstitutes.model.js";
import { parseForm13FHoldings, type Holding } from "../../../helpers/form13fHoldingsParser.js";
import { extract13FDataFromParsed } from "../../../tools/AiAgents/scraperAgents/liquidity/Form13FParserAgent.js";
import { batchGetSectors } from "../../../helpers/financialDatasets.helper.js";
import { mapCusipsWithContext } from "../../../helpers/cusipToTicker.helper.js";
import logger from "../../../utils/logger.js";

type Form13FData = {
  accession: string;
  primaryXml: string;
  infoTableXml: string;
  company?: string;
  cik?: string;
};

type ProcessingResult = {
  totalProcessed: number;
  filersCreated: number;
  filersUpdated: number;
  quarterlyReportsAdded: number;
  totalHoldingsSaved: number;
  qoqChangesCalculated: number;
  errors: number;
  errorDetails: string[];
};

export async function processForm13FToInstitutional(
  filings: Form13FData[],
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    totalProcessed: 0,
    filersCreated: 0,
    filersUpdated: 0,
    quarterlyReportsAdded: 0,
    totalHoldingsSaved: 0,
    qoqChangesCalculated: 0,
    errors: 0,
    errorDetails: [],
  };

  logger.info(`🏦 Starting institutional holdings processing for ${filings.length} filings...`);

  for (const filing of filings) {
    try {
      logger.info(`\n📄 Processing filing: ${filing.accession}`);

      const filerData = await extract13FDataFromParsed(filing.primaryXml);

      // Step 2: Parse holdings from information table XML
      // Pass filing date to determine if values are in thousands or actual dollars
      const holdings = await parseForm13FHoldings(filing.infoTableXml, filerData.filingDate);

      // Step 3: Calculate quarter string
      const quarter = getQuarterString(new Date(filerData.periodOfReport));

      // Step 4: Process the quarterly report with QoQ calculations
      const processResult = await upsertQuarterlyReport(
        filerData,
        holdings,
        quarter,
        filing.accession,
      );

      if (processResult.filerCreated) {
        result.filersCreated++;
      } else {
        result.filersUpdated++;
      }

      result.quarterlyReportsAdded++;
      result.totalHoldingsSaved += processResult.holdingsSaved;
      result.qoqChangesCalculated += processResult.qoqCalculated;

      result.totalProcessed++;

      logger.info(
        `✅ Processed ${filerData.managerName}: ${processResult.holdingsSaved} holdings, ${processResult.qoqCalculated} QoQ changes`,
      );
    } catch (err: any) {
      logger.error(`❌ Error processing filing ${filing.accession}: ${err.message}`);
      result.errors++;
      result.errorDetails.push(`${filing.accession}: ${err.message}`);
    }
  }

  logger.info("\n📊 Processing Complete!");
  logger.info(`Total Processed: ${result.totalProcessed}`);
  logger.info(`Filers Created: ${result.filersCreated}`);
  logger.info(`Filers Updated: ${result.filersUpdated}`);
  logger.info(`Quarterly Reports Added: ${result.quarterlyReportsAdded}`);
  logger.info(`Total Holdings Saved: ${result.totalHoldingsSaved}`);
  logger.info(`QoQ Changes Calculated: ${result.qoqChangesCalculated}`);
  logger.info(`Errors: ${result.errors}`);

  return result;
}

/**
 * Upsert filer and add quarterly report with holdings
 */
async function upsertQuarterlyReport(
  filerData: any,
  holdings: Holding[],
  quarter: string,
  accessionNumber: string,
) {
  const cik = filerData.managerCik;

  if (!cik) {
    throw new Error("CIK is required but not found in filer data");
  }

  logger.info(`Processing ${filerData.managerName} (CIK: ${cik}) - Quarter: ${quarter}`);

  // Find or create filer
  let filer = await InstitutionalFiler.findOne({ cik });
  let filerCreated = false;

  if (!filer) {
    // Create new filer
    filerCreated = true;
    filer = new InstitutionalFiler({
      cik,
      filerName: filerData.managerName,
      form13FFileNumber: filerData.form13FFileNumber,
      address: {
        street1: filerData.managerAddress,
        city: filerData.managerCity,
        stateOrCountry: filerData.managerState,
        zipCode: filerData.managerZipCode,
      },
      contactInfo: {
        phone: filerData.reportContactPhone,
        email: filerData.reportContactEmail,
      },
      signature: {
        name: filerData.reportContactName,
        title: filerData.reportContactTitle,
        phone: filerData.reportContactPhone,
        city: filerData.managerCity,
        stateOrCountry: filerData.managerState,
        signatureDate: new Date(filerData.filingDate),
      },
      latestActivity: {
        lastReportedQuarter: quarter,
        lastFilingDate: new Date(filerData.filingDate),
        lastUpdated: new Date(),
      },
      quarterlyReports: [],
      tags: [],
    });

    logger.info(`Created new filer: ${filerData.managerName}`);
  } else {
    // Update filer info
    filer.filerName = filerData.managerName;

    if (filerData.managerAddress || filerData.managerCity) {
      filer.address = {
        street1: filerData.managerAddress || filer.address?.street1,
        city: filerData.managerCity || filer.address?.city,
        state: filerData.managerState || filer.address?.state,
        zip: filerData.managerZipCode || filer.address?.zip,
      };
    }

    logger.info(`Updated existing filer: ${filerData.managerName}`);
  }

  // Check if this quarter already exists
  const existingQuarterIndex = filer.quarterlyReports.findIndex((qr) => qr.quarter === quarter);

  if (existingQuarterIndex !== -1) {
    logger.warn(
      `Quarter ${quarter} already exists for ${filerData.managerName}. Replacing with new data.`,
    );
    filer.quarterlyReports.splice(existingQuarterIndex, 1);
  }

  // Find previous quarter for QoQ calculations
  const previousQuarter = getPreviousQuarter(quarter);
  const twoQuartersAgo = getPreviousQuarter(previousQuarter);

  let previousReport = filer.quarterlyReports.find((qr) => qr.quarter === previousQuarter);

  // If previous quarter not found, try two quarters ago
  if (!previousReport) {
    previousReport = filer.quarterlyReports.find((qr) => qr.quarter === twoQuartersAgo);
    if (previousReport) {
      logger.info(`Using Q-2 (${twoQuartersAgo}) for comparison - Q-1 missing`);
    }
  }

  // Step 3.5: Map CUSIPs to Tickers using AI (with issuer name context for accuracy)
  logger.info(`\n🔍 STEP 3.5: Mapping CUSIPs to Tickers`);
  logger.info(`Total holdings: ${holdings.length}`);

  // Prepare holdings with CUSIP and issuer name for better AI accuracy
  const holdingsForMapping = holdings
    .filter((h) => h.cusip && h.cusip.trim().length === 9 && h.issuerName)
    .map((h) => ({
      cusip: h.cusip,
      issuerName: h.issuerName,
    }));

  logger.info(`Holdings with valid CUSIP + issuer name: ${holdingsForMapping.length}`);
  logger.info(
    `Sample: ${holdingsForMapping
      .slice(0, 3)
      .map((h) => `${h.cusip} (${h.issuerName})`)
      .join(", ")}`,
  );

  let cusipToTickerMap = new Map<string, string>();
  if (holdingsForMapping.length > 0) {
    logger.info(
      `Calling OpenFIGI API to map ALL ${holdingsForMapping.length} CUSIPs to tickers...`,
    );
    // Process ALL holdings in chunks of 10 (rate limit friendly)
    cusipToTickerMap = await mapCusipsWithContext(holdingsForMapping, 10);
    logger.info(
      `✅ API lookup complete: ${cusipToTickerMap.size}/${holdingsForMapping.length} ticker mappings found`,
    );

    // Log sample mappings for verification
    const sampleMappings = Array.from(cusipToTickerMap.entries()).slice(0, 5);
    if (sampleMappings.length > 0) {
      logger.info(`Sample ticker mappings:`);
      sampleMappings.forEach(([cusip, ticker]) => {
        const holding = holdingsForMapping.find((h) => h.cusip === cusip);
        logger.info(`  ${cusip} (${holding?.issuerName || "?"}) → ${ticker}`);
      });
    }

    // Log any holdings that didn't get tickers
    const unmappedCount = holdingsForMapping.length - cusipToTickerMap.size;
    if (unmappedCount > 0) {
      logger.warn(
        `⚠️  ${unmappedCount} holdings did not get ticker mappings (bonds, non-equity, or low confidence)`,
      );
    }
  } else {
    logger.warn(`No valid CUSIPs found to map!`);
  }

  // Add tickers to holdings
  const holdingsWithTickers = holdings.map((holding) => {
    const ticker = cusipToTickerMap.get(holding.cusip) || undefined;
    return {
      ...holding,
      ticker,
    };
  });

  const holdingsWithTickersCount = holdingsWithTickers.filter((h) => h.ticker).length;
  logger.info(
    `✅ Ticker mapping complete: ${holdingsWithTickersCount}/${holdings.length} holdings now have tickers`,
  );

  // Log sample enriched holdings
  const samplesWithTickers = holdingsWithTickers.filter((h) => h.ticker).slice(0, 3);
  if (samplesWithTickers.length > 0) {
    logger.info(`Sample holdings with tickers:`);
    samplesWithTickers.forEach((h) => {
      logger.info(`  ${h.issuerName} (${h.cusip}) → ${h.ticker}`);
    });
  }

  // Step 3.6: Enrich holdings with sector data using tickers
  logger.info(`\n📊 STEP 3.6: Enriching with Sector Data`);
  const tickersToFetch = holdingsWithTickers
    .filter((h) => h.ticker && h.ticker.trim().length > 0)
    .map((h) => h.ticker!);

  const uniqueTickers = Array.from(new Set(tickersToFetch));
  logger.info(`Holdings with tickers: ${tickersToFetch.length}`);
  logger.info(`Unique tickers to fetch sectors for: ${uniqueTickers.length}`);
  logger.info(`Sample tickers: ${uniqueTickers.slice(0, 5).join(", ")}`);

  let sectorMap = new Map<string, string | null>();
  if (uniqueTickers.length > 0) {
    logger.info(`Calling Financial Datasets API for sector data...`);
    sectorMap = await batchGetSectors(uniqueTickers, 100); // 100ms delay between requests
    logger.info(`✅ API returned data for ${sectorMap.size} tickers`);

    // Log sample sector mappings
    const sampleSectors = Array.from(sectorMap.entries())
      .filter(([_, sector]) => sector !== null)
      .slice(0, 5);
    if (sampleSectors.length > 0) {
      logger.info(`Sample sector mappings:`);
      sampleSectors.forEach(([ticker, sector]) => {
        logger.info(`  ${ticker} → ${sector}`);
      });
    }

    // Log how many sectors were null
    const nullCount = Array.from(sectorMap.values()).filter((s) => s === null).length;
    if (nullCount > 0) {
      logger.warn(`${nullCount}/${sectorMap.size} tickers returned null sectors`);
    }
  } else {
    logger.warn(`No tickers available for sector enrichment!`);
  }

  // Add sector to holdings
  const enrichedHoldings = holdingsWithTickers.map((holding) => {
    const sector = holding.ticker ? sectorMap.get(holding.ticker.toUpperCase()) || null : null;
    return {
      ...holding,
      sector,
    };
  });

  const holdingsWithSectorsCount = enrichedHoldings.filter((h) => h.sector).length;
  logger.info(
    `✅ Sector enrichment complete: ${holdingsWithSectorsCount}/${holdings.length} holdings now have sectors`,
  );

  // Log sample fully enriched holdings
  const samplesWithSectors = enrichedHoldings.filter((h) => h.ticker && h.sector).slice(0, 3);
  if (samplesWithSectors.length > 0) {
    logger.info(`Sample fully enriched holdings:`);
    samplesWithSectors.forEach((h) => {
      logger.info(`  ${h.issuerName} → ${h.ticker} → ${h.sector}`);
    });
  }

  // Calculate total portfolio value
  const totalMarketValue = enrichedHoldings.reduce((sum, h) => sum + h.value, 0);

  // Process holdings with QoQ calculations
  const processedHoldings = enrichedHoldings.map((holding) => {
    // Calculate percent of portfolio
    const percentOfPortfolio = (holding.value / totalMarketValue) * 100;

    // Find previous holding by CUSIP
    const previousHolding = previousReport?.holdings?.find((ph) => ph.cusip === holding.cusip);

    // Calculate QoQ changes
    const qoqData = calculateQoQChanges(holding, previousHolding);

    return {
      issuerName: holding.issuerName,
      cusip: holding.cusip,
      titleOfClass: holding.titleOfClass,
      ticker: holding.ticker,
      sector: holding.sector,
      value: holding.value,
      shares: holding.shares,
      shareType: holding.shareType,
      percentOfPortfolio,
      investmentDiscretion: holding.investmentDiscretion,
      votingAuthority: holding.votingAuthority,
      ...qoqData,
    };
  });

  // Check for EXITED positions (in previous quarter but not in current)
  let exitedHoldings: any[] = [];
  if (previousReport && previousReport.holdings) {
    const currentCusips = new Set(holdings.map((h) => h.cusip));
    exitedHoldings = previousReport.holdings
      .filter((ph) => !currentCusips.has(ph.cusip))
      .map((ph) => ({
        issuerName: ph.issuerName,
        cusip: ph.cusip,
        titleOfClass: ph.titleOfClass,
        ticker: ph.ticker,
        value: 0,
        shares: 0,
        shareType: ph.shareType,
        percentOfPortfolio: 0,
        previousValue: ph.value,
        previousShares: ph.shares,
        valueChange: -ph.value,
        valueChangePct: -100,
        sharesChange: -ph.shares,
        sharesChangePct: -100,
        changeType: "EXITED",
      }));

    logger.info(`Found ${exitedHoldings.length} exited positions`);
  }

  // Combine current and exited holdings
  const allHoldings = [...processedHoldings, ...exitedHoldings];

  // Calculate portfolio-level changes
  const portfolioChanges = calculatePortfolioChanges(
    allHoldings,
    totalMarketValue,
    previousReport,
    previousQuarter,
  );

  // Calculate sector breakdown (only for current holdings, not exited)
  logger.info(`\n📈 Calculating sector breakdown...`);
  const sectorBreakdown = calculateSectorBreakdown(processedHoldings, totalMarketValue);

  // Log data being saved
  logger.info(`\n💾 Preparing to save quarterly report:`);
  logger.info(`  Quarter: ${quarter}`);
  logger.info(`  Total Holdings (current): ${enrichedHoldings.length}`);
  logger.info(`  Total Holdings (with exited): ${allHoldings.length}`);
  logger.info(`  Holdings with tickers: ${allHoldings.filter((h) => h.ticker).length}`);
  logger.info(`  Holdings with sectors: ${allHoldings.filter((h) => h.sector).length}`);
  logger.info(`  Sector breakdown entries: ${sectorBreakdown.length}`);

  // Log sample of what will be saved
  const sampleSavedHolding = allHoldings.find((h) => h.ticker && h.sector);
  if (sampleSavedHolding) {
    logger.info(`  Sample holding to be saved:`);
    logger.info(`    Issuer: ${sampleSavedHolding.issuerName}`);
    logger.info(`    CUSIP: ${sampleSavedHolding.cusip}`);
    logger.info(`    Ticker: ${sampleSavedHolding.ticker}`);
    logger.info(`    Sector: ${sampleSavedHolding.sector}`);
    logger.info(`    Value: $${sampleSavedHolding.value.toLocaleString()}`);
  }

  // Create quarterly report object
  const quarterlyReport = {
    quarter,
    periodOfReport: new Date(filerData.periodOfReport),
    filingDate: new Date(filerData.filingDate),
    accessionNumber,
    formType: filerData.formType,
    isAmendment: filerData.formType?.includes("/A") || false,
    amendmentNumber: filerData.amendmentNumber,
    summary: {
      totalHoldingsCount: enrichedHoldings.length, // Excludes exited
      totalMarketValue,
      otherIncludedManagersCount: filerData.otherManagers?.length || 0,
    },
    sectorBreakdown,
    portfolioChanges,
    holdings: allHoldings,
    processedAt: new Date(),
  };

  // Add quarterly report to filer
  filer.quarterlyReports.push(quarterlyReport as any);

  // Sort quarterly reports by date (newest first)
  filer.quarterlyReports.sort((a, b) => b.periodOfReport.getTime() - a.periodOfReport.getTime());

  // Update latest activity
  const latestReport = filer.quarterlyReports[0];
  filer.latestActivity = {
    lastReportedQuarter: latestReport.quarter,
    lastFilingDate: latestReport.filingDate,
    lastUpdated: new Date(),
    currentHoldingsCount: latestReport.summary?.totalHoldingsCount ?? 0,
    currentMarketValue: latestReport.summary?.totalMarketValue ?? 0,
  };

  // Save filer
  logger.info(`\n💾 Saving to database...`);
  await filer.save();
  logger.info(`✅ Filer saved successfully!`);

  // Verify what was saved by reading back
  const savedFiler = await InstitutionalFiler.findOne({ cik }).lean();
  const savedReport = savedFiler?.quarterlyReports?.[0];
  const savedHoldingsWithTickers = savedReport?.holdings?.filter((h: any) => h.ticker) || [];
  const savedHoldingsWithSectors = savedReport?.holdings?.filter((h: any) => h.sector) || [];

  logger.info(`\n🔍 Verification - Data saved to database:`);
  logger.info(`  Holdings in DB: ${savedReport?.holdings?.length || 0}`);
  logger.info(`  Holdings with tickers in DB: ${savedHoldingsWithTickers.length}`);
  logger.info(`  Holdings with sectors in DB: ${savedHoldingsWithSectors.length}`);
  logger.info(`  Sector breakdown in DB: ${savedReport?.sectorBreakdown?.length || 0} sectors`);

  if (savedHoldingsWithTickers.length > 0) {
    const sample = savedHoldingsWithTickers[0] as any;
    logger.info(
      `  Sample from DB: ${sample.issuerName} → ${sample.ticker} → ${sample.sector || "null"}`,
    );
  }

  const qoqCalculated = allHoldings.filter(
    (h) => h.changeType !== "NEW" && h.changeType !== undefined,
  ).length;

  return {
    filerCreated,
    holdingsSaved: allHoldings.length,
    qoqCalculated,
  };
}

/**
 * Calculate QoQ changes for a single holding
 */
function calculateQoQChanges(currentHolding: Holding, previousHolding: any | undefined) {
  if (!previousHolding) {
    // New position
    return {
      previousValue: undefined,
      previousShares: undefined,
      valueChange: undefined,
      valueChangePct: undefined,
      sharesChange: undefined,
      sharesChangePct: undefined,
      changeType: "NEW" as const,
    };
  }

  const valueChange = currentHolding.value - previousHolding.value;
  const valueChangePct =
    previousHolding.value > 0 ? (valueChange / previousHolding.value) * 100 : 0;

  const sharesChange = currentHolding.shares - previousHolding.shares;
  const sharesChangePct =
    previousHolding.shares > 0 ? (sharesChange / previousHolding.shares) * 100 : 0;

  // Determine change type
  let changeType: "NEW" | "INCREASED" | "DECREASED" | "UNCHANGED" | "EXITED" = "UNCHANGED";

  const threshold = 0.01; // 0.01% threshold to account for rounding
  if (Math.abs(sharesChangePct) < threshold) {
    changeType = "UNCHANGED";
  } else if (sharesChange > 0) {
    changeType = "INCREASED";
  } else if (sharesChange < 0) {
    changeType = "DECREASED";
  }

  return {
    previousValue: previousHolding.value,
    previousShares: previousHolding.shares,
    valueChange,
    valueChangePct,
    sharesChange,
    sharesChangePct,
    changeType,
  };
}

/**
 * Calculate portfolio-level changes
 */
function calculatePortfolioChanges(
  holdings: any[],
  totalMarketValue: number,
  previousReport: any | undefined,
  previousQuarter: string,
) {
  if (!previousReport) {
    return {
      previousQuarter: undefined,
      valueChange: undefined,
      valueChangePct: undefined,
      holdingsCountChange: undefined,
      newPositions: holdings.filter((h) => h.changeType === "NEW").length,
      increasedPositions: 0,
      decreasedPositions: 0,
      exitedPositions: 0,
      unchangedPositions: 0,
    };
  }

  const previousValue = previousReport.summary.totalMarketValue;
  const valueChange = totalMarketValue - previousValue;
  const valueChangePct = previousValue > 0 ? (valueChange / previousValue) * 100 : 0;

  const previousHoldingsCount = previousReport.summary.totalHoldingsCount;
  const currentHoldingsCount = holdings.filter((h) => h.changeType !== "EXITED").length;
  const holdingsCountChange = currentHoldingsCount - previousHoldingsCount;

  return {
    previousQuarter,
    valueChange,
    valueChangePct,
    holdingsCountChange,
    newPositions: holdings.filter((h) => h.changeType === "NEW").length,
    increasedPositions: holdings.filter((h) => h.changeType === "INCREASED").length,
    decreasedPositions: holdings.filter((h) => h.changeType === "DECREASED").length,
    exitedPositions: holdings.filter((h) => h.changeType === "EXITED").length,
    unchangedPositions: holdings.filter((h) => h.changeType === "UNCHANGED").length,
  };
}

// /**
//  * Get quarter string from date using fiscal year format (e.g., "FY22Q1")
//  * Fiscal year starts in April:
//  * - Q1: Apr-Jun
//  * - Q2: Jul-Sep
//  * - Q3: Oct-Dec
//  * - Q4: Jan-Mar
//  */
// function getQuarterString(date: Date): string {
//   const year = date.getFullYear();
//   const month = date.getMonth() + 1; // 0-indexed (1-12)

//   let fiscalYear: number;
//   let quarter: number;

//   if (month >= 4 && month <= 6) {
//     // Apr-Jun: Q1
//     quarter = 1;
//     fiscalYear = year;
//   } else if (month >= 7 && month <= 9) {
//     // Jul-Sep: Q2
//     quarter = 2;
//     fiscalYear = year;
//   } else if (month >= 10 && month <= 12) {
//     // Oct-Dec: Q3
//     quarter = 3;
//     fiscalYear = year;
//   } else {
//     // Jan-Mar: Q4
//     quarter = 4;
//     fiscalYear = year - 1; // Previous year's fiscal year
//   }

//   // Format as FY22Q1 (using last 2 digits of fiscal year)
//   const fyShort = fiscalYear.toString().slice(-2);
//   return `FY${fyShort}Q${quarter}`;
// }

/**
 * Get quarter string from date using calendar year format (e.g., "25Q1")
 * Calendar year quarters:
 * - Q1: Jan-Mar
 * - Q2: Apr-Jun
 * - Q3: Jul-Sep
 * - Q4: Oct-Dec
 */
function getQuarterString(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 0-indexed (1-12)

  let quarter: number;

  if (month >= 1 && month <= 3) {
    // Jan-Mar: Q1
    quarter = 1;
  } else if (month >= 4 && month <= 6) {
    // Apr-Jun: Q2
    quarter = 2;
  } else if (month >= 7 && month <= 9) {
    // Jul-Sep: Q3
    quarter = 3;
  } else {
    // Oct-Dec: Q4
    quarter = 4;
  }

  // Format as 25Q1 (using last 2 digits of year)
  const yearShort = year.toString().slice(-2);
  return `${yearShort}Q${quarter}`;
}

/**
 * Get previous quarter string in calendar year format
 * Input: 25Q2, Output: 25Q1
 * Input: 25Q1, Output: 24Q4
 */
function getPreviousQuarter(quarterString: string): string {
  const match = quarterString.match(/(\d{2})Q(\d)/);
  if (!match) {
    throw new Error(`Invalid quarter string: ${quarterString}`);
  }

  let year = parseInt(match[1]);
  let quarter = parseInt(match[2]);

  quarter--;
  if (quarter === 0) {
    quarter = 4;
    year--;
    // Handle year wrap-around (00 -> 99)
    if (year < 0) {
      year = 99;
    }
  }

  // Ensure year is 2 digits with leading zero if needed
  const yearFormatted = year.toString().padStart(2, "0");
  return `${yearFormatted}Q${quarter}`;
}

/**
 * Get institutional holdings statistics
 */
export async function getInstitutionalHoldingsStats() {
  try {
    logger.info("📊 Fetching institutional holdings statistics...");

    // Total filers
    const totalFilers = await InstitutionalFiler.countDocuments();

    // Get all filers with their latest quarter
    const filers = await InstitutionalFiler.find()
      .select("filerName cik latestActivity quarterlyReports")
      .lean();

    // Calculate total holdings across all latest quarters
    let totalHoldings = 0;
    const changeTypeCounts: Record<string, number> = {
      NEW: 0,
      INCREASED: 0,
      DECREASED: 0,
      UNCHANGED: 0,
      EXITED: 0,
    };

    filers.forEach((filer) => {
      if (filer.quarterlyReports && filer.quarterlyReports.length > 0) {
        const latestReport = filer.quarterlyReports[0];
        totalHoldings += latestReport.holdings?.length || 0;

        // Count change types
        latestReport.holdings?.forEach((holding: any) => {
          if (holding.changeType) {
            changeTypeCounts[holding.changeType]++;
          }
        });
      }
    });

    // Top filers by portfolio value
    const topFilers = await InstitutionalFiler.find()
      .sort({ "latestActivity.currentMarketValue": -1 })
      .limit(10)
      .select("filerName cik latestActivity quarterlyReports")
      .lean();

    const topFilersSummary = topFilers.map((filer) => {
      const latestReport = filer.quarterlyReports?.[0];
      return {
        filerName: filer.filerName,
        cik: filer.cik,
        quarter: latestReport?.quarter,
        totalMarketValue: latestReport?.summary?.totalMarketValue,
        totalHoldings: latestReport?.summary?.totalHoldingsCount,
        portfolioChange: latestReport?.portfolioChanges?.totalValueChangePct,
      };
    });

    // Biggest portfolio increases
    const biggestIncreases = await InstitutionalFiler.find({
      "quarterlyReports.0.portfolioChanges.totalValueChangePct": { $exists: true, $gt: 0 },
    })
      .sort({ "quarterlyReports.0.portfolioChanges.totalValueChangePct": -1 })
      .limit(10)
      .select("filerName cik quarterlyReports")
      .lean();

    // Biggest portfolio decreases
    const biggestDecreases = await InstitutionalFiler.find({
      "quarterlyReports.0.portfolioChanges.totalValueChangePct": { $exists: true, $lt: 0 },
    })
      .sort({ "quarterlyReports.0.portfolioChanges.totalValueChangePct": 1 })
      .limit(10)
      .select("filerName cik quarterlyReports")
      .lean();

    return {
      totalFilers,
      totalHoldings,
      changeTypeBreakdown: Object.entries(changeTypeCounts).map(([type, count]) => ({
        _id: type,
        count,
      })),
      topFilers: topFilersSummary,
      biggestIncreases: biggestIncreases.map((f) => ({
        filerName: f.filerName,
        cik: f.cik,
        quarter: f.quarterlyReports?.[0]?.quarter,
        valueChangePct: f.quarterlyReports?.[0]?.portfolioChanges?.totalValueChangePct,
        valueChange: f.quarterlyReports?.[0]?.portfolioChanges?.totalValueChange,
      })),
      biggestDecreases: biggestDecreases.map((f) => ({
        filerName: f.filerName,
        cik: f.cik,
        quarter: f.quarterlyReports?.[0]?.quarter,
        valueChangePct: f.quarterlyReports?.[0]?.portfolioChanges?.totalValueChangePct,
        valueChange: f.quarterlyReports?.[0]?.portfolioChanges?.totalValueChange,
      })),
    };
  } catch (err: any) {
    logger.error(`Error fetching institutional holdings stats: ${err.message}`);
    throw err;
  }
}

/**
 * Calculate sector breakdown for portfolio
 */
function calculateSectorBreakdown(
  holdings: any[],
  totalMarketValue: number,
): Array<{ sector: string; value: number; percentage: number }> {
  logger.info(`Calculating sector breakdown for ${holdings.length} holdings...`);

  // Count how many holdings have sectors
  const holdingsWithSectors = holdings.filter((h) => h.sector && h.sector !== "Unknown");
  logger.info(`  Holdings with sectors: ${holdingsWithSectors.length}/${holdings.length}`);

  // Group holdings by sector
  const sectorTotals = new Map<string, number>();

  holdings.forEach((holding) => {
    const sector = holding.sector || "Unknown";
    const currentValue = sectorTotals.get(sector) || 0;
    sectorTotals.set(sector, currentValue + holding.value);
  });

  // Convert to array and calculate percentages
  const breakdown = Array.from(sectorTotals.entries())
    .map(([sector, value]) => ({
      sector,
      value,
      percentage: totalMarketValue > 0 ? (value / totalMarketValue) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value); // Sort by value descending

  logger.info(`✅ Sector breakdown complete: ${breakdown.length} sectors identified`);
  breakdown.forEach((s) => {
    logger.info(`  ${s.sector}: $${(s.value / 1000).toFixed(2)}K (${s.percentage.toFixed(2)}%)`);
  });

  return breakdown;
}
