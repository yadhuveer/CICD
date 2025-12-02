import { Request, Response } from "express";
import { Signal } from "../models/Signals.model.js";
import { SignalNew } from "../models/newSignal.model.js";
import { Contact } from "../models/Contacts.model.js";
import httpStatus from "http-status";
import {
  getSignalPipelineStatistics,
  getSignalPipelineStatisticsByDateRange,
} from "../helpers/signalPipelineStats.helper.js";
import {
  getContactHitRateStatistics,
  getContactHitRateStatisticsByDateRange,
} from "../helpers/contactHitRate.helper.js";

/**
 * GET /signals
 * Get all signals with enriched contacts (paginated)
 */
export const getAllSignalsWithContacts = async (req: Request, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      signalSource,
      sentiment,
      contactEnrichmentStatus,
      sort = "-createdAt",
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build filter query
    const filter: any = {};
    if (signalSource) filter.signalSource = signalSource;
    if (sentiment) filter.sentiment = sentiment;
    if (contactEnrichmentStatus) filter.contactEnrichmentStatus = contactEnrichmentStatus;

    // Get total count
    const total = await Signal.countDocuments(filter);

    // Get signals with populated contacts
    const signals = await Signal.find(filter)
      .populate("enrichedContacts")
      .sort(sort as string)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Transform signals to flatten contact data for frontend
    const transformedSignals = signals.map((signal) => {
      const enrichedContacts = Array.isArray(signal.enrichedContacts)
        ? signal.enrichedContacts
        : [];
      const keyPeople = Array.isArray(signal.keyPeople) ? signal.keyPeople : [];

      // Combine both enrichedContacts and keyPeople
      const allContacts = [
        // First add enriched contacts from Contact collection
        ...enrichedContacts.map((contact: any) => ({
          id: contact._id,
          fullName: contact.fullName,
          email: contact.emailAddress?.business?.[0] || contact.emailAddress?.personal?.[0],
          phone: null,
          title: contact.occupationTitle,
          company: signal.companyName,
          location: contact.primaryAddress || contact.stateOfResidence,
          netWorth: contact.totalNetWorth,
          annualIncome: contact.annualEarnedIncome,
          leadScore: contact.leadScore,
          outreachScore: contact.outreachScore,
          sourceOfInformation: contact.sourceOfInformation,
          dateAdded: contact.createdAt,
          source: "enriched",
        })),
        // Then add keyPeople from Signal (people without full enrichment)
        ...keyPeople.map((person: any) => ({
          id: signal._id + "_" + person._id, // Composite ID since keyPeople don't have separate IDs
          fullName: person.fullName,
          email: null, // keyPeople don't have emails
          phone: null,
          title: person.designation || person.officerTitle,
          company: signal.companyName,
          location: person.location,
          // Fallback to signal-level data if person-level data is missing
          netWorth: person.totalNetWorth || (signal as any).totalNetWorth,
          annualIncome: person.annualEarnedIncome || (signal as any).annualEarnedIncome,
          leadScore: person.leadScore || 0,
          outreachScore: person.outreachScore || 0,
          sourceOfInformation: person.sourceOfInformation || "SEC Form 4 Filing",
          dateAdded: person.dateAdded,
          source: "keyPeople",
        })),
      ];

      return {
        ...signal,
        contacts: allContacts,
      };
    });

    res.status(httpStatus.OK).json({
      success: true,
      data: transformedSignals,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  } catch (error: any) {
    console.error("Error fetching signals:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch signals",
      error: error.message,
    });
  }
};

/**
 * GET /signals/:id
 * Get a single signal by ID with populated enriched contacts
 */
