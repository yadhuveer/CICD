import { Request, Response } from "express";

import { getContactsFiltered } from "../helpers/filter.helper.js";
import { SignalNew } from "../models/newSignal.model.js";

export const getFilteredContacts = async (req: Request, res: Response) => {
  try {
    console.log("=== Filter Request Body ===", JSON.stringify(req.body, null, 2));

    // 1. Process Array Inputs

    const title = req.body.title || [];

    const state = req.body.state || [];

    const company = req.body.company || [];

    const status = req.body.status || [];

    // 2. Process Single Inputs

    const fromDate = req.body.fromDate as string;

    const toDate = req.body.toDate as string;

    const search = req.body.search as string;

    const source = req.body.source as string;

    const type = req.body.type as string;

    const minScoreStr = req.body.leadScore as string;

    const leadScore = minScoreStr ? parseInt(minScoreStr) : undefined;

    // 3. Call Helper

    const contacts = await getContactsFiltered(
      title,

      state,

      company,

      fromDate,

      toDate,

      search,

      leadScore,

      status,

      source,

      type,
    );

    // 4. Fetch signal data for transformation
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

    // 5. Transform contacts to match getAllContacts format
    const transformedContacts = contacts.map((contact: any) => ({
      id: contact._id,
      fullName: contact.fullName,
      email: contact.emailAddress?.business?.[0] || contact.emailAddress?.personal?.[0] || null,
      phone: null,
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

      // Signals
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

      // Metadata
      sourceOfInformation: contact.sourceOfInformation,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    }));

    res.status(200).json({
      success: true,

      count: transformedContacts.length,

      data: transformedContacts,
    });
  } catch (error: any) {
    console.error("Filter error:", error);

    res.status(500).json({
      success: false,

      message: "Failed to retrieve contacts",

      error: error?.message,
    });
  }
};
