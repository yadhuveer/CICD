import { Request, Response } from "express";
import { Contact } from "../models/Contacts.model.js";
import { SignalNew } from "../models/newSignal.model.js";
import httpStatus from "http-status";

/**
 * GET /contacts
 * Get all contacts with pagination and filtering
 * Optimized for infinite scrolling with cursor-based pagination
 */
export const getAllContacts = async (req: Request, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      cursor, // For cursor-based pagination
      sort = "-createdAt",
      // Filters
      minLeadScore,
      maxLeadScore,
      minOutreachScore,
      maxOutreachScore,
      minNetWorth,
      maxNetWorth,
      minAnnualIncome,
      maxAnnualIncome,
      search,
      jobTitles,
      locations,
      companies,
      leadSource,
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    // Build filter query
    const filter: any = {};
    const andConditions: any[] = [];

    // Score filters
    if (minLeadScore) filter.leadScore = { ...filter.leadScore, $gte: Number(minLeadScore) };
    if (maxLeadScore) filter.leadScore = { ...filter.leadScore, $lte: Number(maxLeadScore) };
    if (minOutreachScore)
      filter.outreachScore = { ...filter.outreachScore, $gte: Number(minOutreachScore) };
    if (maxOutreachScore)
      filter.outreachScore = { ...filter.outreachScore, $lte: Number(maxOutreachScore) };

    // Financial filters
    if (minNetWorth) filter.totalNetWorth = { ...filter.totalNetWorth, $gte: Number(minNetWorth) };
    if (maxNetWorth) filter.totalNetWorth = { ...filter.totalNetWorth, $lte: Number(maxNetWorth) };
    if (minAnnualIncome)
      filter.annualEarnedIncome = { ...filter.annualEarnedIncome, $gte: Number(minAnnualIncome) };
    if (maxAnnualIncome)
      filter.annualEarnedIncome = { ...filter.annualEarnedIncome, $lte: Number(maxAnnualIncome) };

    // Job Titles filter (array of selected titles)
    if (jobTitles) {
      const titlesArray = Array.isArray(jobTitles) ? jobTitles : [jobTitles];
      filter.occupationTitle = { $in: titlesArray };
    }

    // Locations filter (array of selected locations)
    if (locations) {
      const locationsArray = Array.isArray(locations) ? locations : [locations];
      andConditions.push({
        $or: [
          { primaryAddress: { $in: locationsArray } },
          { stateOfResidence: { $in: locationsArray } },
        ],
      });
    }

    // Companies filter (array of selected companies)
    if (companies) {
      const companiesArray = Array.isArray(companies) ? companies : [companies];
      filter.employerBusinessOwnership = { $in: companiesArray };
    }

    // Lead Source filter
    if (leadSource && leadSource !== "both") {
      if (leadSource === "signal") {
        // Contacts that have at least one signal
        filter["signals.0"] = { $exists: true };
      } else if (leadSource === "general") {
        // Contacts that have no signals
        andConditions.push({
          $or: [{ signals: { $size: 0 } }, { signals: { $exists: false } }],
        });
      }
    }

    // Search filter
    if (search && typeof search === "string") {
      andConditions.push({
        $or: [
          { fullName: { $regex: search, $options: "i" } },
          { occupationTitle: { $regex: search, $options: "i" } },
          { employerBusinessOwnership: { $regex: search, $options: "i" } },
          { "emailAddress.business": { $regex: search, $options: "i" } },
          { "emailAddress.personal": { $regex: search, $options: "i" } },
        ],
      });
    }

    // Combine $and conditions if any exist
    if (andConditions.length > 0) {
      filter.$and = andConditions;
    }

    // Cursor-based pagination for infinite scrolling
    if (cursor) {
      filter._id = { $lt: cursor }; // Get records older than cursor
    }

    // Get total count (only if not using cursor)
    let total = 0;
    if (!cursor) {
      total = await Contact.countDocuments(filter);
    }

    // Fetch contacts with populated companies (not populating signals to avoid null issues)
    const contacts = await Contact.find(filter)
      .populate({
        path: "companies.companyId",
        select: "name ticker cik industry sector",
      })
      .sort(sort as string)
      .limit(limitNum)
      .lean();

    // Fetch all signal documents for these contacts to get signalSource
    const allSignalIds = contacts.flatMap((contact: any) =>
      (contact.signals || []).map((s: any) => s.signalId),
    );
    const signals = await SignalNew.find({ _id: { $in: allSignalIds } })
      .select(
        "signalSource signalType filingType filingLink filingDate companyName companyTicker designation",
      )
      .lean();

    // Create a map of signal ID to signal data
    const signalMap = new Map();
    signals.forEach((signal: any) => {
      signalMap.set(signal._id.toString(), signal);
    });

    // Transform contacts for frontend
    const transformedContacts = contacts.map((contact: any) => ({
      id: contact._id,
      fullName: contact.fullName,
      email: contact.emailAddress?.business?.[0] || contact.emailAddress?.personal?.[0] || null,
      phone: null, // TODO: Add phone field if available
      title: contact.occupationTitle || null,
      company: contact.companyName || contact.employerBusinessOwnership || null,
      location: contact.primaryAddress || contact.stateOfResidence || null,
      linkedinUrl: contact.linkedinUrl || null,

      // Financial data
      netWorth: contact.totalNetWorth || 0,
      liquidNetWorth: contact.liquidNetWorth || null,
      annualIncome: contact.annualEarnedIncome || 0,
      otherIncome: contact.otherIncome || null,
      expectedFutureIncomeEvents: contact.expectedFutureIncomeEvents || null,

      // Scores
      leadScore: contact.leadScore || 0,
      outreachScore: contact.outreachScore || 0,

      // Verification
      verified: !!(contact.emailAddress?.business?.[0] || contact.emailAddress?.personal?.[0]),

      // Insights
      insight: contact.insight || null,

      // Signals this contact is linked to - Use signalMap to get signalSource
      signals:
        contact.signals?.map((s: any) => {
          const signalId = s.signalId?.toString();
          const signalData = signalMap.get(signalId);
          return {
            signalId: signalId || null,
            signalType: s.signalType,
            signalSource: signalData?.signalSource || null,
            filingType: signalData?.filingType || null,
            filingLink: signalData?.filingLink || null,
            filingDate: signalData?.filingDate || null,
            companyName: signalData?.companyName || null,
            companyTicker: signalData?.companyTicker || null,
            designation: signalData?.designation || null,
            linkedAt: s.linkedAt,
          };
        }) || [],

      // Companies this contact is linked to
      companies:
        contact.companies?.map((c: any) => ({
          companyId: c.companyId?._id || c.companyId,
          companyName: c.companyId?.name,
          companyTicker: c.companyId?.ticker,
          companyCik: c.companyId?.cik,
          industry: c.companyId?.industry,
          sector: c.companyId?.sector,
          designation: c.designation,
          sourceType: c.sourceType,
          linkedAt: c.linkedAt,
        })) || [],

      // Metadata
      sourceOfInformation: contact.sourceOfInformation,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    }));

    // Prepare pagination response
    const response: any = {
      success: true,
      data: transformedContacts,
    };

    // Determine if there are more items
    const hasMore = transformedContacts.length === limitNum;

    // Get the next cursor (last item's ID) if there are more items
    const nextCursor =
      hasMore && transformedContacts.length > 0
        ? transformedContacts[transformedContacts.length - 1].id
        : null;

    // Add pagination metadata
    if (cursor) {
      // For cursor-based pagination (subsequent pages)
      response.pagination = {
        hasMore,
        nextCursor,
        itemsPerPage: limitNum,
      };
    } else {
      // For first page load - include both traditional AND cursor-based pagination
      response.pagination = {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
        hasMore: pageNum * limitNum < total,
        nextCursor, // Include cursor for infinite scroll
      };
    }

    res.status(httpStatus.OK).json(response);
  } catch (error: any) {
    console.error("Error fetching contacts:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch contacts",
      error: error.message,
    });
  }
};

