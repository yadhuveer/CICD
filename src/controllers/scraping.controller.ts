import {
  scrapeLatest13DG,
  scrapeD,
  scrape8K,
  scrape13FNew,
} from "../services/scraping/liquiditySignals/commonScraping.service.js";
import {
  scrapeLatestForm13DGsToSignals,
  processForm13DGXmlsToSignals,
} from "../services/scraping/liquiditySignals/form13DGPipeline.service.js";
import {
  scrapeLatestS3ToSignals,
  scrapeS3FromUrl,
  getS3SignalEnrichmentStats,
} from "../services/scraping/liquiditySignals/formS3Pipeline.service.js";
import {
  scrapeLatest8KToSignals,
  scrape8KFromUrl,
  get8KSignalEnrichmentStats,
  get8KEventTypeStats,
} from "../services/scraping/liquiditySignals/form8kPipeline.service.js";
import {
  scrapeLatestFormDToSignals,
  processFormDXmlsToSignals,
  getFormDSignalEnrichmentStats,
} from "../services/scraping/liquiditySignals/formDPipeline.service.js";
import {
  processForm13FToInstitutional,
  getInstitutionalHoldingsStats,
} from "../services/scraping/liquiditySignals/form13fInstitutionalPipeline.service.js";

import logger from "../utils/logger.js";

/**
 * Scrape latest Schedule 13D/G filings and convert to Signals
 * This uses the new pipeline that goes directly to Signal schema
 */
