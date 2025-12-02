import { SignalNew } from "../models/newSignal.model.js";
import { filingTypeEnum } from "../models/newSignal.model.js";

/**
 * Interface for filing type statistics
 */
interface FilingTypeStats {
  filingType: string;
  total: number;
  processingStatus: {
    pending: number;
    processed: number;
    failed: number;
  };
  contactEnrichmentStatus: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  withContact: number;
  successRate: number;
  enrichmentSuccessRate: number;
}

/**
 * Interface for overall pipeline statistics
 */
interface PipelineStats {
  overview: {
    totalSignals: number;
    totalProcessed: number;
    totalFailed: number;
    totalPending: number;
    overallSuccessRate: number;
    totalEnriched: number;
    totalWithContact: number;
    overallEnrichmentRate: number;
  };
  byFilingType: FilingTypeStats[];
  processingStatusBreakdown: {
    pending: number;
    processed: number;
    failed: number;
  };
  enrichmentStatusBreakdown: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
}

/**
 * Calculate pipeline statistics for all signals grouped by filing type
 */
export async function getSignalPipelineStatistics(): Promise<PipelineStats> {
  try {
    // Get statistics for each filing type
    const filingTypeStats = await Promise.all(
      filingTypeEnum.map(async (filingType) => {
        const stats = await getFilingTypeStatistics(filingType);
        return stats;
      }),
    );

    // Calculate overall statistics
    const totalSignals = filingTypeStats.reduce((sum, stat) => sum + stat.total, 0);
    const totalProcessed = filingTypeStats.reduce(
      (sum, stat) => sum + stat.processingStatus.processed,
      0,
    );
    const totalFailed = filingTypeStats.reduce(
      (sum, stat) => sum + stat.processingStatus.failed,
      0,
    );
    const totalPending = filingTypeStats.reduce(
      (sum, stat) => sum + stat.processingStatus.pending,
      0,
    );
    const totalEnriched = filingTypeStats.reduce(
      (sum, stat) => sum + stat.contactEnrichmentStatus.completed,
      0,
    );
    const totalWithContact = filingTypeStats.reduce((sum, stat) => sum + stat.withContact, 0);

    const overallSuccessRate = totalSignals > 0 ? (totalProcessed / totalSignals) * 100 : 0;
    const overallEnrichmentRate = totalSignals > 0 ? (totalEnriched / totalSignals) * 100 : 0;

    // Calculate overall processing status breakdown
    const processingStatusBreakdown = {
      pending: totalPending,
      processed: totalProcessed,
      failed: totalFailed,
    };

    // Calculate overall enrichment status breakdown
    const enrichmentStatusBreakdown = {
      pending: filingTypeStats.reduce((sum, stat) => sum + stat.contactEnrichmentStatus.pending, 0),
      processing: filingTypeStats.reduce(
        (sum, stat) => sum + stat.contactEnrichmentStatus.processing,
        0,
      ),
      completed: totalEnriched,
      failed: filingTypeStats.reduce((sum, stat) => sum + stat.contactEnrichmentStatus.failed, 0),
    };

    return {
      overview: {
        totalSignals,
        totalProcessed,
        totalFailed,
        totalPending,
        overallSuccessRate: Math.round(overallSuccessRate * 100) / 100,
        totalEnriched,
        totalWithContact,
        overallEnrichmentRate: Math.round(overallEnrichmentRate * 100) / 100,
      },
      byFilingType: filingTypeStats,
      processingStatusBreakdown,
      enrichmentStatusBreakdown,
    };
  } catch (error) {
    console.error("Error calculating pipeline statistics:", error);
    throw error;
  }
}

/**
 * Get statistics for a specific filing type
 */
async function getFilingTypeStatistics(filingType: string): Promise<FilingTypeStats> {
  try {
    // Total signals for this filing type
    const total = await SignalNew.countDocuments({ filingType });

    // Processing status breakdown
    const pending = await SignalNew.countDocuments({
      filingType,
      processingStatus: "Pending",
    });

    const processed = await SignalNew.countDocuments({
      filingType,
      processingStatus: "Processed",
    });

    const failed = await SignalNew.countDocuments({
      filingType,
      processingStatus: "Failed",
    });

    // Contact enrichment status breakdown
    const enrichmentPending = await SignalNew.countDocuments({
      filingType,
      contactEnrichmentStatus: "pending",
    });

    const enrichmentProcessing = await SignalNew.countDocuments({
      filingType,
      contactEnrichmentStatus: "processing",
    });

    const enrichmentCompleted = await SignalNew.countDocuments({
      filingType,
      contactEnrichmentStatus: "completed",
    });

    const enrichmentFailed = await SignalNew.countDocuments({
      filingType,
      contactEnrichmentStatus: "failed",
    });

    // Signals with associated contact
    const withContact = await SignalNew.countDocuments({
      filingType,
      contactId: { $exists: true, $ne: null },
    });

    // Calculate success rates
    const successRate = total > 0 ? (processed / total) * 100 : 0;
    const enrichmentSuccessRate = total > 0 ? (enrichmentCompleted / total) * 100 : 0;

    return {
      filingType,
      total,
      processingStatus: {
        pending,
        processed,
        failed,
      },
      contactEnrichmentStatus: {
        pending: enrichmentPending,
        processing: enrichmentProcessing,
        completed: enrichmentCompleted,
        failed: enrichmentFailed,
      },
      withContact,
      successRate: Math.round(successRate * 100) / 100,
      enrichmentSuccessRate: Math.round(enrichmentSuccessRate * 100) / 100,
    };
  } catch (error) {
    console.error(`Error calculating statistics for filing type ${filingType}:`, error);
    throw error;
  }
}

