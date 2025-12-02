import express from "express";
import {
  analyzeTaxProfessionalInsights,
  analyzeAllTaxProfessionals,
  enrichSingleContact,
  enrichContactsBatchController,
  enrichUnprocessedContacts,
} from "../controllers/insights.controller.js";

const router = express.Router();

/**
 * POST /v1/insights/analyze-tax-professional/:contactId
 * Analyze tax professional / advisor as referral source (advisor focus)
 */
router.post("/analyze-tax-professional/:contactId", analyzeTaxProfessionalInsights);

/**
 * POST /v1/insights/analyze-all-tax-professionals
 * Analyze all contacts with sourceOfInformation="tax-professional-scrape"
 * Automatically finds and processes all tax professional contacts with intelligent rate limiting
 * Query params: batchSize (default: 5), delayMs (default: 20000)
 */
router.post("/analyze-all-tax-professionals", analyzeAllTaxProfessionals);

// =====================================
// CONTACT INSIGHTS ENRICHMENT FROM SIGNALS
// =====================================

/**
 * POST /v1/insights/enrich-contact/:contactId
 * Enrich a single contact with insights from their linked signal
 * This fetches the contact's linked signal and uses the insights agent to generate:
 * - Informative and actionable insights
 * - Lead score (0-100)
 * - Signal type categorization
 */
router.post("/enrich-contact/:contactId", enrichSingleContact);

/**
 * POST /v1/insights/enrich-contacts-batch
 * Enrich multiple contacts in batch with rate limiting
 * Body: {
 *   contactIds: string[],
 *   batchSize?: number (default: 5),
 *   delayMs?: number (default: 20000)
 * }
 */
router.post("/enrich-contacts-batch", enrichContactsBatchController);

/**
 * POST /v1/insights/enrich-unprocessed-contacts
 * Automatically find and enrich all contacts that haven't been processed yet
 * A contact is considered unprocessed if it has no insights or no lead score
 * Body: {
 *   limit?: number (default: 50),
 *   batchSize?: number (default: 5),
 *   delayMs?: number (default: 20000)
 * }
 */
router.post("/enrich-unprocessed-contacts", enrichUnprocessedContacts);

export default router;
