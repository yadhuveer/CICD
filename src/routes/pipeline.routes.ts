import express from "express";

import {
  scrapeLatestForm4sToNewSignals,
  scrapeHistoricalForm4sToNewSignals,
} from "../services/scraping/liquiditySignals/form4PipelineNew.service.js";
import {
  scrapeForm13DGToSignal,
  scrapeLatestForm13DGsToSignals,
  processForm13DGXmlsToSignals,
} from "../services/scraping/liquiditySignals/form13DGPipeline.service.js";
import {
  scrapeDEF14AToSignal,
  scrapeLatestDEF14AsToSignals,
  scrapeHistoricalDEF14AsToSignals,
  getDEF14ASignalEnrichmentStats,
} from "../services/scraping/liquiditySignals/def14aPipeline.service.js";
import {
  scrapeLatest10KsToSignals,
  scrapeHistorical10KsToSignals,
  get10KSignalEnrichmentStats,
} from "../services/scraping/liquiditySignals/form10kPipeline.service.js";
import {
  scrapeLatest10QsToSignals,
  scrapeHistorical10QsToSignals,
  get10QSignalEnrichmentStats,
} from "../services/scraping/liquiditySignals/form10qPipeline.service.js";
import {
  scrapeLatest8KToSignals,
  scrape8KFromUrl,
  get8KSignalEnrichmentStats,
  get8KEventTypeStats,
} from "../services/scraping/liquiditySignals/form8kPipeline.service.js";

import {
  scrapeMAEvents,
  getMAStats,
  MAScraperOptions,
} from "../services/scraping/liquiditySignals/maPipeline.service.js";
import {
  scrapeHiringEvents,
  getHiringStats,
  getHiringTrends,
} from "../services/scraping/nonLiquidity/hiringPipeline.service.js";
import type { HiringScraperOptions } from "../types/jobPosting.types.js";
import { discoverAllFamilyOffices } from "../helpers/familyOfficeDiscovery.helper.js";
import { runDAFPipeline } from "../services/scraping/nonLiquidity/daf.service.js";
import {
  scrapeAirlinesData,
  scrapeAircraftData,
} from "../services/scraping/nonLiquidity/aircraftAndVessels.service.js";
import { scrapeNextGenLeadership } from "../services/scraping/nonLiquidity/nextGenLead.service.js";
import { runK1IncomePipeline } from "../services/scraping/nonLiquidity/k1Income.service.js";
import {
  scrapePhilanthropySignals2,
  PhilanthropyScraperOptions,
} from "../services/scraping/nonLiquidity/philanthropyPipeline.service2.js";

const router = express.Router();

// ==================== NEW FORM 4 PIPELINE (SignalNew Model) ====================

/**
 * POST /pipeline/new/scrape-latestForm4-to-signals
 * Scrape latest Form 4s from SEC RSS feed and convert to NEW Signals (SignalNew model)
 * Query params:
 *   - limit: Maximum number of Form 4s to scrape (default: 20, max: 40)
 * NOTE: Uses the NEW SignalNew schema with form4Data nested structure
 */
