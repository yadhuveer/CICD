import { Request, Response } from "express";
import httpStatus from "http-status";
import { Contact } from "../models/Contacts.model.js";

import { analyzeTaxProfessionalForInsights } from "../tools/AiAgents/enritchmentAgent/taxProfessionalInsights.agent.js";
import {
  enrichContactWithSignalInsights,
  enrichContactsBatch,
  enrichAllUnprocessedContacts,
} from "../services/contactInsightsEnrichment.service.js";
import logger from "../utils/logger.js";

/**
 * Helper function to process items in batches with intelligent rate limiting
 * @param items - Array of items to process
 * @param batchSize - Number of items to process in each batch
 * @param delayMs - Minimum delay in milliseconds between batches
 * @param processFn - Async function to process each item
 * @returns Promise resolving to array of settled results
 */
async function processBatchesWithRateLimit<T, R>(
  items: T[],
  batchSize: number,
  delayMs: number,
  processFn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const allResults: PromiseSettledResult<R>[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(items.length / batchSize);

    logger.info(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} items)...`);

    const batchStartTime = Date.now();
    const batchResults = await Promise.allSettled(batch.map((item) => processFn(item)));
    const batchDuration = Date.now() - batchStartTime;

    allResults.push(...batchResults);

    const successCount = batchResults.filter((r) => r.status === "fulfilled").length;
    const failCount = batchResults.filter((r) => r.status === "rejected").length;

    logger.info(
      `✅ Batch ${batchNumber}/${totalBatches} complete in ${batchDuration}ms: ${successCount} succeeded, ${failCount} failed`,
    );

    // Check for rate limit errors
    const rateLimitErrors = batchResults.filter(
      (r) => r.status === "rejected" && r.reason?.message?.includes("rate_limit"),
    );

    // Calculate smart delay based on batch duration and rate limit errors
    if (i + batchSize < items.length) {
      let smartDelay = delayMs;

      // If batch took longer than expected or we hit rate limits, increase delay
      if (batchDuration > 30000 || rateLimitErrors.length > 0) {
        smartDelay = Math.max(delayMs, 30000); // Wait at least 30 seconds
        logger.info(
          `⚠️  Batch took ${batchDuration}ms or had rate limit errors. Increasing delay to ${smartDelay}ms`,
        );
      }

      logger.info(`⏳ Waiting ${smartDelay}ms before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, smartDelay));
    }
  }

  return allResults;
}

/**
 * Analyze tax professional / advisor insights from ContactOut cache data
 * @route POST /v1/insights/analyze-tax-professional/:contactId
 * @param contactId - The MongoDB ObjectId of the contact
 * @returns Structured advisor insight analysis from the tax professional agent
 */
export const analyzeTaxProfessionalInsights = async (req: Request, res: Response) => {
  try {
    const { contactId } = req.params;

    // Validate contactId format
    if (!contactId || !contactId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        message: "Invalid contact ID format",
      });
    }

    logger.info(`🔍 Fetching tax professional with ID: ${contactId}`);

    // Fetch contact with populated contactCache
    const contact = await Contact.findById(contactId).populate("contactCache.contactcacheId");

    if (!contact) {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        message: "Contact not found",
      });
    }

    // Check if contactCache exists
    if (!contact.contactCache || contact.contactCache.length === 0) {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        message: "No ContactOut cache data found for this contact",
      });
    }

    // Get the first contactCache entry
    const contactCacheEntry = contact.contactCache[0];

    if (!contactCacheEntry.contactcacheId) {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        message: "ContactOut cache reference is invalid",
      });
    }

    // Type assertion for populated document
    const contactOutCache = contactCacheEntry.contactcacheId as any;

    // Check if rawResponse exists
    if (!contactOutCache.rawResponse) {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        message: "No raw response found in ContactOut cache",
      });
    }

    logger.info(`📄 Found ContactOut cache data, analyzing with tax professional agent...`);

    // Convert rawResponse to string
    const rawResponseString =
      typeof contactOutCache.rawResponse === "string"
        ? contactOutCache.rawResponse
        : JSON.stringify(contactOutCache.rawResponse, null, 2);

    // Analyze with the tax professional agent
    const advisorAnalysis = await analyzeTaxProfessionalForInsights(rawResponseString);

    // Save the insight as a single object (overwrites previous insight)
    contact.insight = {
      informativeInsight: advisorAnalysis.informativeInsight || "",
      actionableInsight: advisorAnalysis.actionableInsight || "",
    };

    // Update lead score if available (tax professional uses advisorLeadScore)
    if (advisorAnalysis.advisorLeadScore !== undefined) {
      contact.leadScore = advisorAnalysis.advisorLeadScore;
    }

    // Save the updated contact
    await contact.save();

    logger.info(`✅ Tax professional analysis completed and saved for: ${contact.fullName}`);

    // Return the analysis result
    return res.status(httpStatus.OK).json({
      success: true,
      data: {
        contactId: contact._id,
        contactName: contact.fullName,
        analysisType: "tax_professional_advisor",
        analysis: advisorAnalysis,
        insight: contact.insight,
        leadScore: contact.leadScore,
      },
    });
  } catch (error: any) {
    logger.error(`❌ Error analyzing tax professional:`, error);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to analyze tax professional",
      error: error.message,
    });
  }
};

