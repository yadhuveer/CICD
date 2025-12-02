import { Request, Response } from "express";
import {
  enrichSignalWithContact,
  enrichSignalsBatch,
  getPendingSignals,
  getPendingSignalsByFilingType,
  getEnrichmentStats,
  retryFailedEnrichments,
} from "../services/contactEnrichment.service.js";

import {
  enrichCompanySignal,
  enrichCompanySignalsBatch,
  getPendingCompanySignals,
  getPendingCompanySignalsByFilingType,
  getCompanyEnrichmentStats,
  retryFailedCompanyEnrichments as retryFailedCompanyEnrichmentsService,
} from "../services/companyEnrichment.service.js";

import { SignalNew } from "../models/newSignal.model.js";
import { contactOutService } from "../services/contactout.service.js";

import {
  scrapeTaxProfessionalsIndividual,
  TaxProfessionalSearchResult,
} from "../helpers/scrapeTaxEtorny.js";
import { processAllTaxProfiles } from "../services/tax.services.js";
import { analyzeDocumentsBatch } from "../tools/AiAgents/enritchmentAgent/insightsEnritchment.agent.js";
import { Contact } from "../models/Contacts.model.js";
import { ContactOutCache } from "../models/LocalContactOutDb.model.js";
import { enrichContactData } from "../tools/AiAgents/enritchmentAgent/contactDataEnrichment.agent.js";

/**
 * =====================================
 * ENRICHMENT CONTROLLER
 * =====================================
 * Handles HTTP requests for the signal-to-contact enrichment pipeline
 */

/**
 * POST /v1/enrichment/signal/:signalId
 * Enrich a single signal with contact data
 */
export const enrichSingleSignal = async (req: Request, res: Response): Promise<void> => {
  try {
    const { signalId } = req.params;

    console.log(`📨 API Request: Enrich signal ${signalId}`);

    // Validate signalId
    if (!signalId || signalId === "undefined") {
      res.status(400).json({
        success: false,
        error: "Signal ID is required",
      });
      return;
    }

    // Execute enrichment
    const result = await enrichSignalWithContact(signalId);

    // Return appropriate status code.
    if (result.success) {
      res.status(200).json({
        success: true,
        data: result,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.message,
        data: result,
      });
    }
  } catch (error: any) {
    console.error("❌ Enrichment controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during enrichment",
      message: error.message,
    });
  }
};

/**
 * POST /v1/enrichment/batch
 * Enrich multiple signals in batch
 * Body: { signalIds: string[] }
 */
