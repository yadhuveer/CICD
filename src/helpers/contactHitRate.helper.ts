import { SignalNew, filingTypeEnum } from "../models/newSignal.model.js";
import { Contact } from "../models/Contacts.model.js";

/**
 * Interface for source breakdown (Person vs Company)
 */
interface SourceBreakdown {
  Person: {
    totalSignals: number;
    totalProcessed: number;
    gotContacts: number;
    hitRate: number;
  };
  Company: {
    totalSignals: number;
    totalProcessed: number;
    gotContacts: number;
    hitRate: number;
  };
}

/**
 * Interface for contact hit rate statistics by filing type
 */
interface ContactHitRateStats {
  filingType: string;
  totalSignals: number;
  totalProcessed: number;
  gotContacts: number;
  hitRatePercentage: number;
  bySource: SourceBreakdown;
}

/**
 * Interface for overall contact hit rate response
 */
interface ContactHitRateResponse {
  summary: {
    totalSignals: number;
    totalSignalsProcessed: number;
    totalContactsCreated: number;
    overallHitRate: number;
    bySource: SourceBreakdown;
  };
  byFilingType: ContactHitRateStats[];
}

/**
 * Get contact hit rate statistics - shows how many processed signals resulted in contacts
 */
export async function getContactHitRateStatistics(): Promise<ContactHitRateResponse> {
  try {
    const filingTypeStats: ContactHitRateStats[] = [];

    // Track overall stats by source
    let totalPersonSignals = 0;
    let totalPersonProcessed = 0;
    let totalPersonGotContacts = 0;
    let totalCompanySignals = 0;
    let totalCompanyProcessed = 0;
    let totalCompanyGotContacts = 0;

    for (const filingType of filingTypeEnum) {
      // Get total signals for this filing type
      const personTotalSignals = await SignalNew.countDocuments({
        filingType,
        signalSource: "Person",
      });

      const companyTotalSignals = await SignalNew.countDocuments({
        filingType,
        signalSource: "Company",
      });

      // Get breakdown by source type for this filing type
      const personProcessed = await SignalNew.countDocuments({
        filingType,
        processingStatus: "Processed",
        signalSource: "Person",
      });

      const personGotContacts = await SignalNew.countDocuments({
        filingType,
        processingStatus: "Processed",
        signalSource: "Person",
        contactId: { $exists: true, $ne: null },
      });

      const companyProcessed = await SignalNew.countDocuments({
        filingType,
        processingStatus: "Processed",
        signalSource: "Company",
      });

      const companyGotContacts = await SignalNew.countDocuments({
        filingType,
        processingStatus: "Processed",
        signalSource: "Company",
        contactId: { $exists: true, $ne: null },
      });

      // Calculate totals for this filing type
      const totalSignals = personTotalSignals + companyTotalSignals;
      const totalProcessed = personProcessed + companyProcessed;
      const gotContacts = personGotContacts + companyGotContacts;
      const hitRatePercentage = totalProcessed > 0 ? (gotContacts / totalProcessed) * 100 : 0;

      // Calculate hit rates by source
      const personHitRate = personProcessed > 0 ? (personGotContacts / personProcessed) * 100 : 0;
      const companyHitRate =
        companyProcessed > 0 ? (companyGotContacts / companyProcessed) * 100 : 0;

      // Accumulate overall stats by source
      totalPersonSignals += personTotalSignals;
      totalPersonProcessed += personProcessed;
      totalPersonGotContacts += personGotContacts;
      totalCompanySignals += companyTotalSignals;
      totalCompanyProcessed += companyProcessed;
      totalCompanyGotContacts += companyGotContacts;

      filingTypeStats.push({
        filingType,
        totalSignals,
        totalProcessed,
        gotContacts,
        hitRatePercentage: Math.round(hitRatePercentage * 100) / 100,
        bySource: {
          Person: {
            totalSignals: personTotalSignals,
            totalProcessed: personProcessed,
            gotContacts: personGotContacts,
            hitRate: Math.round(personHitRate * 100) / 100,
          },
          Company: {
            totalSignals: companyTotalSignals,
            totalProcessed: companyProcessed,
            gotContacts: companyGotContacts,
            hitRate: Math.round(companyHitRate * 100) / 100,
          },
        },
      });
    }

    // Calculate overall summary
    const totalSignals = totalPersonSignals + totalCompanySignals;
    const totalSignalsProcessed = totalPersonProcessed + totalCompanyProcessed;
    const totalContactsCreated = totalPersonGotContacts + totalCompanyGotContacts;
    const overallHitRate =
      totalSignalsProcessed > 0 ? (totalContactsCreated / totalSignalsProcessed) * 100 : 0;

    // Calculate overall hit rates by source
    const overallPersonHitRate =
      totalPersonProcessed > 0 ? (totalPersonGotContacts / totalPersonProcessed) * 100 : 0;
    const overallCompanyHitRate =
      totalCompanyProcessed > 0 ? (totalCompanyGotContacts / totalCompanyProcessed) * 100 : 0;

    return {
      summary: {
        totalSignals,
        totalSignalsProcessed,
        totalContactsCreated,
        overallHitRate: Math.round(overallHitRate * 100) / 100,
        bySource: {
          Person: {
            totalSignals: totalPersonSignals,
            totalProcessed: totalPersonProcessed,
            gotContacts: totalPersonGotContacts,
            hitRate: Math.round(overallPersonHitRate * 100) / 100,
          },
          Company: {
            totalSignals: totalCompanySignals,
            totalProcessed: totalCompanyProcessed,
            gotContacts: totalCompanyGotContacts,
            hitRate: Math.round(overallCompanyHitRate * 100) / 100,
          },
        },
      },
      byFilingType: filingTypeStats,
    };
  } catch (error) {
    console.error("Error calculating contact hit rate statistics:", error);
    throw error;
  }
}