export const getSignalById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // First try SignalNew (new signal model), then fallback to Signal (old model)
    let signal: any = await SignalNew.findById(id).lean();
    let isOldModel = false;

    if (!signal) {
      signal = await Signal.findById(id).populate("enrichedContacts").lean();
      isOldModel = true;
    }

    if (!signal) {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        message: "Signal not found",
      });
    }

    // Transform signal with contact data
    const enrichedContacts =
      isOldModel && Array.isArray(signal.enrichedContacts) ? signal.enrichedContacts : [];
    const keyPeople = Array.isArray(signal.keyPeople) ? signal.keyPeople : [];

    // Combine both enrichedContacts and keyPeople
    const allContacts = [
      // First add enriched contacts from Contact collection
      ...enrichedContacts.map((contact: any) => ({
        id: contact._id,
        fullName: contact.fullName,
        email: contact.emailAddress?.business?.[0] || contact.emailAddress?.personal?.[0],
        phone: null,
        title: contact.occupationTitle,
        company: signal.companyName,
        location: contact.primaryAddress || contact.stateOfResidence,
        dateOfBirth: contact.dateOfBirth,
        age: contact.age,
        maritalStatus: contact.maritalStatus,
        citizenshipResidency: contact.citizenshipResidency,

        // Financial data
        netWorth: contact.totalNetWorth,
        liquidNetWorth: contact.liquidNetWorth,
        annualIncome: contact.annualEarnedIncome,
        otherIncome: contact.otherIncome,
        expectedFutureIncomeEvents: contact.expectedFutureIncomeEvents,

        // Portfolio
        currentPortfolioHoldings: contact.currentPortfolioHoldings,
        concentratedPositions: contact.concentratedPositions,
        investmentInterests: contact.investmentInterests,
        riskTolerance: contact.riskTolerance,

        // Goals
        retirementGoals: contact.retirementGoals,
        philanthropicGoals: contact.philanthropicGoals,
        wealthTransferGoals: contact.wealthTransferGoals,

        // Metadata
        leadScore: contact.leadScore,
        outreachScore: contact.outreachScore,
        sourceOfInformation: contact.sourceOfInformation,
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
        source: "enriched",
      })),
      // Then add keyPeople from Signal
      ...keyPeople.map((person: any) => ({
        id: signal._id + "_" + person._id,
        fullName: person.fullName,
        email: null,
        phone: null,
        title: person.designation || person.officerTitle,
        company: signal.companyName,
        location: person.location,
        dateOfBirth: null,
        age: null,
        maritalStatus: null,
        citizenshipResidency: null,

        // Financial data - fallback to signal-level data if person-level data is missing
        netWorth: person.totalNetWorth || (signal as any).totalNetWorth,
        liquidNetWorth: null,
        annualIncome: person.annualEarnedIncome || (signal as any).annualEarnedIncome,
        otherIncome: null,
        expectedFutureIncomeEvents:
          person.expectedFutureIncomeEvents || (signal as any).expectedFutureIncomeEvents,

        // Portfolio
        currentPortfolioHoldings: null,
        concentratedPositions: null,
        investmentInterests: null,
        riskTolerance: null,

        // Goals
        retirementGoals: null,
        philanthropicGoals: null,
        wealthTransferGoals: null,

        // Metadata
        leadScore: person.leadScore || 0,
        outreachScore: person.outreachScore || 0,
        sourceOfInformation: person.sourceOfInformation || "SEC Form 4 Filing",
        createdAt: person.dateAdded,
        updatedAt: person.lastUpdated,
        source: "keyPeople",
      })),
    ];

    // Extract keyInsights based on signal type
    let keyInsights: string[] = [];

    // Check if it's a SignalNew with maEventData
    if ((signal as any).maEventData?.insights?.keyInsights) {
      keyInsights = (signal as any).maEventData.insights.keyInsights;
    }
    // Check if it's a SignalNew with insights string
    else if ((signal as any).insights) {
      keyInsights = [(signal as any).insights];
    }
    // Check if it's old Signal model with keyInsights array
    else if ((signal as any).keyInsights) {
      keyInsights = (signal as any).keyInsights;
    }

    const transformedSignal = {
      ...signal,
      contacts: allContacts,
      keyInsights, // Add keyInsights to response
    };

    res.status(httpStatus.OK).json({
      success: true,
      data: transformedSignal,
    });
  } catch (error: any) {
    console.error("Error fetching signal:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch signal",
      error: error.message,
    });
  }
};

/**
 * GET /signals/search?q=searchTerm
 * Search signals by name, company, or other fields
 */