/**
 * Get statistics for a specific date range
 */
export async function getSignalPipelineStatisticsByDateRange(
  startDate: Date,
  endDate: Date,
): Promise<PipelineStats> {
  try {
    // Similar to getSignalPipelineStatistics but with date filtering
    const filingTypeStats = await Promise.all(
      filingTypeEnum.map(async (filingType) => {
        const stats = await getFilingTypeStatisticsByDateRange(filingType, startDate, endDate);
        return stats;
      }),
    );

    // Calculate overall statistics (same as above)
    const totalSignals = filingTypeStats.reduce((sum, stat) => sum + stat.total, 0);
    const totalProcessed = filingTypeStats.reduce(
      (sum, stat) => sum + stat.processingStatus.processed,
      0,
    );
    const totalFailed = filingTypeStats.reduce(
      (sum, stat) => sum + stat.processingStatus.failed,
      0,
    );
    const totalPending = filingTypeStats.reduce(
      (sum, stat) => sum + stat.processingStatus.pending,
      0,
    );
    const totalEnriched = filingTypeStats.reduce(
      (sum, stat) => sum + stat.contactEnrichmentStatus.completed,
      0,
    );
    const totalWithContact = filingTypeStats.reduce((sum, stat) => sum + stat.withContact, 0);

    const overallSuccessRate = totalSignals > 0 ? (totalProcessed / totalSignals) * 100 : 0;
    const overallEnrichmentRate = totalSignals > 0 ? (totalEnriched / totalSignals) * 100 : 0;

    const processingStatusBreakdown = {
      pending: totalPending,
      processed: totalProcessed,
      failed: totalFailed,
    };

    const enrichmentStatusBreakdown = {
      pending: filingTypeStats.reduce((sum, stat) => sum + stat.contactEnrichmentStatus.pending, 0),
      processing: filingTypeStats.reduce(
        (sum, stat) => sum + stat.contactEnrichmentStatus.processing,
        0,
      ),
      completed: totalEnriched,
      failed: filingTypeStats.reduce((sum, stat) => sum + stat.contactEnrichmentStatus.failed, 0),
    };

    return {
      overview: {
        totalSignals,
        totalProcessed,
        totalFailed,
        totalPending,
        overallSuccessRate: Math.round(overallSuccessRate * 100) / 100,
        totalEnriched,
        totalWithContact,
        overallEnrichmentRate: Math.round(overallEnrichmentRate * 100) / 100,
      },
      byFilingType: filingTypeStats,
      processingStatusBreakdown,
      enrichmentStatusBreakdown,
    };
  } catch (error) {
    console.error("Error calculating pipeline statistics by date range:", error);
    throw error;
  }
}

/**
 * Get statistics for a specific filing type within a date range
 */
async function getFilingTypeStatisticsByDateRange(
  filingType: string,
  startDate: Date,
  endDate: Date,
): Promise<FilingTypeStats> {
  try {
    const dateFilter = {
      createdAt: { $gte: startDate, $lte: endDate },
    };

    const total = await SignalNew.countDocuments({ filingType, ...dateFilter });

    const pending = await SignalNew.countDocuments({
      filingType,
      processingStatus: "Pending",
      ...dateFilter,
    });

    const processed = await SignalNew.countDocuments({
      filingType,
      processingStatus: "Processed",
      ...dateFilter,
    });

    const failed = await SignalNew.countDocuments({
      filingType,
      processingStatus: "Failed",
      ...dateFilter,
    });

    const enrichmentPending = await SignalNew.countDocuments({
      filingType,
      contactEnrichmentStatus: "pending",
      ...dateFilter,
    });

    const enrichmentProcessing = await SignalNew.countDocuments({
      filingType,
      contactEnrichmentStatus: "processing",
      ...dateFilter,
    });

    const enrichmentCompleted = await SignalNew.countDocuments({
      filingType,
      contactEnrichmentStatus: "completed",
      ...dateFilter,
    });

    const enrichmentFailed = await SignalNew.countDocuments({
      filingType,
      contactEnrichmentStatus: "failed",
      ...dateFilter,
    });

    const withContact = await SignalNew.countDocuments({
      filingType,
      contactId: { $exists: true, $ne: null },
      ...dateFilter,
    });

    const successRate = total > 0 ? (processed / total) * 100 : 0;
    const enrichmentSuccessRate = total > 0 ? (enrichmentCompleted / total) * 100 : 0;

    return {
      filingType,
      total,
      processingStatus: {
        pending,
        processed,
        failed,
      },
      contactEnrichmentStatus: {
        pending: enrichmentPending,
        processing: enrichmentProcessing,
        completed: enrichmentCompleted,
        failed: enrichmentFailed,
      },
      withContact,
      successRate: Math.round(successRate * 100) / 100,
      enrichmentSuccessRate: Math.round(enrichmentSuccessRate * 100) / 100,
    };
  } catch (error) {
    console.error(
      `Error calculating statistics for filing type ${filingType} by date range:`,
      error,
    );
    throw error;
  }
}
