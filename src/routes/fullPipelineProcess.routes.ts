import express from "express";
import {
  runForm4FullPipeline,
  // getForm4PipelineInfo,
} from "../controllers/form4FullPipeline.controller.js";

const router = express.Router();

// =====================================
// LIQUIDITY SIGNALS
// =====================================

/**
 * POST /v1/full-pipeline/form4
 * Execute complete Form 4 pipeline: Scrape latest Form 4s → Enrich contacts
 *
 * Body (optional):
 * {
 *   scrapeLimit?: number (default: 20, max: 40)
 *   skipEnrichment?: boolean (default: false)
 * }
 */
router.post("/form4", runForm4FullPipeline);

// =====================================
// NON-LIQUIDITY SIGNALS
// =====================================

// Job Postings Full Pipeline
// router.post("/job-postings", runJobPostingsFullPipeline);

export default router;
