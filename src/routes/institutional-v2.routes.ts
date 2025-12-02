/**
 * Institutional V2 Routes
 * Routes for the new 13F pipeline
 */

import express from "express";
import {
  process13FFilings,
  getFilers,
  getFilerByCIK,
  getFilerHoldings,
  searchFilers,
  getStats,
  getTargetCompanies,
  generateFilerInsights,
  generateAllFilersInsights,
  getFilersInsightsStatus,
} from "../controllers/institutional-v2.controller.js";

const router = express.Router();

/**
 * @route   POST /api/institutional-v2/process
 * @desc    Process 13F filings for target companies (2023-2025) then discover & process additional filers
 * @access  Public
 * @body    { startYear?: number, endYear?: number, cik?: string }
 */
router.post("/process", process13FFilings);

/**
 * @route   GET /api/institutional-v2/filers
 * @desc    Get list of all filers with pagination
 * @access  Public
 * @query   page, limit, sortBy, order, search
 */
router.get("/filers", getFilers);

/**
 * @route   GET /api/institutional-v2/filers/:cik
 * @desc    Get single filer details by CIK
 * @access  Public
 */
router.get("/filers/:cik", getFilerByCIK);

/**
 * @route   GET /api/institutional-v2/filers/:cik/holdings
 * @desc    Get holdings for a filer with QoQ timeline
 * @access  Public
 * @query   quarters, sortBy, changeType
 */
router.get("/filers/:cik/holdings", getFilerHoldings);

/**
 * @route   GET /api/institutional-v2/search
 * @desc    Search filers by name or CIK
 * @access  Public
 * @query   q, limit
 */
router.get("/search", searchFilers);

router.get("/stats", getStats);

router.get("/target-companies", getTargetCompanies);

router.post("/filers/:cik/generate-insights", generateFilerInsights);

router.post("/generate-all-insights", generateAllFilersInsights);

router.get("/insights-status", getFilersInsightsStatus);

export default router;
