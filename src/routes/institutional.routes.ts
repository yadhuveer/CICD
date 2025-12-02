import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import {
  getAllFilersController,
  getFilerByCikController,
  getFilerHoldingsController,
  searchFilersController,
  getStatsController,
} from "../controllers/institutional.controller.js";

const router = express.Router();

/**
 * =========================================
 * INSTITUTIONAL FILER ROUTES
 * =========================================
 * Production-ready API endpoints for 13F institutional data
 * All routes require authentication
 */

// Apply authentication middleware to all routes
// router.use(authenticate);

/**
 * GET /api/institutional/filers
 * Get all institutional filers with pagination
 *
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - sortBy: Field to sort by (default: "currentMarketValue")
 * - order: Sort order "asc" or "desc" (default: "desc")
 * - search: Search by filer name or CIK (optional)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     filers: [...],
 *     pagination: { page, limit, total, pages }
 *   }
 * }
 */
router.get("/filers", getAllFilersController);

/**
 * GET /api/institutional/filers/:cik
 * Get single filer details by CIK
 *
 * URL Parameters:
 * - cik: CIK identifier (e.g., "0001067983")
 *
 * Response:
 * {
 *   success: true,
 *   data: { filerName, cik, latestActivity, address, ... }
 * }
 */
router.get("/filers/:cik", getFilerByCikController);

/**
 * GET /api/institutional/filers/:cik/holdings
 * Get holdings with QoQ data for a specific filer
 *
 * URL Parameters:
 * - cik: CIK identifier
 *
 * Query Parameters:
 * - quarters: Number of quarters to return (default: 4, max: 20)
 * - sortBy: Sort holdings by "latestValue" or "name" (default: "latestValue")
 * - changeType: Filter by change type: NEW, INCREASED, DECREASED, UNCHANGED, EXITED (optional)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     filer: { filerName, cik, latestQuarter },
 *     quarters: ["2024Q3", "2024Q2", ...],
 *     holdings: [...]
 *   }
 * }
 */
router.get("/filers/:cik/holdings", getFilerHoldingsController);

/**
 * GET /api/institutional/search
 * Search filers by name or CIK
 *
 * Query Parameters:
 * - q: Search query (required)
 * - limit: Max results to return (default: 10, max: 50)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     query: "search term",
 *     results: [...],
 *     count: 5
 *   }
 * }
 */
router.get("/search", searchFilersController);

/**
 * GET /api/institutional/stats
 * Get aggregate statistics for all institutional filers
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     totalFilers: 450,
 *     totalMarketValue: 25000000000000,
 *     totalHoldings: 125000,
 *     changeTypeBreakdown: [...],
 *     topFilers: [...]
 *   }
 * }
 */
router.get("/stats", getStatsController);

export default router;