export const scrapeForm13DGToSignals = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;

    logger.info(`Starting Schedule 13D/G scraping pipeline (limit: ${limit})`);

    // Call the new pipeline service
    const results = await scrapeLatestForm13DGsToSignals(limit);

    res.status(200).json({
      success: true,
      message: `Scraped ${results.total} filings, created ${results.signalsCreated} signals`,
      results,
    });
  } catch (error: any) {
    logger.error("Error in scrapeForm13DGToSignals:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Legacy endpoint - Scrape 13D and 13G XMLs
 * This returns raw XML data without processing to Signals
 */
export const scrapeForm13Signals = async (req, res) => {
  try {
    // Call the helper fun to scrape 13D and 13D Signals
    const signals = await scrapeLatest13DG();
    res.status(200).json({ signals });
  } catch (error) {
    logger.error("Error in scrapeForm13Signals:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const scrapeFormDSignals = async (req, res) => {
  try {
    // Call the helper fun to scrape Form Signals
    const signals = await scrapeD();
    res.status(200).json({ signals });
  } catch (error) {
    logger.error("Error in scrapeForm13Signals:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Process XML data from scrapeLatest13DG and convert to Signals
 * Useful for reprocessing existing XML data
 */
export const processForm13XMLsToSignals = async (req, res) => {
  try {
    const { xmlStrings, filingLinks } = req.body;

    if (!xmlStrings || !Array.isArray(xmlStrings) || xmlStrings.length === 0) {
      return res.status(400).json({
        success: false,
        message: "xmlStrings array is required and must not be empty",
      });
    }

    logger.info(`Processing ${xmlStrings.length} Schedule 13D/G XMLs to Signals`);

    const results = await processForm13DGXmlsToSignals(xmlStrings, filingLinks);

    res.status(200).json({
      success: true,
      message: `Processed ${results.total} XMLs, created ${results.signalsCreated} signals`,
      results,
    });
  } catch (error: any) {
    logger.error("Error in processForm13XMLsToSignals:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/////////////////////////////////////////////////////////////////////////////////////
// S-3 Registration Statement Scraping Controllers
/////////////////////////////////////////////////////////////////////////////////////

/**
 * Scrape latest S-3 filings and convert to Signals
 * This uses the new pipeline that goes directly to Signal schema
 */
export const scrapeFormS3ToSignals = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;

    logger.info(`Starting S-3 scraping pipeline (limit: ${limit})`);

    // Call the pipeline service
    const results = await scrapeLatestS3ToSignals(limit);

    res.status(200).json({
      success: true,
      message: `Scraped ${results.total} filings, ${results.successful} successful, ${results.alreadyExists} already exist, ${results.failed} failed`,
      results: {
        total: results.total,
        successful: results.successful,
        alreadyExists: results.alreadyExists,
        failed: results.failed,
        signalIds: results.signalIds,
        signalsCreated: results.signalIds.length,
      },
    });
  } catch (error: any) {
    logger.error("Error in scrapeFormS3ToSignals:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Scrape S-3 from a specific URL
 * Query param: url (SEC filing URL)
 */
export const scrapeFormS3FromUrl = async (req, res) => {
  try {
    const url = req.query.url as string;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: "url query parameter is required",
      });
    }

    logger.info(`Scraping S-3 from URL: ${url}`);

    const result = await scrapeS3FromUrl(url);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: `Successfully processed S-3, created ${result.signalIds.length} signal(s)`,
        signalIds: result.signalIds,
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.error || "Failed to scrape S-3",
      });
    }
  } catch (error: any) {
    logger.error("Error in scrapeFormS3FromUrl:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get enrichment statistics for S-3 signals
 */
export const getS3Stats = async (req, res) => {
  try {
    logger.info("Fetching S-3 signal enrichment statistics");

    const stats = await getS3SignalEnrichmentStats();

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error("Error in getS3Stats:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/////////////////////////////////////////////////////////////////////////////////////
// Form 8-K Current Report Scraping Controllers
/////////////////////////////////////////////////////////////////////////////////////

/**
 * Scrape latest Form 8-K filings and convert to Signals
 * This uses the new pipeline that goes directly to Signal schema
 */
export const scrapeForm8KToSignals = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;

    logger.info(`Starting Form 8-K scraping pipeline (limit: ${limit})`);

    // Call the pipeline service
    const results = await scrapeLatest8KToSignals(limit);

    res.status(200).json({
      success: true,
      message: `Scraped ${results.total} filings, ${results.successful} successful, ${results.alreadyExists} already exist, ${results.failed} failed`,
      results: {
        total: results.total,
        successful: results.successful,
        alreadyExists: results.alreadyExists,
        failed: results.failed,
        signalIds: results.signalIds,
        signalsCreated: results.signalIds.length,
      },
    });
  } catch (error: any) {
    logger.error("Error in scrapeForm8KToSignals:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Scrape Form 8-K from a specific URL
 * Query param: url (SEC filing URL)
 */
export const scrapeForm8KFromUrl = async (req, res) => {
  try {
    const url = req.query.url as string;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: "url query parameter is required",
      });
    }

    logger.info(`Scraping Form 8-K from URL: ${url}`);

    const result = await scrape8KFromUrl(url);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: `Successfully processed Form 8-K, created ${result.signalIds.length} signal(s)`,
        signalIds: result.signalIds,
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.error || "Failed to scrape Form 8-K",
      });
    }
  } catch (error: any) {
    logger.error("Error in scrapeForm8KFromUrl:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get enrichment statistics for Form 8-K signals
 */
export const get8KStats = async (req, res) => {
  try {
    logger.info("Fetching Form 8-K signal enrichment statistics");

    const stats = await get8KSignalEnrichmentStats();

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error("Error in get8KStats:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get event type statistics for Form 8-K signals
 * Shows breakdown of Item numbers reported (e.g., Item 5.02 officer changes)
 */
export const get8KEventStats = async (req, res) => {
  try {
    logger.info("Fetching Form 8-K event type statistics");

    const stats = await get8KEventTypeStats();

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error("Error in get8KEventStats:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Legacy endpoint - Scrape Form 8-K XMLs
 * This returns raw XML data without processing to Signals
 */
export const scrapeForm8KRaw = async (req, res) => {
  try {
    logger.info("Scraping raw Form 8-K XMLs (legacy mode)");

    // Call the helper function to scrape 8-K XMLs
    const signals = await scrape8K();
    res.status(200).json({ signals });
  } catch (error) {
    logger.error("Error in scrapeForm8KRaw:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/////////////////////////////////////////////////////////////////////////////////////
// Form D Notice of Exempt Offering Scraping Controllers
/////////////////////////////////////////////////////////////////////////////////////

/**
 * Scrape latest Form D filings and convert to Signals
 * This uses the new pipeline that goes directly to Signal schema
 */
export const scrapeFormDToSignals = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;

    logger.info(`Starting Form D scraping pipeline (limit: ${limit})`);

    // Call the pipeline service
    const results = await scrapeLatestFormDToSignals(limit);

    res.status(200).json({
      success: true,
      message: `Scraped ${results.total} filings, ${results.successful} successful, ${results.alreadyExists} already exist, ${results.failed} failed`,
      results: {
        total: results.total,
        successful: results.successful,
        alreadyExists: results.alreadyExists,
        failed: results.failed,
        signalIds: results.signalIds,
        signalsCreated: results.signalIds.length,
      },
    });
  } catch (error: any) {
    logger.error("Error in scrapeFormDToSignals:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Process XML data from scrapeD and convert to Signals
 * Useful for reprocessing existing XML data
 */
export const processFormDXMLsToSignals = async (req, res) => {
  try {
    const { xmlStrings, filingLinks } = req.body;

    if (!xmlStrings || !Array.isArray(xmlStrings) || xmlStrings.length === 0) {
      return res.status(400).json({
        success: false,
        message: "xmlStrings array is required and must not be empty",
      });
    }

    logger.info(`Processing ${xmlStrings.length} Form D XMLs to Signals`);

    const results = await processFormDXmlsToSignals(xmlStrings, filingLinks);

    res.status(200).json({
      success: true,
      message: `Processed ${results.total} XMLs, created ${results.signalsCreated} signals`,
      results,
    });
  } catch (error: any) {
    logger.error("Error in processFormDXMLsToSignals:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get enrichment statistics for Form D signals
 */
export const getFormDStats = async (req, res) => {
  try {
    logger.info("Fetching Form D signal enrichment statistics");

    const stats = await getFormDSignalEnrichmentStats();

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error("Error in getFormDStats:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Legacy endpoint - Scrape Form D XMLs
 * This returns raw XML data without processing to Signals
 */
export const scrapeFormDRaw = async (req, res) => {
  try {
    logger.info("Scraping raw Form D XMLs (legacy mode)");

    // Call the helper function to scrape Form D XMLs
    const signals = await scrapeD();
    res.status(200).json({ signals });
  } catch (error) {
    logger.error("Error in scrapeFormDRaw:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/////////////////////////////////////////////////////////////////////////////////////
// Form 13F Institutional Holdings Pipeline Controllers
/////////////////////////////////////////////////////////////////////////////////////

/**
 * Process Form 13F filings to populate InstitutionalFiler and InstitutionalHolding schemas
 * with quarter-on-quarter change tracking
 * POST /api/test/process-13f-institutional
 * Body: { limit?: number } (optional, defaults to all scraped data)
 */
export const process13FToInstitutional = async (req, res) => {
  try {
    const limit = parseInt(req.body.limit as string) || undefined;

    logger.info(
      `Starting Form 13F institutional processing pipeline${limit ? ` (limit: ${limit})` : ""}`,
    );

    // Get scraped Form 13F data
    logger.info("Fetching Form 13F data using scrape13FNew()...");
    const scrapedData = await scrape13FNew();

    if (!scrapedData.data || scrapedData.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No Form 13F data found to process",
      });
    }

    // Apply limit if specified
    const dataToProcess = limit ? scrapedData.data.slice(0, limit) : scrapedData.data;

    // Group filings by company (CIK) and sort each company's filings oldest-first
    // This ensures QoQ calculations work properly (each quarter can reference its previous quarter)
    const filingsByCompany = new Map<string, any[]>();
    dataToProcess.forEach((filing: any) => {
      const cik = filing.cik;
      if (!filingsByCompany.has(cik)) {
        filingsByCompany.set(cik, []);
      }
      filingsByCompany.get(cik)!.push(filing);
    });

    // Sort each company's filings oldest-first based on period of report
    const sortedFilings: any[] = [];
    filingsByCompany.forEach((filings) => {
      // We need to extract period date from primaryXml to sort properly
      // For now, reverse the array since they come newest-first from the scraper
      const reversedFilings = filings.reverse();
      sortedFilings.push(...reversedFilings);
    });

    logger.info(
      `Processing ${sortedFilings.length} Form 13F filings (sorted oldest-first for QoQ calculations)...`,
    );

    // Process filings through institutional pipeline
    const results = await processForm13FToInstitutional(sortedFilings);

    res.status(200).json({
      success: true,
      message: `Processed ${results.totalProcessed} filings, created ${results.filersCreated} filers, added ${results.quarterlyReportsAdded} quarterly reports, saved ${results.totalHoldingsSaved} holdings`,
      results: {
        totalProcessed: results.totalProcessed,
        filersCreated: results.filersCreated,
        filersUpdated: results.filersUpdated,
        quarterlyReportsAdded: results.quarterlyReportsAdded,
        totalHoldingsSaved: results.totalHoldingsSaved,
        qoqChangesCalculated: results.qoqChangesCalculated,
        errors: results.errors,
        errorDetails: results.errorDetails,
      },
    });
  } catch (error: any) {
    logger.error("Error in process13FToInstitutional:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get institutional holdings statistics
 * GET /api/test/institutional-stats
 * Returns: filers count, holdings breakdown, QoQ changes, top filers
 */
export const getInstitutionalStats = async (req, res) => {
  try {
    logger.info("Fetching institutional holdings statistics");

    const stats = await getInstitutionalHoldingsStats();

    res.status(200).json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error("Error in getInstitutionalStats:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