export const enrichBatchSignals = async (req: Request, res: Response): Promise<void> => {
  try {
    const { signalIds } = req.body;

    console.log(`📨 API Request: Batch enrich ${signalIds?.length || 0} signals`);

    // Validate input
    if (!signalIds || !Array.isArray(signalIds) || signalIds.length === 0) {
      res.status(400).json({
        success: false,
        error: "signalIds array is required and must not be empty",
      });
      return;
    }

    // Limit batch size
    const MAX_BATCH_SIZE = 20;
    if (signalIds.length > MAX_BATCH_SIZE) {
      res.status(400).json({
        success: false,
        error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} signals`,
      });
      return;
    }

    // Execute batch enrichment
    const result = await enrichSignalsBatch(signalIds);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("❌ Batch enrichment controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during batch enrichment",
      message: error.message,
    });
  }
};

/**
 * POST /v1/enrichment/pending
 * Enrich pending signals (auto-fetch from database)
 * Body: { limit?: number }
 */
export const enrichPendingSignals = async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = 20 } = req.body;

    console.log(`📨 API Request: Enrich pending signals (limit: ${limit})`);

    // Validate limit
    if (limit > 100) {
      res.status(400).json({
        success: false,
        error: "Limit cannot exceed 100",
      });
      return;
    }

    // Get pending signals
    const pendingSignalIds = await getPendingSignals(limit);

    if (pendingSignalIds.length === 0) {
      res.status(200).json({
        success: true,
        message: "No pending signals to process",
        data: {
          totalSignals: 0,
          successful: 0,
          failed: 0,
          results: [],
        },
      });
      return;
    }

    console.log(`   Found ${pendingSignalIds.length} pending signals`);

    // Execute batch enrichment
    const result = await enrichSignalsBatch(pendingSignalIds);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("❌ Pending enrichment controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during pending enrichment",
      message: error.message,
    });
  }
};

/**
 * POST /v1/enrichment/by-filing-type
 * Enrich pending signals filtered by filing type(s)
 * Body: { filingTypes: string[], limit?: number }
 */
export const enrichByFilingType = async (req: Request, res: Response): Promise<void> => {
  try {
    const { filingTypes, limit = 50 } = req.body;

    console.log(
      `📨 API Request: Enrich signals by filing type (types: ${filingTypes?.join(", ") || "none"}, limit: ${limit})`,
    );

    // Validate filingTypes
    if (!filingTypes || !Array.isArray(filingTypes) || filingTypes.length === 0) {
      res.status(400).json({
        success: false,
        error: "filingTypes array is required and must not be empty",
        example: {
          filingTypes: ["form-4", "ma-event"],
          limit: 50,
        },
      });
      return;
    }

    // Validate limit
    if (limit > 100) {
      res.status(400).json({
        success: false,
        error: "Limit cannot exceed 100",
      });
      return;
    }

    // Get pending signals by filing type
    const pendingSignalIds = await getPendingSignalsByFilingType(filingTypes, limit);

    if (pendingSignalIds.length === 0) {
      res.status(200).json({
        success: true,
        message: `No pending signals found for filing types: ${filingTypes.join(", ")}`,
        data: {
          filingTypes,
          totalSignals: 0,
          successful: 0,
          failed: 0,
          alreadyProcessed: 0,
          contactsCreated: 0,
          contactsMatched: 0,
          noContactFound: 0,
          results: [],
        },
      });
      return;
    }

    console.log(`   Found ${pendingSignalIds.length} pending signals`);

    // Execute batch enrichment
    const result = await enrichSignalsBatch(pendingSignalIds);

    res.status(200).json({
      success: true,
      data: {
        filingTypes,
        ...result,
      },
    });
  } catch (error: any) {
    console.error("❌ Enrich by filing type controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during enrichment by filing type",
      message: error.message,
    });
  }
};

/**
 * GET /v1/enrichment/status/:signalId
 * Get enrichment status for a signal
 */
export const getSignalEnrichmentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { signalId } = req.params;

    console.log(`📨 API Request: Get status for signal ${signalId}`);

    // Validate signalId
    if (!signalId || signalId === "undefined") {
      res.status(400).json({
        success: false,
        error: "Signal ID is required",
      });
      return;
    }

    // Get signal
    const signal = await SignalNew.findById(signalId)
      .select("contactEnrichmentStatus contactEnrichmentDate contactEnrichmentError contactId")
      .populate("contactId", "fullName emailAddress phoneNumber linkedinUrl companyName");

    if (!signal) {
      res.status(404).json({
        success: false,
        error: "Signal not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        signalId,
        status: signal.contactEnrichmentStatus,
        enrichmentDate: signal.contactEnrichmentDate,
        error: signal.contactEnrichmentError,
        contact: signal.contactId,
      },
    });
  } catch (error: any) {
    console.error("❌ Status controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
    });
  }
};

/**
 * GET /v1/enrichment/stats
 * Get enrichment pipeline statistics
 */
export const getEnrichmentStatistics = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log(`📨 API Request: Get enrichment stats`);

    const stats = await getEnrichmentStats();

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("❌ Stats controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
    });
  }
};

/**
 * POST /v1/enrichment/retry-failed
 * Retry failed enrichments
 * Body: { limit?: number }
 */
export const retryFailed = async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = 20 } = req.body;

    console.log(`📨 API Request: Retry failed enrichments (limit: ${limit})`);

    // Validate limit
    if (limit > 100) {
      res.status(400).json({
        success: false,
        error: "Limit cannot exceed 100",
      });
      return;
    }

    const result = await retryFailedEnrichments(limit);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("❌ Retry failed controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during retry",
      message: error.message,
    });
  }
};

/**
 * POST /v1/enrichment/test-contactout
 * Test ContactOut API connection
 * Body: { fullName: string, companyName?: string }
 */
export const testContactOut = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, companyName } = req.body;

    console.log(`📨 API Request: Test ContactOut API`);
    console.log(`   Full Name: "${fullName}"`);
    console.log(`   Company Name: "${companyName || "N/A"}"`);

    // Validate input
    if (!fullName) {
      res.status(400).json({
        success: false,
        error: "fullName is required",
      });
      return;
    }

    // Call ContactOut service
    const result = await contactOutService.searchContact({
      fullName,
      companyName,
    });

    // Return detailed result
    res.status(200).json({
      success: true,
      data: {
        found: result.found,
        source: result.source,
        searchAttempts: result.searchAttempts,
        person: result.data || null,
        error: result.error || null,
      },
    });
  } catch (error: any) {
    console.error("❌ Test ContactOut controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during ContactOut test",
      message: error.message,
    });
  }
};

// =====================================
// COMPANY ENRICHMENT CONTROLLERS
// =====================================

/**
 * POST /v1/enrichment/company/:signalId
 * Enrich a single Company-type signal
 */
export const enrichSingleCompanySignal = async (req: Request, res: Response): Promise<void> => {
  try {
    const { signalId } = req.params;

    console.log(`📨 API Request: Enrich company signal ${signalId}`);

    // Validate signalId
    if (!signalId || signalId === "undefined") {
      res.status(400).json({
        success: false,
        error: "Signal ID is required",
      });
      return;
    }

    // Execute enrichment
    const result = await enrichCompanySignal(signalId);

    // Return appropriate status code
    if (result.success) {
      res.status(200).json({
        success: true,
        data: result,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.message,
        data: result,
      });
    }
  } catch (error: any) {
    console.error("❌ Company enrichment controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during company enrichment",
      message: error.message,
    });
  }
};

/**
 * POST /v1/enrichment/company/batch
 * Enrich multiple Company signals in batch
 * Body: { signalIds: string[] }
 */
export const enrichBatchCompanySignals = async (req: Request, res: Response): Promise<void> => {
  try {
    const { signalIds } = req.body;

    console.log(`📨 API Request: Batch enrich ${signalIds?.length || 0} company signals`);

    // Validate input
    if (!signalIds || !Array.isArray(signalIds) || signalIds.length === 0) {
      res.status(400).json({
        success: false,
        error: "signalIds array is required and must not be empty",
      });
      return;
    }

    // Limit batch size
    const MAX_BATCH_SIZE = 20;
    if (signalIds.length > MAX_BATCH_SIZE) {
      res.status(400).json({
        success: false,
        error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} signals`,
      });
      return;
    }

    // Execute batch enrichment
    const result = await enrichCompanySignalsBatch(signalIds);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("❌ Batch company enrichment controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during batch company enrichment",
      message: error.message,
    });
  }
};