router.post("/new/scrape-latestForm4-to-signals", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 40);

    console.log(`📡 API: Scraping latest Form 4s → NEW Signals (limit: ${limit})`);

    const results = await scrapeLatestForm4sToNewSignals(limit);

    return res.json({
      success: true,
      message: `Scraping completed: ${results.successful} successful, ${results.alreadyExists} already exist, ${results.failed} failed`,
      data: results,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /pipeline/new/scrape-historicalForm4-to-signals
 * Scrape historical Form 4s by date range and convert to NEW Signals (SignalNew model)
 * Query params:
 *   - fromDate: Start date (YYYY-MM-DD) - required
 *   - toDate: End date (YYYY-MM-DD) - required
 *   - maxResults: Maximum results to process (default: 100, max: 100)
 * NOTE: Uses the NEW SignalNew schema with form4Data nested structure
 */
router.post("/new/scrape-historicalForm4-to-signals", async (req, res) => {
  try {
    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;
    const maxResults = Math.min(parseInt(req.query.maxResults as string) || 100, 100);

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        error: "fromDate and toDate query parameters are required (YYYY-MM-DD)",
      });
    }

    console.log(
      `📅 API: Scraping historical Form 4s → NEW Signals (${fromDate} to ${toDate}, max: ${maxResults})`,
    );

    const results = await scrapeHistoricalForm4sToNewSignals(fromDate, toDate, maxResults);

    if (!results.success && results.error) {
      return res.status(400).json(results);
    }

    return res.json(results);
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==================== FORM 13D/G PIPELINE (SignalNew Model) ====================

/**
 * POST /pipeline/new/scrape-latest13DG-to-signals
 * Scrape latest Schedule 13D/G filings from SEC RSS feed and convert to NEW Signals (SignalNew model)
 * Query params:
 *   - limit: Maximum number of filings to scrape (default: 20, max: 40)
 * NOTE: Uses the NEW SignalNew schema with form13Data nested structure.
 */
router.post("/new/scrape-latest13DG-to-signals", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 40);

    console.log(`📡 API: Scraping latest Schedule 13D/G → NEW Signals (limit: ${limit})`);

    const results = await scrapeLatestForm13DGsToSignals(limit);

    return res.json({
      success: true,
      message: `Scraping completed: ${results.successful} successful, ${results.alreadyExists} already exist, ${results.failed} failed`,
      data: results,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /pipeline/new/scrape-13dg-from-url
 * Scrape a specific Schedule 13D/G filing from XML URL and convert to Signal(s)
 * Query params:
 *   - url: SEC XML filing URL (required)
 */
router.post("/new/scrape-13dg-from-url", async (req, res) => {
  try {
    const url = req.query.url as string;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "url query parameter is required",
      });
    }

    console.log(`🔄 API: Scraping Schedule 13D/G from URL: ${url}`);

    const signalIds = await scrapeForm13DGToSignal(url);

    if (signalIds.length > 0) {
      return res.json({
        success: true,
        message: `Successfully processed Schedule 13D/G, created ${signalIds.length} signal(s)`,
        data: {
          signalIds,
          signalsCreated: signalIds.length,
        },
      });
    } else {
      return res.status(400).json({
        success: false,
        error: "Failed to scrape Schedule 13D/G or already exists",
      });
    }
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /pipeline/new/process-13dg-xmls
 * Process multiple Schedule 13D/G XML files from URLs
 * Body: { xmlUrls: string[] }
 */
router.post("/new/process-13dg-xmls", async (req, res) => {
  try {
    const xmlUrls = req.body.xmlUrls as string[];

    if (!xmlUrls || !Array.isArray(xmlUrls) || xmlUrls.length === 0) {
      return res.status(400).json({
        success: false,
        error: "xmlUrls array is required in request body",
      });
    }

    console.log(`📦 API: Processing ${xmlUrls.length} Schedule 13D/G XML files`);

    const results = await processForm13DGXmlsToSignals(xmlUrls);

    return res.json({
      success: true,
      message: `Processing completed: ${results.successful} successful, ${results.alreadyExists} already exist, ${results.failed} failed`,
      data: results,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==================== DEF 14A SCRAPE & CONVERT TO SIGNAL ROUTES ====================

/***
 * POST /pipeline/scrape-latestDEF14A-to-signals
 * Scrape latest DEF 14A from SEC RSS feed and convert directly to Signals
 * Query params:
 *   - limit: Maximum number of DEF 14A to scrape (default: 20, max: 40)
 * NOTE: This does NOT save to DEF14A database - goes straight to Signal
 */
router.post("/scrape-latestDEF14A-to-signals", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 40);

    console.log(`📡 API: Scraping latest DEF 14A from RSS feed → Signals (limit: ${limit})`);

    const results = await scrapeLatestDEF14AsToSignals(limit);

    return res.json({
      success: true,
      message: `Scraping completed: ${results.successful} successful, ${results.alreadyExists} already exist, ${results.failed} failed`,
      data: results,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /pipeline/scrape-historicalDEF14A-to-signals
 * Scrape historical DEF 14A by date range and convert directly to Signals
 * Query params:
 *   - fromDate: Start date (YYYY-MM-DD) - required
 *   - toDate: End date (YYYY-MM-DD) - required
 *   - maxResults: Maximum results to process (default: 100, max: 100)
 * NOTE: This does NOT save to DEF14A database - goes straight to Signal
 */
router.post("/scrape-historicalDEF14A-to-signals", async (req, res) => {
  try {
    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;
    const maxResults = Math.min(parseInt(req.query.maxResults as string) || 100, 100);

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        error: "fromDate and toDate query parameters are required (YYYY-MM-DD)",
      });
    }

    console.log(
      `📅 API: Scraping historical DEF 14A → Signals (${fromDate} to ${toDate}, max: ${maxResults})`,
    );

    const results = await scrapeHistoricalDEF14AsToSignals(fromDate, toDate, maxResults);

    if (!results.success && results.error) {
      return res.status(400).json(results);
    }

    return res.json(results);
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /pipeline/def14a-enrichment-status
 * Get statistics about DEF 14A signal enrichment status
 * Returns: total signals, enriched count, pending count, recent activity
 */
router.get("/def14a-enrichment-status", async (req, res) => {
  try {
    console.log(`📊 API: Getting DEF 14A signal enrichment status`);

    const stats = await getDEF14ASignalEnrichmentStats();

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==================== FORM 10-K SCRAPE & CONVERT TO SIGNAL ROUTES ====================

/**
 * POST /pipeline/scrape-latest10K-to-signals
 * Scrape latest Form 10-K from SEC RSS feed and convert directly to Signals
 * Query params:
 *   - limit: Maximum number of 10-K to scrape (default: 20, max: 40)
 * NOTE: This does NOT save to Form10K database - goes straight to Signal
 */
router.post("/scrape-latest10K-to-signals", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 40);

    console.log(`📡 API: Scraping latest Form 10-K from RSS feed → Signals (limit: ${limit})`);

    const results = await scrapeLatest10KsToSignals(limit);

    return res.json({
      success: true,
      message: `Scraping completed: ${results.successful} successful, ${results.alreadyExists} already exist, ${results.failed} failed`,
      data: results,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /pipeline/scrape-historical10K-to-signals
 * Scrape historical Form 10-K by date range and convert directly to Signals
 * Query params:
 *   - fromDate: Start date (YYYY-MM-DD) - required
 *   - toDate: End date (YYYY-MM-DD) - required
 *   - maxResults: Maximum results to process (default: 100, max: 100)
 * NOTE: This does NOT save to Form10K database - goes straight to Signal
 */
router.post("/scrape-historical10K-to-signals", async (req, res) => {
  try {
    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;
    const maxResults = Math.min(parseInt(req.query.maxResults as string) || 100, 100);

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        error: "fromDate and toDate query parameters are required (YYYY-MM-DD)",
      });
    }

    console.log(
      `📅 API: Scraping historical Form 10-K → Signals (${fromDate} to ${toDate}, max: ${maxResults})`,
    );

    const results = await scrapeHistorical10KsToSignals(fromDate, toDate, maxResults);

    if (!results.success && results.error) {
      return res.status(400).json(results);
    }

    return res.json(results);
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /pipeline/10k-enrichment-status
 * Get statistics about Form 10-K signal enrichment status
 * Returns: total signals, enriched count, pending count, recent activity
 */
router.get("/10k-enrichment-status", async (req, res) => {
  try {
    console.log(`📊 API: Getting Form 10-K signal enrichment status`);

    const stats = await get10KSignalEnrichmentStats();

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==================== FORM 10-Q SCRAPE & CONVERT TO SIGNAL ROUTES ====================

/**
 * POST /pipeline/scrape-latest10Q-to-signals
 * Scrape latest Form 10-Q from SEC RSS feed and convert directly to Signals
 * Query params:
 *   - limit: Maximum number of 10-Q to scrape (default: 20, max: 40)
 * NOTE: This does NOT save to Form10Q database - goes straight to Signal
 */
router.post("/scrape-latest10Q-to-signals", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 40);

    console.log(`📡 API: Scraping latest Form 10-Q from RSS feed → Signals (limit: ${limit})`);

    const results = await scrapeLatest10QsToSignals(limit);

    return res.json({
      success: true,
      message: `Scraping completed: ${results.successful} successful, ${results.alreadyExists} already exist, ${results.failed} failed`,
      data: results,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /pipeline/scrape-historical10Q-to-signals
 * Scrape historical Form 10-Q by date range and convert directly to Signals
 * Query params:
 *   - fromDate: Start date (YYYY-MM-DD) - required
 *   - toDate: End date (YYYY-MM-DD) - required
 *   - maxResults: Maximum results to process (default: 100, max: 100)
 * NOTE: This does NOT save to Form10Q database - goes straight to Signal
 */
router.post("/scrape-historical10Q-to-signals", async (req, res) => {
  try {
    const fromDate = req.query.fromDate as string;
    const toDate = req.query.toDate as string;
    const maxResults = Math.min(parseInt(req.query.maxResults as string) || 100, 100);

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        error: "fromDate and toDate query parameters are required (YYYY-MM-DD)",
      });
    }

    console.log(
      `📅 API: Scraping historical Form 10-Q → Signals (${fromDate} to ${toDate}, max: ${maxResults})`,
    );

    const results = await scrapeHistorical10QsToSignals(fromDate, toDate, maxResults);

    if (!results.success && results.error) {
      return res.status(400).json(results);
    }

    return res.json(results);
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /pipeline/10q-enrichment-status
 * Get statistics about Form 10-Q signal enrichment status
 * Returns: total signals, enriched count, pending count, recent activity
 */
router.get("/10q-enrichment-status", async (req, res) => {
  try {
    console.log(`📊 API: Getting Form 10-Q signal enrichment status`);

    const stats = await get10QSignalEnrichmentStats();

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==================== FORM 8-K SCRAPE & CONVERT TO SIGNAL ROUTES ====================

/**
 * POST /pipeline/scrape-latest8K-to-signals
 * Scrape latest Form 8-K from SEC RSS feed and convert directly to Signals
 * Query params:
 *   - limit: Maximum number of 8-K to scrape (default: 5, max: 40)
 * NOTE: This does NOT save to Form8K database - goes straight to Signal
 *
 * Form 8-K reports material corporate events:
 * - Item 5.02: Officer/Director changes (High value signals for personnel tracking)
 * - Item 2.02: Financial results and earnings announcements
 * - Item 2.01: Acquisitions and dispositions (M&A activity)
 * - Item 1.01: Material agreements
 * - Item 8.01: Other material events
 */
router.post("/scrape-latest8K-to-signals", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 5, 40);

    console.log(`📡 API: Scraping latest Form 8-K from RSS feed → Signals (limit: ${limit})`);

    const results = await scrapeLatest8KToSignals(limit);

    return res.json({
      success: true,
      message: `Scraping completed: ${results.successful} successful, ${results.alreadyExists} already exist, ${results.failed} failed`,
      data: results,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /pipeline/scrape-8k-from-url
 * Scrape a specific Form 8-K filing from URL and convert to Signal(s)
 * Query params:
 *   - url: SEC filing URL (required)
 */
router.post("/scrape-8k-from-url", async (req, res) => {
  try {
    const url = req.query.url as string;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "url query parameter is required",
      });
    }

    console.log(`🔄 API: Scraping Form 8-K from URL: ${url}`);

    const result = await scrape8KFromUrl(url);

    if (result.success) {
      return res.json({
        success: true,
        message: `Successfully processed Form 8-K, created ${result.signalIds.length} signal(s)`,
        data: {
          signalIds: result.signalIds,
          signalsCreated: result.signalIds.length,
        },
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error || "Failed to scrape Form 8-K",
      });
    }
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /pipeline/8k-enrichment-status
 * Get statistics about Form 8-K signal enrichment status
 * Returns: total signals, enriched count, pending count, completion rate
 */
router.get("/8k-enrichment-status", async (req, res) => {
  try {
    console.log(`📊 API: Getting Form 8-K signal enrichment status`);

    const stats = await get8KSignalEnrichmentStats();

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /pipeline/8k-event-type-stats
 * Get statistics about types of events reported in Form 8-K signals
 * Returns: breakdown of Item numbers (e.g., Item 5.02 officer changes, Item 2.02 earnings)
 * This is useful for understanding what types of corporate events are being captured
 */
router.get("/8k-event-type-stats", async (req, res) => {
  try {
    console.log(`📊 API: Getting Form 8-K event type statistics`);

    const stats = await get8KEventTypeStats();

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==================== M&A EVENT SCRAPING ROUTES ====================

/**
 * POST /pipeline/ma-scrape
 * Unified M&A scraping endpoint
 * Body: { type, limit?, days?, country?, timeframe?, states?, year?, query? }
 * Types: "acquisitions" | "state-filings" | "founder-exits" | "custom"
 */
router.post("/ma-scrape", async (req, res) => {
  try {
    const options: MAScraperOptions = req.body || {};

    if (!options || !options.type) {
      return res.status(400).json({
        success: false,
        error: "type is required (acquisitions, state-filings, founder-exits, custom)",
      });
    }

    if (options.type === "custom" && !options.query) {
      return res.status(400).json({
        success: false,
        error: "query is required for custom scraping",
      });
    }

    options.limit = Math.min(options.limit || 20, 50);

    const results = await scrapeMAEvents(options);

    return res.json({
      success: results.success,
      message: results.success
        ? `Completed: ${results.successful} successful, ${results.failed} failed`
        : results.error,
      data: results,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /pipeline/ma-stats
 * Get comprehensive M&A statistics
 */
router.get("/ma-stats", async (_req, res) => {
  try {
    const stats = await getMAStats();
    return res.json({ success: true, data: stats });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==================== FAMILY OFFICE HIRING SCRAPING ROUTES ====================

/**
 * POST /pipeline/hiring-scrape
 * Unified Family Office hiring scraping endpoint
 * Body: { type, limit?, domains?, query?, atsPlatform? }
 * Types: "discovery" | "monitoring" | "custom" | "ats-search"
 *
 * Examples:
 * - Discovery: { type: "discovery", limit: 10, query: "Find Family Offices hiring CFO" }
 * - Monitoring: { type: "monitoring", domains: ["rockefellercapital.com", "familyoffice.com"] }
 * - Custom: { type: "custom", query: "Family Office CFO jobs in New York" }
 * - ATS Search: { type: "ats-search", atsPlatform: "greenhouse", limit: 20 }
 */
router.post("/hiring-scrape", async (req, res) => {
  try {
    const options: HiringScraperOptions = req.body || {};

    if (!options || !options.type) {
      return res.status(400).json({
        success: false,
        error: "type is required (discovery, monitoring, custom, ats-search)",
      });
    }

    // Validate type-specific requirements
    if (options.type === "monitoring" && (!options.domains || options.domains.length === 0)) {
      return res.status(400).json({
        success: false,
        error: "domains array is required for monitoring",
      });
    }

    if (options.type === "custom" && !options.query) {
      return res.status(400).json({
        success: false,
        error: "query is required for custom scraping",
      });
    }

    options.limit = Math.min(options.limit || 10, 50);

    console.log(`🔍 API: Starting hiring scrape - Type: ${options.type}, Limit: ${options.limit}`);

    const results = await scrapeHiringEvents(options);

    return res.json({
      success: results.success,
      message: results.success
        ? `Completed: ${results.successful} successful, ${results.failed} failed`
        : results.error,
      data: results,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /pipeline/hiring-stats
 * Get comprehensive Family Office hiring statistics
 * Returns: total signals, job levels breakdown, urgency distribution, top companies, FO indicators
 */
router.get("/hiring-stats", async (_req, res) => {
  try {
    console.log("📊 API: Getting hiring statistics");

    const stats = await getHiringStats();

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /pipeline/hiring-trends
 * Get hiring trends over time
 * Query params:
 *   - days: Number of days to analyze (default: 30)
 * Returns: daily hiring data, total signals, unique companies
 */
router.get("/hiring-trends", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 180);

    console.log(`📈 API: Getting hiring trends (last ${days} days)`);

    const trends = await getHiringTrends(days);

    return res.json({
      success: true,
      data: trends,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /pipeline/discover-all-family-offices
 * Comprehensive Family Office discovery using PURE WEB SEARCH
 * Query params:
 *   - limit: Limit per strategy (default: 50, max: 200)
 *
 * Strategies used (NO SEEDS):
 * 1. Parallel.ai: AI-powered web discovery (5 queries)
 * 2. Firecrawl: 20+ targeted web search queries
 * 3. ATS Platforms: Greenhouse, Lever, Workday, Bamboo
 *
 * This endpoint discovers Family Offices from real web searches only.
 * NO pre-defined domain lists - everything found from live job postings.
 *
 * Cost: ~$30-35 per run (Parallel $25 + Firecrawl $5-10)
 */
router.post("/discover-all-family-offices", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    console.log(`🔍 API: Starting PURE WEB DISCOVERY of Family Offices (limit: ${limit})`);

    // Always use pure web discovery (no seeds)
    const results = await discoverAllFamilyOffices();

    return res.json({
      success: true,
      message: `Discovery complete: ${results.summary.totalSignals} unique Family Offices found from web`,
      data: results,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ==================== AIRCRAFT & AIRLINES SCRAPING ROUTES ====================

/**
 * POST /pipeline/scrape-airlines
 * Scrape airlines/air carrier data from FAA registry
 *
 * Features:
 * - Efficient streaming download (stops at 50 records)
 * - Only processes ACFTREF.txt (small file)
 * - Filters for commercial/transport aircraft operators
 * - Saves to SignalNew collection
 *
 * Returns: Success/failure status with count of records saved
 */
router.post("/scrape-airlines", async (_req, res) => {
  try {
    console.log("✈️ API: Starting airlines data scraping...");

    await scrapeAirlinesData();

    return res.json({
      success: true,
      message: "Airlines data scraping completed successfully",
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /pipeline/scrape-aircraft
 * Scrape aircraft registration data from FAA registry
 *
 * Features:
 * - Downloads full FAA aircraft registry ZIP
 * - Extracts and processes MASTER.txt
 * - Filters for recent registrations (last 6 months)
 * - Saves to SignalNew collection
 *
 * Returns: Success/failure status with count of records saved
 */
router.post("/scrape-aircraft", async (_req, res) => {
  try {
    console.log("🛩️ API: Starting aircraft data scraping...");

    await scrapeAircraftData();

    return res.json({
      success: true,
      message: "Aircraft data scraping completed successfully",
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /pipeline/scrape-daf
 * Full DAF scraping pipeline:
 * - discovers URLs
 * - scrapes pages
 * - extracts DAF signals
 * - saves them into SignalNew
 */

router.post("/scrape-daf", async (req, res) => {
  try {
    const baseQuery = (req.query.q as string) || undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 25, 50);

    console.log("📡 API: Starting DAF scraping pipeline...");

    const result = await runDAFPipeline(baseQuery, limit);

    return res.json({
      success: result.success,
      message: result.success
        ? `DAF scraping complete — extracted: ${result.totalExtracted}, saved: ${result.saved}, skipped: ${result.skipped}, errors: ${result.errors}`
        : `DAF scraping failed`,
      result,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error?.message || error);

    return res.status(500).json({
      success: false,
      error: error?.message || String(error),
    });
  }
});
export default router;

/**
 * POST /pipeline/scrape-nextgen
 * Full Next-Gen Leadership scraping pipeline:
 * - Firecrawl URL discovery
 * - Page scraping (axios + cheerio)
 * - GPT extraction of next-gen leadership events
 * - Saves as TWO SignalNew documents:
 *    1. Person-level signal
 *    2. Company-level signal
 */
router.post("/scrape-nextgen", async (_req, res) => {
  try {
    console.log("⚡ API: Starting Next-Gen Leadership scraping...");

    // Lazy import to avoid loading on startup

    const result = await scrapeNextGenLeadership();

    return res.json({
      success: true,
      message: `Next-gen scraping completed. ${result.totalSaved} signals saved (${result.personSignals} person, ${result.companySignals} company)`,
      result,
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /pipeline/scrape-k1-income
 * Run the K-1 (modeled) discovery -> scrape -> extract -> save pipeline
 * Optional query:
 *  - q: base query string (overrides default queries)
 */
router.post("/scrape-k1-income", async (req, res) => {
  try {
    const baseQuery = (req.query.q as string) || undefined;

    console.log("📡 API: Starting K-1 income scraping pipeline...");

    const result = await runK1IncomePipeline(baseQuery);
    return res.json(result);
  } catch (error: any) {
    console.error("❌ API Error:", error?.message ?? error);
    return res.status(500).json({ success: false, error: error?.message ?? String(error) });
  }
});

router.post("/philanthropy-scrape2", async (req, res) => {
  try {
    const options: PhilanthropyScraperOptions = req.body || {};

    if (options.maxQueriesPerCategory !== undefined) {
      options.maxQueriesPerCategory = Math.min(options.maxQueriesPerCategory, 10);
    }
    if (options.maxPagesPerQuery !== undefined) {
      options.maxPagesPerQuery = Math.min(options.maxPagesPerQuery, 5);
    }

    console.log(`API: Starting philanthropy scrape`);

    const results = await scrapePhilanthropySignals2(options);

    return res.json({
      success: results.success,
      message: results.success
        ? `Found ${results.totalSignals} philanthropy signals (using axios scraping)`
        : results.error,
      data: results,
    });
  } catch (error: any) {
    console.error("API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