/**
 * Analyze all contacts with sourceOfInformation="tax-professional-scrape"
 * @route POST /v1/insights/analyze-all-tax-professionals
 * @query batchSize - Number of contacts to process in each batch (default: 5)
 * @query delayMs - Minimum delay in milliseconds between batches (default: 20000 = 20 seconds).
 * @returns Analysis results for all tax professional contacts.
 */
export const analyzeAllTaxProfessionals = async (req: Request, res: Response) => {
  try {
    // Get rate limiting parameters from query string with safer defaults
    const batchSize = parseInt(req.query.batchSize as string) || 5;
    const delayMs = parseInt(req.query.delayMs as string) || 20000; // 20 seconds default

    logger.info(`🔍 Fetching all contacts with sourceOfInformation="tax-professional-scrape"...`);
    logger.info(
      `⚙️  Rate limiting: ${batchSize} contacts per batch, ${delayMs}ms delay between batches`,
    );

    // Find all contacts with sourceOfInformation="tax-professional-scrape"
    const contacts = await Contact.find({
      sourceOfInformation: "tax-professional-scrape",
    }).select("_id fullName");

    if (!contacts || contacts.length === 0) {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        message: "No tax professional contacts found",
      });
    }

    const contactIds = contacts.map((c) => c._id.toString());

    logger.info(
      `📊 Found ${contactIds.length} tax professional contacts. Starting batch analysis...`,
    );

    // Process contacts with rate limiting
    const results = await processBatchesWithRateLimit(
      contactIds,
      batchSize,
      delayMs,
      async (contactId) => {
        const contact = await Contact.findById(contactId).populate("contactCache.contactcacheId");

        if (!contact || !contact.contactCache || contact.contactCache.length === 0) {
          throw new Error(`No cache data for contact ${contactId}`);
        }

        const contactOutCache = contact.contactCache[0].contactcacheId as any;

        if (!contactOutCache?.rawResponse) {
          throw new Error(`No raw response for contact ${contactId}`);
        }

        const rawResponseString =
          typeof contactOutCache.rawResponse === "string"
            ? contactOutCache.rawResponse
            : JSON.stringify(contactOutCache.rawResponse, null, 2);

        const analysis = await analyzeTaxProfessionalForInsights(rawResponseString);

        // Save the insight as a single object (overwrites previous insight)
        contact.insight = {
          informativeInsight: analysis.informativeInsight || "",
          actionableInsight: analysis.actionableInsight || "",
        };

        // Update lead score if available (tax professional uses advisorLeadScore)
        if (analysis.advisorLeadScore !== undefined) {
          contact.leadScore = analysis.advisorLeadScore;
        }

        // Save the updated contact
        await contact.save();

        return {
          contactId: contact._id,
          contactName: contact.fullName,
          analysisType: "tax_professional_advisor",
          analysis,
          insight: contact.insight,
          leadScore: contact.leadScore,
        };
      },
    );

    // Separate successful and failed analyses
    const successful = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value);

    const failed = results
      .filter((r) => r.status === "rejected")
      .map((r, index) => ({
        contactId: contactIds[index],
        contactName: contacts[index]?.fullName || "Unknown",
        error: (r as PromiseRejectedResult).reason.message,
      }));

    logger.info(
      `✅ All tax professionals analysis complete: ${successful.length} successful, ${failed.length} failed`,
    );

    return res.status(httpStatus.OK).json({
      success: true,
      data: {
        successful,
        failed,
        summary: {
          total: contactIds.length,
          successCount: successful.length,
          failureCount: failed.length,
        },
      },
    });
  } catch (error: any) {
    logger.error(`❌ Error in analyzing all tax professionals:`, error);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to analyze all tax professionals",
      error: error.message,
    });
  }
};