/**
 * POST /v1/enrichment/company/pending
 * Enrich pending Company signals (auto-fetch from database)
 * Body: { limit?: number }
 */
export const enrichPendingCompanySignals = async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = 20 } = req.body;

    console.log(`API Request: Enrich pending company signals (limit: ${limit})`);

    // Validate limit
    if (limit > 100) {
      res.status(400).json({
        success: false,
        error: "Limit cannot exceed 100",
      });
      return;
    }

    // Get pending company signals
    const pendingSignalIds = await getPendingCompanySignals(limit);

    if (pendingSignalIds.length === 0) {
      res.status(200).json({
        success: true,
        message: "No pending company signals to process",
        data: {
          totalSignals: 0,
          successful: 0,
          failed: 0,
          results: [],
        },
      });
      return;
    }

    console.log(`   Found ${pendingSignalIds.length} pending company signals`);

    // Execute batch enrichment
    const result = await enrichCompanySignalsBatch(pendingSignalIds);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Pending company enrichment controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during pending company enrichment",
      message: error.message,
    });
  }
};

/**
 * POST /v1/enrichment/company/by-filing-type
 * Enrich pending Company signals filtered by filing type(s)
 */
export const enrichCompanyByFilingType = async (req: Request, res: Response): Promise<void> => {
  try {
    const { filingTypes, limit = 10 } = req.body;

    console.log(
      `📨 API Request: Enrich company signals by filing type (types: ${filingTypes?.join(", ") || "none"}, limit: ${limit})`,
    );

    // Validate filingTypes
    if (!filingTypes || !Array.isArray(filingTypes) || filingTypes.length === 0) {
      res.status(400).json({
        success: false,
        error: "filingTypes array is required and must not be empty",
        example: {
          filingTypes: ["hiring-event"],
          limit: 10,
        },
      });
      return;
    }

    // Validate limit
    if (limit > 100) {
      res.status(400).json({
        success: false,
        error: "Limit cannot exceed 100",
      });
      return;
    }

    // Get pending company signals by filing type
    const pendingSignalIds = await getPendingCompanySignalsByFilingType(filingTypes, limit);

    if (pendingSignalIds.length === 0) {
      res.status(200).json({
        success: true,
        message: `No pending company signals found for filing types: ${filingTypes.join(", ")}`,
        data: {
          filingTypes,
          totalSignals: 0,
          successful: 0,
          failed: 0,
          results: [],
        },
      });
      return;
    }

    console.log(`   Found ${pendingSignalIds.length} pending company signals`);

    // Execute batch enrichment
    const result = await enrichCompanySignalsBatch(pendingSignalIds);

    res.status(200).json({
      success: true,
      data: {
        filingTypes,
        ...result,
      },
    });
  } catch (error: any) {
    console.error("❌ Enrich company by filing type controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during company enrichment by filing type",
      message: error.message,
    });
  }
};

