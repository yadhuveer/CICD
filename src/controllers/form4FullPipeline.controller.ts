import { Request, Response } from "express";
import {
  executeForm4FullPipeline,
  // getForm4PipelineStats,
  Form4PipelineOptions,
} from "../services/form4FullPipeline.service.js";

/**
 * =====================================
 * FORM 4 FULL PIPELINE CONTROLLER
 * =====================================
 * Handles HTTP requests for the complete Form 4 pipeline
 * (Scrape → Enrich)
 *
 * This controller follows the Dependency Inversion Principle (DIP)
 * by depending on the service layer abstraction rather than
 * concrete implementations.
 */

/**
 * POST /v1/full-pipeline/form4
 * Execute the complete Form 4 pipeline: Scrape latest Form 4s and enrich them
 *
 * Request Body (optional):
 * {
 *   scrapeLimit?: number,      
 * }

 */
export const runForm4FullPipeline = async (req: Request, res: Response): Promise<void> => {
  try {
    const { scrapeLimit } = req.body as Form4PipelineOptions;

    console.log(`\n📨 API Request: Execute Form 4 Full Pipeline`);
    console.log(`   Scrape Limit: ${scrapeLimit || 20}`);

    // Validate scrapeLimit if provided
    if (scrapeLimit !== undefined) {
      if (typeof scrapeLimit !== "number" || scrapeLimit < 1 || scrapeLimit > 40) {
        res.status(400).json({
          success: false,
          error: "scrapeLimit must be a number between 1 and 40",
        });
        return;
      }
    }

    // Execute the full pipeline
    const result = await executeForm4FullPipeline({
      scrapeLimit,
    });

    // Return response
    if (result.success) {
      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: result.message,
        data: result,
      });
    }
  } catch (error: any) {
    console.error("❌ Form 4 Full Pipeline controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during Form 4 full pipeline execution",
      message: error.message,
    });
  }
};