/**
 * GET /contacts/:id
 * Get a single contact by ID with full details
 */
export const getContactById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const contact = await Contact.findById(id)
      .populate({
        path: "companies.companyId",
        select: "name ticker cik industry sector",
      })
      .lean();

    if (!contact) {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        message: "Contact not found",
      });
    }

    // Manually fetch signal documents to get signalSource
    const signalIds = (contact as any).signals?.map((s: any) => s.signalId) || [];
    const signals = await SignalNew.find({ _id: { $in: signalIds } })
      .select(
        "signalSource signalType filingType filingLink filingDate companyName companyTicker designation",
      )
      .lean();

    // Create a map of signal ID to signal data
    const signalMap = new Map();
    signals.forEach((signal: any) => {
      signalMap.set(signal._id.toString(), signal);
    });

    // Transform contact for frontend
    const transformedContact = {
      id: contact._id,

      // Basic Info
      fullName: contact.fullName,
      dateOfBirth: contact.dateOfBirth,
      age: contact.age,
      maritalStatus: contact.maritalStatus,
      citizenshipResidency: contact.citizenshipResidency,
      primaryAddress: contact.primaryAddress,
      emailAddress: contact.emailAddress,
      linkedinUrl: contact.linkedinUrl,

      // Professional
      occupationTitle: contact.occupationTitle,
      company: contact.companyName || contact.employerBusinessOwnership || null,
      employerBusinessOwnership: contact.employerBusinessOwnership,

      // Financial
      annualEarnedIncome: contact.annualEarnedIncome,
      otherIncome: contact.otherIncome,
      expectedFutureIncomeEvents: contact.expectedFutureIncomeEvents,
      totalNetWorth: contact.totalNetWorth,
      liquidNetWorth: contact.liquidNetWorth,

      // Portfolio
      currentPortfolioHoldings: contact.currentPortfolioHoldings,
      concentratedPositions: contact.concentratedPositions,
      investmentInterests: contact.investmentInterests,
      riskTolerance: contact.riskTolerance,
      riskCapacity: contact.riskCapacity,

      // Goals
      retirementGoals: contact.retirementGoals,
      philanthropicGoals: contact.philanthropicGoals,
      wealthTransferGoals: contact.wealthTransferGoals,
      majorUpcomingEvents: contact.majorUpcomingEvents,

      // Scores
      leadScore: contact.leadScore,
      outreachScore: contact.outreachScore,

      // Signals - Use signalMap to get signalSource
      signals:
        (contact as any).signals?.map((s: any) => {
          const signalId = s.signalId?.toString();
          const signalData = signalMap.get(signalId);
          return {
            signalId: signalId || null,
            signalType: s.signalType,
            signalSource: signalData?.signalSource || null,
            filingType: signalData?.filingType || null,
            filingLink: signalData?.filingLink || null,
            filingDate: signalData?.filingDate || null,
            companyName: signalData?.companyName || null,
            companyTicker: signalData?.companyTicker || null,
            designation: signalData?.designation || null,
            linkedAt: s.linkedAt,
          };
        }) || [],

      // Companies
      companies:
        (contact as any).companies?.map((c: any) => ({
          companyId: c.companyId?._id || c.companyId,
          companyName: c.companyId?.name,
          companyTicker: c.companyId?.ticker,
          companyCik: c.companyId?.cik,
          industry: c.companyId?.industry,
          sector: c.companyId?.sector,
          designation: c.designation,
          sourceType: c.sourceType,
          linkedAt: c.linkedAt,
        })) || [],

      // Metadata
      sourceOfInformation: contact.sourceOfInformation,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    };

    res.status(httpStatus.OK).json({
      success: true,
      data: transformedContact,
    });
  } catch (error: any) {
    console.error("Error fetching contact:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch contact",
      error: error.message,
    });
  }
};

