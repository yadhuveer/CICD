import express from "express";

import {
  enrichSingleSignal,
  enrichBatchSignals,
  enrichPendingSignals,
  enrichByFilingType,
  getSignalEnrichmentStatus,
  getEnrichmentStatistics,
  retryFailed,
  testContactOut,
  enrichSingleCompanySignal,
  enrichBatchCompanySignals,
  enrichPendingCompanySignals,
  enrichCompanyByFilingType,
  getCompanyEnrichmentStatistics,
  retryFailedCompanyEnrichments,
  enrichTaxData,
  enrichContactWithAI,
} from "../controllers/enrichment.controller.js";

const router = express.Router();

/**
 * =====================================
 * SIGNAL-TO-CONTACT ENRICHMENT ROUTES
 * =====================================
 */

// Enrich a single signal by ID
router.post("/signal/:signalId", enrichSingleSignal);

// Enrich multiple signals in batch
router.post("/batch", enrichBatchSignals);

// Enrich pending signals (auto-fetch from database)
router.post("/pending", enrichPendingSignals);

// Enrich pending signals by filing type(s)
router.post("/by-filing-type", enrichByFilingType);

// Get enrichment status for a signal
router.get("/status/:signalId", getSignalEnrichmentStatus);

// Get enrichment pipeline statistics
router.get("/stats", getEnrichmentStatistics);

// Retry failed enrichments
router.post("/retry-failed", retryFailed);

// Test ContactOut API connection
router.post("/test-contactout", testContactOut);

/**
 * =====================================
 * COMPANY SIGNAL ENRICHMENT ROUTES
 * =====================================
 * IMPORTANT: Specific routes MUST come before dynamic :signalId route
 */

// Enrich multiple Company signals in batch
router.post("/company/batch", enrichBatchCompanySignals);

// Enrich pending Company signals (auto-fetch from database)
router.post("/company/pending", enrichPendingCompanySignals);

// Enrich pending Company signals by filing type(s)
router.post("/company/by-filing-type", enrichCompanyByFilingType);

// Retry failed company enrichments
router.post("/company/retry-failed", retryFailedCompanyEnrichments);

// Get company enrichment pipeline statistics
router.get("/company/stats", getCompanyEnrichmentStatistics);

// Enrich a single Company signal by ID (MUST be last - catches all other /company/* routes)
router.post("/company/:signalId", enrichSingleCompanySignal);

//Tax Data Rnrichment
router.post("/taxData", enrichTaxData);

/**
 * =====================================
 * CONTACT AI ENRICHMENT ROUTES
 * =====================================
 */

// Enrich a contact using AI agent with ContactOut cache data
router.post("/contact/:contactId", enrichContactWithAI);

export default router;
