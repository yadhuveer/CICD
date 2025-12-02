import { scrapeLatestForm4sToNewSignals } from "./scraping/liquiditySignals/form4PipelineNew.service.js";
import { enrichSignalsBatch, BatchEnrichmentResult } from "./contactEnrichment.service.js";
import logger from "../utils/logger.js";

// =====================================
// TYPES & INTERFACES
// =====================================

export type Form4PipelineResult = {
  success: boolean;
  scrapingResults: {
    total: number;
    successful: number;
    failed: number;
    alreadyExists: number;
    signalsCreated: number;
  };
  enrichmentResults: {
    totalSignals: number;
    successful: number;
    failed: number;
    alreadyProcessed: number;
    contactsCreated: number;
    contactsMatched: number;
    noContactFound: number;
  };
  signalIds: string[];
  timestamp: string;
  message: string;
  error?: string;
};

export type Form4PipelineOptions = {
  scrapeLimit?: number;
};

// =====================================
// CORE PIPELINE ORCHESTRATION
// =====================================

export const executeForm4FullPipeline = async (
  options: Form4PipelineOptions = {},
): Promise<Form4PipelineResult> => {
  const { scrapeLimit = 20 } = options;
  const timestamp = new Date().toISOString();

  logger.info(`\n${"=".repeat(70)}`);
  logger.info(`🚀 FORM 4 FULL PIPELINE STARTED`);
  logger.info(`   Scrape Limit: ${scrapeLimit}`);
  logger.info(`   Timestamp: ${timestamp}`);
  logger.info(`${"=".repeat(70)}\n`);

  const result: Form4PipelineResult = {
    success: false,
    scrapingResults: {
      total: 0,
      successful: 0,
      failed: 0,
      alreadyExists: 0,
      signalsCreated: 0,
    },
    enrichmentResults: {
      totalSignals: 0,
      successful: 0,
      failed: 0,
      alreadyProcessed: 0,
      contactsCreated: 0,
      contactsMatched: 0,
      noContactFound: 0,
    },
    signalIds: [],
    timestamp,
    message: "",
  };

  try {
    // =====================================
    // STEP 1: SCRAPE FORM 4s
    // =====================================
    logger.info(`📡 STEP 1: Scraping Form 4s from SEC...`);

    // scrape latest Form 4s and create signals
    const scrapingResults = await scrapeLatestForm4sToNewSignals(scrapeLimit);

    // Extract all signal IDs from scraping results
    const allSignalIds: string[] = [];
    for (const detail of scrapingResults.details) {
      if (detail.success && detail.signalIds) {
        allSignalIds.push(...detail.signalIds);
      }
    }

    result.scrapingResults = {
      total: scrapingResults.total,
      successful: scrapingResults.successful,
      failed: scrapingResults.failed,
      alreadyExists: scrapingResults.alreadyExists,
      signalsCreated: scrapingResults.signalsCreated,
    };
    result.signalIds = allSignalIds;

    logger.info(`✅ STEP 1 COMPLETE: Scraped ${allSignalIds.length} signal(s)`);
    logger.info(`   Total processed: ${scrapingResults.total}`);
    logger.info(`   Successful: ${scrapingResults.successful}`);
    logger.info(`   Failed: ${scrapingResults.failed}`);
    logger.info(`   Already exists: ${scrapingResults.alreadyExists}`);
    logger.info(`   New signals created: ${scrapingResults.signalsCreated}\n`);

    // Check if we have signals to enrich
    if (allSignalIds.length === 0) {
      logger.warn(`⚠️  No signals to enrich. Pipeline complete.`);
      result.success = true;
      result.message =
        "Pipeline completed successfully, but no new signals were created to enrich.";
      return result;
    }

    // =====================================
    // STEP 2: ENRICH SIGNALS with CONTACT DATA
    // =====================================

    logger.info(`🔍 STEP 2: Enriching ${allSignalIds.length} signal(s) with contact data...`);

    // Main function to enrich signals in batch with signal IDs
    const enrichmentResults: BatchEnrichmentResult = await enrichSignalsBatch(allSignalIds);

    result.enrichmentResults = {
      totalSignals: enrichmentResults.totalSignals,
      successful: enrichmentResults.successful,
      failed: enrichmentResults.failed,
      alreadyProcessed: enrichmentResults.alreadyProcessed,
      contactsCreated: enrichmentResults.contactsCreated,
      contactsMatched: enrichmentResults.contactsMatched,
      noContactFound: enrichmentResults.noContactFound,
    };

    logger.info(`✅ STEP 2 COMPLETE: Enriched ${allSignalIds.length} signal(s)`);
    logger.info(`   Total signals: ${enrichmentResults.totalSignals}`);
    logger.info(`   Successful: ${enrichmentResults.successful}`);
    logger.info(`   Failed: ${enrichmentResults.failed}`);
    logger.info(`   Already processed: ${enrichmentResults.alreadyProcessed}`);
    logger.info(`   Contacts created: ${enrichmentResults.contactsCreated}`);
    logger.info(`   Contacts matched: ${enrichmentResults.contactsMatched}`);
    logger.info(`   No contact found: ${enrichmentResults.noContactFound}\n`);

    // =====================================
    // STEP 3: INJECT INSIGHTS
    // =====================================
    /**
     * we have raw xml we can send into the insights agent to get insights
     * but this location we dont have raw xml stored against signal
     */

    // =====================================
    // FINAL RESULT
    // =====================================
    result.success = true;
    result.message = `Form 4 full pipeline completed successfully. Scraped ${allSignalIds.length} signal(s) and enriched ${enrichmentResults.successful} of them.`;

    logger.info(`${"=".repeat(70)}`);
    logger.info(`✅ FORM 4 FULL PIPELINE COMPLETED SUCCESSFULLY`);
    logger.info(`   Total Signals: ${allSignalIds.length}`);
    logger.info(`   Enriched Successfully: ${enrichmentResults.successful}`);
    logger.info(`   Contacts Created: ${enrichmentResults.contactsCreated}`);
    logger.info(`   Contacts Matched: ${enrichmentResults.contactsMatched}`);
    logger.info(`${"=".repeat(70)}\n`);

    return result;
  } catch (error: any) {
    logger.error(`❌ FORM 4 FULL PIPELINE FAILED:`, error);

    result.success = false;
    result.error = error.message || "Unknown error occurred during pipeline execution";
    result.message = `Pipeline failed: ${result.error}`;

    return result;
  }
};