export const searchSignals = async (req: Request, res: Response) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;

    if (!q || typeof q !== "string") {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        message: "Search query 'q' is required",
      });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Search across multiple fields
    const searchFilter = {
      $or: [
        { fullName: { $regex: q, $options: "i" } },
        { companyName: { $regex: q, $options: "i" } },
        { companyTicker: { $regex: q, $options: "i" } },
        { insiderName: { $regex: q, $options: "i" } },
        { designation: { $regex: q, $options: "i" } },
        { "keyPeople.fullName": { $regex: q, $options: "i" } },
      ],
    };

    const total = await Signal.countDocuments(searchFilter);

    const signals = await Signal.find(searchFilter)
      .populate("enrichedContacts")
      .sort("-createdAt")
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Transform signals
    const transformedSignals = signals.map((signal) => {
      const enrichedContacts = Array.isArray(signal.enrichedContacts)
        ? signal.enrichedContacts
        : [];

      return {
        ...signal,
        contacts: enrichedContacts.map((contact: any) => ({
          id: contact._id,
          fullName: contact.fullName,
          email: contact.emailAddress?.business?.[0] || contact.emailAddress?.personal?.[0],
          title: contact.occupationTitle,
          company: signal.companyName,
          location: contact.primaryAddress || contact.stateOfResidence,
          netWorth: contact.totalNetWorth,
          annualIncome: contact.annualEarnedIncome,
          leadScore: contact.leadScore,
          outreachScore: contact.outreachScore,
        })),
      };
    });

    res.status(httpStatus.OK).json({
      success: true,
      data: transformedSignals,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  } catch (error: any) {
    console.error("Error searching signals:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to search signals",
      error: error.message,
    });
  }
};

/**
 * GET /signals/:id/contacts
 * Get all enriched contacts for a specific signal
 */
export const getContactsBySignalId = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const signal = await Signal.findById(id).populate("enrichedContacts").lean();

    if (!signal) {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        message: "Signal not found",
      });
    }

    const enrichedContacts = Array.isArray(signal.enrichedContacts) ? signal.enrichedContacts : [];

    const contacts = enrichedContacts.map((contact: any) => ({
      id: contact._id,
      fullName: contact.fullName,
      email: contact.emailAddress?.business?.[0] || contact.emailAddress?.personal?.[0],
      title: contact.occupationTitle,
      company: signal.companyName,
      location: contact.primaryAddress || contact.stateOfResidence,
      netWorth: contact.totalNetWorth,
      annualIncome: contact.annualEarnedIncome,
      leadScore: contact.leadScore,
      outreachScore: contact.outreachScore,
      sourceOfInformation: contact.sourceOfInformation,
      createdAt: contact.createdAt,
    }));

    res.status(httpStatus.OK).json({
      success: true,
      data: contacts,
    });
  } catch (error: any) {
    console.error("Error fetching contacts for signal:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch contacts",
      error: error.message,
    });
  }
};

/**
 * GET /signals/stats
 * Get statistics about signals and contacts
 */
export const getSignalsStats = async (req: Request, res: Response) => {
  try {
    const totalSignals = await Signal.countDocuments();
    const totalContacts = await Contact.countDocuments();

    const enrichedSignals = await Signal.countDocuments({
      contactEnrichmentStatus: "completed",
    });

    const signalsBySource = await Signal.aggregate([
      { $group: { _id: "$signalSource", count: { $sum: 1 } } },
    ]);

    const signalsBySentiment = await Signal.aggregate([
      { $group: { _id: "$sentiment", count: { $sum: 1 } } },
    ]);

    const enrichmentStats = await Signal.aggregate([
      { $group: { _id: "$contactEnrichmentStatus", count: { $sum: 1 } } },
    ]);

    res.status(httpStatus.OK).json({
      success: true,
      data: {
        totalSignals,
        totalContacts,
        enrichedSignals,
        signalsBySource,
        signalsBySentiment,
        enrichmentStats,
      },
    });
  } catch (error: any) {
    console.error("Error fetching signal stats:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch signal statistics",
      error: error.message,
    });
  }
};

/**
 * GET /signals/ma-feed
 * Get M&A signals for activity feed dashboard
 */
