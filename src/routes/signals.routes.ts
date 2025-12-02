import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  getAllSignalsWithContacts,
  getSignalById,
  searchSignals,
  getContactsBySignalId,
  getSignalsStats,
  getMASignalsForFeed,
  updateMAFeedback,
} from "../controllers/signals.controller.js";

const router = express.Router();

// All routes require authentication
// router.use(authenticate);

/**
 * GET /signals/ma-feed
 * Get M&A signals for activity feed
 */
router.get("/ma-feed", getMASignalsForFeed);

/**
 * POST /signals/ma-feedback
 * Update user feedback (like/dislike) for an M&A signal
 */
router.post("/ma-feedback", updateMAFeedback);

/**
 * GET /signals
 * Get all signals with enriched contacts
 */
router.get("/", getAllSignalsWithContacts);

/**
 * GET /signals/stats
 * Get statistics about signals
 */
router.get("/stats", getSignalsStats);

/**
 * GET /signals/pipeline-stats
 * Get comprehensive statistics about the signal-to-contact pipeline
 * Optional query parameters: startDate, endDate (ISO date strings)
 */
// router.get("/pipeline-stats", getSignalPipelineStats);

/**
 * GET /signals/contact-hit-rate
 * Get contact conversion hit rate statistics by filing type
 * Optional query parameters: startDate, endDate (ISO date strings)
 */
// router.get("/contact-hit-rate", getContactHitRate);

/**
 * GET /signals/search
 * Search signals by name, company, or other fields
 */
router.get("/search", searchSignals);

/**
 * GET /signals/:id
 * Get a single signal by ID with populated enriched contacts
 */
router.get("/:id", getSignalById);

/**
 * GET /signals/:id/contacts
 * Get all enriched contacts for a specific signal
 */
router.get("/:id/contacts", getContactsBySignalId);

export default router;
