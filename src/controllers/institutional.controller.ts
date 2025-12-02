import { Request, Response } from "express";
import {
  getAllFilers,
  getFilerByCik,
  getFilerHoldings,
  searchFilers,
  getInstitutionalStats,
} from "../services/institutional.service.js";
import logger from "../utils/logger.js";

export const getAllFilersController = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "20",
      sortBy = "currentMarketValue",
      order = "desc",
      search,
    } = req.query;

    // Validate and parse parameters
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid page parameter. Must be a positive integer.",
      });
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: "Invalid limit parameter. Must be between 1 and 100.",
      });
    }

    const orderValue = order === "asc" ? "asc" : "desc";

    // Fetch filers
    const result = await getAllFilers({
      page: pageNum,
      limit: limitNum,
      sortBy: sortBy as string,
      order: orderValue,
      search: search as string | undefined,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error(`❌ Error in getAllFilersController: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * GET /api/institutional/filers/:cik
 * Get single filer details by CIK
 */
export const getFilerByCikController = async (req: Request, res: Response) => {
  try {
    const { cik } = req.params;

    if (!cik) {
      return res.status(400).json({
        success: false,
        message: "CIK parameter is required",
      });
    }

    const filer = await getFilerByCik(cik);

    res.status(200).json({
      success: true,
      data: filer,
    });
  } catch (error: any) {
    logger.error(`❌ Error in getFilerByCikController: ${error.message}`);

    // Return 404 if filer not found
    if (error.message.includes("not found")) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * GET /api/institutional/filers/:cik/holdings
 * Get holdings with QoQ data for a specific filer
 */
export const getFilerHoldingsController = async (req: Request, res: Response) => {
  try {
    const { cik } = req.params;
    const { quarters = "4", sortBy = "latestValue", changeType } = req.query;

    if (!cik) {
      return res.status(400).json({
        success: false,
        message: "CIK parameter is required",
      });
    }

    // Validate quarters parameter
    const quartersNum = parseInt(quarters as string, 10);
    if (isNaN(quartersNum) || quartersNum < 1 || quartersNum > 20) {
      return res.status(400).json({
        success: false,
        message: "Invalid quarters parameter. Must be between 1 and 20.",
      });
    }

    // Validate changeType if provided
    const validChangeTypes = ["NEW", "INCREASED", "DECREASED", "UNCHANGED", "EXITED"];
    if (changeType && !validChangeTypes.includes(changeType as string)) {
      return res.status(400).json({
        success: false,
        message: `Invalid changeType. Must be one of: ${validChangeTypes.join(", ")}`,
      });
    }

    const result = await getFilerHoldings(
      cik,
      quartersNum,
      sortBy as string,
      changeType as string | undefined,
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error(`❌ Error in getFilerHoldingsController: ${error.message}`);

    // Return 404 if filer not found
    if (error.message.includes("not found")) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * GET /api/institutional/search
 * Search filers by name or CIK
 */
export const searchFilersController = async (req: Request, res: Response) => {
  try {
    const { q, limit = "10" } = req.query;

    if (!q || typeof q !== "string" || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Search query parameter 'q' is required",
      });
    }

    const limitNum = parseInt(limit as string, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      return res.status(400).json({
        success: false,
        message: "Invalid limit parameter. Must be between 1 and 50.",
      });
    }

    const results = await searchFilers(q.trim(), limitNum);

    res.status(200).json({
      success: true,
      data: {
        query: q.trim(),
        results,
        count: results.length,
      },
    });
  } catch (error: any) {
    logger.error(`❌ Error in searchFilersController: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * GET /api/institutional/stats
 * Get aggregate statistics for institutional filers
 */
export const getStatsController = async (req: Request, res: Response) => {
  try {
    const stats = await getInstitutionalStats();

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    logger.error(`❌ Error in getStatsController: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