export const getMASignalsForFeed = async (req: Request, res: Response) => {
  try {
    const { limit = 20 } = req.query;
    const limitNum = parseInt(limit as string);

    // Fetch M&A events from SignalNewKK collection
    const maSignals = await SignalNew.find({
      filingType: "ma-event",
    })
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .lean();

    console.log(`📊 Found ${maSignals.length} M&A signals for feed`);

    // Log event type distribution for debugging
    const eventTypeCounts: Record<string, number> = {};
    maSignals.forEach((signal) => {
      const eventType = signal.maEventData?.eventType || "unknown";
      eventTypeCounts[eventType] = (eventTypeCounts[eventType] || 0) + 1;
    });
    console.log("Event type distribution:", eventTypeCounts);

    // Helper to format date
    const formatDate = (date: Date | undefined) => {
      if (!date) return "Date unknown";
      const d = new Date(date);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    };

    // Helper to calculate time ago
    const getTimeAgo = (date: Date) => {
      const now = new Date();
      const diffMs = now.getTime() - new Date(date).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 60) return `${diffMins} min ago`;
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
      if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
      return formatDate(date);
    };

    // Transform for activity feed with complete M&A data
    const feedItems = maSignals.map((signal: any) => {
      const maData = signal.maEventData || {};
      const acquiringCompany = maData.parties?.acquirer?.name || maData.acquiringCompany;

      // Better fallback for status - handle empty strings
      const status = maData.status?.trim() || "announced";

      // Log for debugging if status is missing or weird
      if (!maData.status || maData.status.trim() === "") {
        console.log(
          `⚠️  Signal ${signal._id} has empty/missing status, using fallback: "${status}"`,
        );
      }

      // Get news article link from scraped sources
      let companyLink = null;

      // Try to get from sources array (scraped news articles)
      if (maData.sources && Array.isArray(maData.sources) && maData.sources.length > 0) {
        companyLink = maData.sources[0].url;
        console.log(`✅ Using news source for ${signal.fullName}: ${companyLink}`);
      }
      // Fallback to filing link if no news source
      else if (signal.filingLink) {
        companyLink = signal.filingLink;
        console.log(`⚠️  No news source for ${signal.fullName}, using filing link`);
      }
      // No link available
      else {
        console.log(`❌ No link available for ${signal.fullName}`);
      }

      return {
        id: String(signal._id),
        companyName: signal.fullName || signal.companyName,
        companyLink: companyLink,
        dealValue: maData.dealValue || "undisclosed",
        announcementDate: formatDate(maData.announcementDate),
        status: status, // announced, completed, pending, terminated
        eventType: maData.eventType || "acquisition",
        acquiringCompany: maData.eventType === "acquisition" ? acquiringCompany : null,
        mergedToCompany: maData.eventType === "merger" ? acquiringCompany : null,
        exitedBy: maData.eventType === "exit" ? acquiringCompany : null,
        insights:
          maData.insightSummary ||
          maData.insights?.summary ||
          signal.insights ||
          "No insights available",
        dealType: maData.dealType || "undisclosed",
        closingDate: maData.effectiveDate ? formatDate(maData.effectiveDate) : null,
        timestamp: getTimeAgo(signal.createdAt),
        userFeedback: signal.userFeedback || null,
      };
    });

    res.status(httpStatus.OK).json({
      success: true,
      data: feedItems,
      meta: {
        total: maSignals.length,
        eventTypes: eventTypeCounts,
      },
    });
  } catch (error: any) {
    console.error("Error fetching M&A signals for feed:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch M&A signals",
      error: error.message,
    });
  }
};

/**
 * POST /signals/ma-feedback
 * Update user feedback (like/dislike) for an M&A signal
 * Pass null to remove feedback (toggle off)
 */
export const updateMAFeedback = async (req: Request, res: Response) => {
  try {
    const { signalId, feedback } = req.body;

    if (!signalId) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        message: "signalId is required",
      });
    }

    // Allow null to remove feedback, or "liked"/"disliked" to set it
    if (feedback !== null && !["liked", "disliked"].includes(feedback)) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        message: "feedback must be 'liked', 'disliked', or null",
      });
    }

    const signal = await SignalNew.findByIdAndUpdate(
      signalId,
      { userFeedback: feedback },
      { new: true },
    );

    if (!signal) {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        message: "Signal not found",
      });
    }

    console.log(`👍 Updated feedback for signal ${signalId}: ${feedback || "removed"}`);

    res.status(httpStatus.OK).json({
      success: true,
      message: "Feedback updated successfully",
      data: {
        id: String(signal._id),
        userFeedback: signal.userFeedback,
      },
    });
  } catch (error: any) {
    console.error("Error updating M&A feedback:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to update feedback",
      error: error.message,
    });
  }
};