/**
 * GET /v1/enrichment/company/stats
 * Get company enrichment pipeline statistics
 */
export const getCompanyEnrichmentStatistics = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    console.log(`📨 API Request: Get company enrichment stats`);

    const stats = await getCompanyEnrichmentStats();

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("❌ Company stats controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
    });
  }
};

/**
 * POST /v1/enrichment/company/retry-failed
 * Retry failed company enrichments
 * Body: { limit?: number }
 */
export const retryFailedCompanyEnrichments = async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = 20 } = req.body;

    console.log(`📨 API Request: Retry failed company enrichments (limit: ${limit})`);

    // Validate limit
    if (limit > 100) {
      res.status(400).json({
        success: false,
        error: "Limit cannot exceed 100",
      });
      return;
    }

    const result = await retryFailedCompanyEnrichmentsService(limit);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("❌ Retry failed company enrichments controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during retry",
      message: error.message,
    });
  }
};

//// TAX Data Enrichment

export const enrichTaxData = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = 1, designation = "Tax Attorney" } = req.body;

    console.log(`API Request: Enrich tax data (page: ${page}, designation: ${designation})`);

    // Get tax data from scraper
    const taxData: TaxProfessionalSearchResult = await scrapeTaxProfessionalsIndividual(
      page,
      designation,
    );

    if (taxData.profiles.length === 0) {
      res.status(200).json({
        success: true,
        message: "No Tax Data found",
        data: {
          totalTaxProfiles: 0,
          successful: 0,
          failed: 0,
          results: [],
        },
      });
      return;
    }

    // Process all profiles.
    const result = await processAllTaxProfiles(taxData.profiles);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Tax Data enrichment controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during tax data enrichment",
      message: error.message,
    });
  }
};

/**
 * POST /v1/enrichment/contact/:contactId
 * Enrich a contact using AI agent with ContactOut cache data
 */