/**
 * GET /contacts/stats
 * Get statistics about contacts
 */
export const getContactsStats = async (req: Request, res: Response) => {
  try {
    const totalContacts = await Contact.countDocuments();

    const contactsWithEmail = await Contact.countDocuments({
      $or: [
        { "emailAddress.business.0": { $exists: true } },
        { "emailAddress.personal.0": { $exists: true } },
      ],
    });

    const contactsWithLinkedIn = await Contact.countDocuments({
      linkedinUrl: { $exists: true, $ne: null },
    });

    const avgLeadScore = await Contact.aggregate([
      { $group: { _id: null, avg: { $avg: "$leadScore" } } },
    ]);

    const avgOutreachScore = await Contact.aggregate([
      { $group: { _id: null, avg: { $avg: "$outreachScore" } } },
    ]);

    const avgNetWorth = await Contact.aggregate([
      {
        $match: { totalNetWorth: { $gt: 0 } },
      },
      {
        $group: { _id: null, avg: { $avg: "$totalNetWorth" } },
      },
    ]);

    const contactsBySignalType = await Contact.aggregate([
      { $unwind: "$signals" },
      { $group: { _id: "$signals.signalType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.status(httpStatus.OK).json({
      success: true,
      data: {
        totalContacts,
        contactsWithEmail,
        contactsWithLinkedIn,
        avgLeadScore: avgLeadScore[0]?.avg || 0,
        avgOutreachScore: avgOutreachScore[0]?.avg || 0,
        avgNetWorth: avgNetWorth[0]?.avg || 0,
        contactsBySignalType,
      },
    });
  } catch (error: any) {
    console.error("Error fetching contact stats:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch contact statistics",
      error: error.message,
    });
  }
};

/**
 * GET /contacts/filters/options
 * Get unique filter options for dropdowns
 */
export const getFilterOptions = async (req: Request, res: Response) => {
  try {
    // Get unique job titles (occupationTitle)
    const jobTitles = await Contact.distinct("occupationTitle", {
      occupationTitle: { $exists: true, $nin: [null, ""] },
    });

    // Get unique locations (using both primaryAddress and stateOfResidence)
    const primaryAddresses = await Contact.distinct("primaryAddress", {
      primaryAddress: { $exists: true, $nin: [null, ""] },
    });
    const statesOfResidence = await Contact.distinct("stateOfResidence", {
      stateOfResidence: { $exists: true, $nin: [null, ""] },
    });

    // Combine and deduplicate locations
    const locations = Array.from(new Set([...primaryAddresses, ...statesOfResidence])).sort();

    // Get unique companies (companyName)
    const companies = await Contact.distinct("companyName", {
      companyName: { $exists: true, $nin: [null, ""] },
    });

    // Get unique signal types from contacts
    const signalTypes = await Contact.distinct("signals.signalType", {
      "signals.signalType": { $exists: true, $ne: null },
    });

    res.status(httpStatus.OK).json({
      success: true,
      data: {
        jobTitles: jobTitles.sort(),
        locations: locations,
        companies: companies.sort(),
        signalTypes: signalTypes.sort(),
      },
    });
  } catch (error: any) {
    console.error("Error fetching filter options:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch filter options",
      error: error.message,
    });
  }
};