/**
 * Get contact hit rate statistics for a specific date range
 */
export async function getContactHitRateStatisticsByDateRange(
  startDate: Date,
  endDate: Date,
): Promise<ContactHitRateResponse> {
  try {
    const filingTypeStats: ContactHitRateStats[] = [];
    const dateFilter = {
      createdAt: { $gte: startDate, $lte: endDate },
    };

    // Track overall stats by source
    let totalPersonSignals = 0;
    let totalPersonProcessed = 0;
    let totalPersonGotContacts = 0;
    let totalCompanySignals = 0;
    let totalCompanyProcessed = 0;
    let totalCompanyGotContacts = 0;

    for (const filingType of filingTypeEnum) {
      // Get total signals for this filing type within date range
      const personTotalSignals = await SignalNew.countDocuments({
        filingType,
        signalSource: "Person",
        ...dateFilter,
      });

      const companyTotalSignals = await SignalNew.countDocuments({
        filingType,
        signalSource: "Company",
        ...dateFilter,
      });

      // Get breakdown by source type for this filing type within date range
      const personProcessed = await SignalNew.countDocuments({
        filingType,
        processingStatus: "Processed",
        signalSource: "Person",
        ...dateFilter,
      });

      const personGotContacts = await SignalNew.countDocuments({
        filingType,
        processingStatus: "Processed",
        signalSource: "Person",
        contactId: { $exists: true, $ne: null },
        ...dateFilter,
      });

      const companyProcessed = await SignalNew.countDocuments({
        filingType,
        processingStatus: "Processed",
        signalSource: "Company",
        ...dateFilter,
      });

      const companyGotContacts = await SignalNew.countDocuments({
        filingType,
        processingStatus: "Processed",
        signalSource: "Company",
        contactId: { $exists: true, $ne: null },
        ...dateFilter,
      });

      // Calculate totals for this filing type
      const totalSignals = personTotalSignals + companyTotalSignals;
      const totalProcessed = personProcessed + companyProcessed;
      const gotContacts = personGotContacts + companyGotContacts;
      const hitRatePercentage = totalProcessed > 0 ? (gotContacts / totalProcessed) * 100 : 0;

      // Calculate hit rates by source
      const personHitRate = personProcessed > 0 ? (personGotContacts / personProcessed) * 100 : 0;
      const companyHitRate =
        companyProcessed > 0 ? (companyGotContacts / companyProcessed) * 100 : 0;

      // Accumulate overall stats by source
      totalPersonSignals += personTotalSignals;
      totalPersonProcessed += personProcessed;
      totalPersonGotContacts += personGotContacts;
      totalCompanySignals += companyTotalSignals;
      totalCompanyProcessed += companyProcessed;
      totalCompanyGotContacts += companyGotContacts;

      filingTypeStats.push({
        filingType,
        totalSignals,
        totalProcessed,
        gotContacts,
        hitRatePercentage: Math.round(hitRatePercentage * 100) / 100,
        bySource: {
          Person: {
            totalSignals: personTotalSignals,
            totalProcessed: personProcessed,
            gotContacts: personGotContacts,
            hitRate: Math.round(personHitRate * 100) / 100,
          },
          Company: {
            totalSignals: companyTotalSignals,
            totalProcessed: companyProcessed,
            gotContacts: companyGotContacts,
            hitRate: Math.round(companyHitRate * 100) / 100,
          },
        },
      });
    }

    // Calculate overall summary
    const totalSignals = totalPersonSignals + totalCompanySignals;
    const totalSignalsProcessed = totalPersonProcessed + totalCompanyProcessed;
    const totalContactsCreated = totalPersonGotContacts + totalCompanyGotContacts;
    const overallHitRate =
      totalSignalsProcessed > 0 ? (totalContactsCreated / totalSignalsProcessed) * 100 : 0;

    // Calculate overall hit rates by source
    const overallPersonHitRate =
      totalPersonProcessed > 0 ? (totalPersonGotContacts / totalPersonProcessed) * 100 : 0;
    const overallCompanyHitRate =
      totalCompanyProcessed > 0 ? (totalCompanyGotContacts / totalCompanyProcessed) * 100 : 0;

    return {
      summary: {
        totalSignals,
        totalSignalsProcessed,
        totalContactsCreated,
        overallHitRate: Math.round(overallHitRate * 100) / 100,
        bySource: {
          Person: {
            totalSignals: totalPersonSignals,
            totalProcessed: totalPersonProcessed,
            gotContacts: totalPersonGotContacts,
            hitRate: Math.round(overallPersonHitRate * 100) / 100,
          },
          Company: {
            totalSignals: totalCompanySignals,
            totalProcessed: totalCompanyProcessed,
            gotContacts: totalCompanyGotContacts,
            hitRate: Math.round(overallCompanyHitRate * 100) / 100,
          },
        },
      },
      byFilingType: filingTypeStats,
    };
  } catch (error) {
    console.error("Error calculating contact hit rate statistics by date range:", error);
    throw error;
  }
}

/**
 * Get detailed contact presence statistics - includes contacts linked to signals
 */
export async function getDetailedContactPresenceStatistics(): Promise<{
  totalContactsInDB: number;
  contactsWithSignals: number;
  contactsWithoutSignals: number;
  byFilingType: ContactHitRateStats[];
}> {
  try {
    // Get total contacts in database
    const totalContactsInDB = await Contact.countDocuments();

    // Get contacts that have at least one signal
    const contactsWithSignals = await Contact.countDocuments({
      "signals.0": { $exists: true },
    });

    const contactsWithoutSignals = totalContactsInDB - contactsWithSignals;

    // Get hit rate stats by filing type
    const hitRateStats = await getContactHitRateStatistics();

    return {
      totalContactsInDB,
      contactsWithSignals,
      contactsWithoutSignals,
      byFilingType: hitRateStats.byFilingType,
    };
  } catch (error) {
    console.error("Error calculating detailed contact presence statistics:", error);
    throw error;
  }
}