export const enrichContactWithAI = async (req: Request, res: Response): Promise<void> => {
  try {
    const { contactId } = req.params;

    console.log(`📨 API Request: AI Enrich contact ${contactId}`);

    if (!contactId || contactId === "undefined") {
      res.status(400).json({
        success: false,
        error: "Contact ID is required",
      });
      return;
    }

    const contact = await Contact.findById(contactId);

    if (!contact) {
      res.status(404).json({
        success: false,
        error: "Contact not found",
      });
      return;
    }

    // Check enrichment status
    if (contact.aiEnrichmentStatus === "completed") {
      return res.status(200).json({
        success: true,
        message: "Contact already enriched — skipping AI enrichment.",
        data: {
          contactId,
          enriched: true,
          aiEnrichmentStatus: contact.aiEnrichmentStatus,
          aiEnrichmentDate: contact.aiEnrichmentDate,
          updatedContact: contact,
        },
      }) as any;
    }

    if (contact.aiEnrichmentStatus === "in_progress") {
      return res.status(409).json({
        success: false,
        error: "Enrichment already in progress for this contact",
        data: {
          contactId,
          aiEnrichmentStatus: contact.aiEnrichmentStatus,
        },
      }) as any;
    }

    // Fetch ContactOut cache data
    let rawContactData = null;
    if (contact.contactCache && contact.contactCache.length > 0) {
      const cacheId = contact.contactCache[0].contactcacheId;
      const cacheData = await ContactOutCache.findById(cacheId);
      if (cacheData) rawContactData = cacheData.rawResponse;
    }

    // No cache → fail
    if (!rawContactData) {
      await Contact.findByIdAndUpdate(contactId, {
        $set: {
          aiEnrichmentStatus: "failed",
          aiEnrichmentDate: new Date(),
          aiEnrichmentError: "No ContactOut cache found for this contact",
        },
      });

      res.status(400).json({
        success: false,
        error: "No ContactOut cache found for this contact. Enrichment aborted.",
      });
      return;
    }

    // Set status to in_progress
    await Contact.findByIdAndUpdate(contactId, {
      $set: {
        aiEnrichmentStatus: "in_progress",
      },
    });

    // Prepare the payload for AI.
    const enrichmentInput = {
      fullName: contact.fullName,
      companyName: contact.companyName,
      designation:
        contact.companies && contact.companies.length > 0
          ? (contact.companies[0] as any).designation
          : undefined,
      linkedinUrl: contact.linkedinUrl,
      location: contact.primaryAddress?.[0],
      age: contact.age,
      signals: JSON.stringify(rawContactData),
    };

    console.log(`🤖 Sending contact data to AI enrichment agent...`);

    let enrichedData;
    try {
      // Run agent
      enrichedData = await enrichContactData(enrichmentInput);
      console.log(`✅ AI enrichment complete for contact ${contactId}`);
    } catch (enrichmentError: any) {
      console.error(`❌ AI enrichment failed for contact ${contactId}:`, enrichmentError);

      await Contact.findByIdAndUpdate(contactId, {
        $set: {
          aiEnrichmentStatus: "failed",
          aiEnrichmentDate: new Date(),
          aiEnrichmentError: enrichmentError.message || "AI enrichment failed",
        },
      });

      throw enrichmentError;
    }

    // ----------- CLEAN UPDATE LOGIC -------------
    const updatePayload: any = {};

    for (const [key, value] of Object.entries(enrichedData)) {
      if (value === undefined || value === null) continue;

      // Skip empty arrays
      if (Array.isArray(value) && value.length === 0) continue;

      // Skip empty strings
      if (typeof value === "string" && value.trim() === "") continue;

      // Handle dateOfBirth safely
      if (key === "dateOfBirth") {
        if (!isNaN(Date.parse(value as any))) {
          updatePayload[key] = new Date(value as any);
        }
        continue;
      }

      updatePayload[key] = value;
    }

    // Add enrichment status to the update
    updatePayload.aiEnrichmentStatus = "completed";
    updatePayload.aiEnrichmentDate = new Date();
    updatePayload.aiEnrichmentError = undefined;

    // Update DB
    const updatedContact = await Contact.findByIdAndUpdate(
      contactId,
      { $set: updatePayload, $unset: { aiEnrichmentError: "" } },
      { new: true },
    );

    // Response
    res.status(200).json({
      success: true,
      message: "Contact enriched successfully with AI",
      data: {
        contactId,
        originalContact: {
          fullName: contact.fullName,
          companyName: contact.companyName,
          linkedinUrl: contact.linkedinUrl,
        },
        enrichedData,
        aiEnrichmentStatus: "completed",
        aiEnrichmentDate: updatePayload.aiEnrichmentDate,
        savedToDb: true,
        updatedContact,
      },
    });
  } catch (error: any) {
    console.error("❌ Contact AI enrichment controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during contact AI enrichment",
      message: error.message,
    });
  }
};