/**
 * GET /contacts/by-signal/:signalId
 * Get all contacts (people) who have the same signalId
 * Used for showing related contacts in a Company view
 */
export const getContactsBySignalId = async (req: Request, res: Response) => {
  try {
    const { signalId } = req.params;
    const { excludeContactId } = req.query; // Optional: exclude the current contact

    // Find all contacts that have this signalId in their signals array
    const contacts = await Contact.find({
      "signals.signalId": signalId,
    })
      .select(
        "fullName occupationTitle primaryAddress linkedinUrl emailAddress leadScore companyName employerBusinessOwnership signals",
      )
      .lean();

    // Get the signalIds to fetch signal data
    const allSignalIds = contacts.flatMap((contact: any) =>
      (contact.signals || []).map((s: any) => s.signalId),
    );
    const signals = await SignalNew.find({ _id: { $in: allSignalIds } })
      .select("signalSource")
      .lean();

    // Create a map of signal ID to signal data
    const signalMap = new Map();
    signals.forEach((signal: any) => {
      signalMap.set(signal._id.toString(), signal);
    });

    // Transform and filter contacts
    const transformedContacts = contacts
      .map((contact: any) => {
        return {
          id: contact._id,
          fullName: contact.fullName || "N/A",
          title: contact.occupationTitle || "N/A",
          companyName: contact.companyName || contact.employerBusinessOwnership || "N/A",
          location: contact.primaryAddress || "N/A",
          linkedinUrl: contact.linkedinUrl || "",
          email: contact.emailAddress?.business?.[0] || contact.emailAddress?.personal?.[0] || "",
          verified: !!(contact.emailAddress?.business?.[0] || contact.emailAddress?.personal?.[0]),
          leadScore: contact.leadScore || 0,
          priority:
            contact.leadScore && contact.leadScore > 70
              ? "high"
              : contact.leadScore && contact.leadScore > 40
                ? "medium"
                : "low",
          profilePicture: undefined,
        };
      })
      // Exclude the current contact if specified
      .filter((contact: any) =>
        excludeContactId ? contact.id.toString() !== excludeContactId : true,
      );

    res.status(httpStatus.OK).json({
      success: true,
      data: transformedContacts,
    });
  } catch (error: any) {
    console.error("Error fetching contacts by signal ID:", error);
    res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch related contacts",
      error: error.message,
    });
  }
};