/**
 * Enrich a single contact with insights from their linked signal
 * @route POST /v1/insights/enrich-contact/:contactId
 * @param contactId - The MongoDB ObjectId of the contact
 * @returns Enrichment result with insights and lead score
 */
export const enrichSingleContact = async (req: Request, res: Response) => {
  try {
    const { contactId } = req.params;

    // Validate contactId format
    if (!contactId || !contactId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        message: "Invalid contact ID format",
      });
    }

    logger.info(`🔍 Enriching single contact: ${contactId}`);

    const result = await enrichContactWithSignalInsights(contactId);

    if (!result.success) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(httpStatus.OK).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error(`❌ Error enriching single contact:`, error);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to enrich contact",
      error: error.message,
    });
  }
};

/**
 * Enrich multiple contacts in batch
 * @route POST /v1/insights/enrich-contacts-batch
 * @body contactIds - Array of contact IDs to enrich
 * @body batchSize - Optional batch size (default: 5)
 * @body delayMs - Optional delay between batches in ms (default: 20000)
 * @returns Batch enrichment results.
 */
export const enrichContactsBatchController = async (req: Request, res: Response) => {
  try {
    const { contactIds, batchSize = 5, delayMs = 20000 } = req.body;

    // Validate input
    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        message: "contactIds array is required and must not be empty",
      });
    }

    // Validate all contactIds
    const invalidIds = contactIds.filter((id) => !id.match(/^[0-9a-fA-F]{24}$/));
    if (invalidIds.length > 0) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        message: "Invalid contact ID format",
        invalidIds,
      });
    }

    logger.info(`🚀 Starting batch enrichment for ${contactIds.length} contacts...`);

    const result = await enrichContactsBatch(contactIds, batchSize, delayMs);

    return res.status(httpStatus.OK).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error(`❌ Error in batch enrichment:`, error);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to enrich contacts in batch",
      error: error.message,
    });
  }
};

/**
 * Enrich all unprocessed contacts
 * @route POST /v1/insights/enrich-unprocessed-contacts
 * @body limit - Maximum number of contacts to process (default: 50)
 * @body batchSize - Batch size (default: 5)
 * @body delayMs - Delay between batches in ms (default: 20000)
 * @returns Enrichment results for unprocessed contacts
 */
export const enrichUnprocessedContacts = async (req: Request, res: Response) => {
  try {
    const { limit = 50, batchSize = 5, delayMs = 20000 } = req.body;

    logger.info(`🔍 Finding and enriching unprocessed contacts (limit: ${limit})...`);

    const result = await enrichAllUnprocessedContacts(limit, batchSize, delayMs);

    if (result.totalContacts === 0) {
      return res.status(httpStatus.OK).json({
        success: true,
        message: "No unprocessed contacts found",
        data: result,
      });
    }

    return res.status(httpStatus.OK).json({
      success: true,
      message: `Processed ${result.totalContacts} contacts`,
      data: result,
    });
  } catch (error: any) {
    logger.error(`❌ Error enriching unprocessed contacts:`, error);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to enrich unprocessed contacts",
      error: error.message,
    });
  }
};
