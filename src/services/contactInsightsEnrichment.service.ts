import { Contact } from "../models/Contacts.model.js";
import { SignalNew } from "../models/newSignal.model.js";
import { analyzeDocumentForInsights } from "../tools/AiAgents/enritchmentAgent/insightsEnritchment.agent.js";
import logger from "../utils/logger.js";
import { Types } from "mongoose";

/**
 * =====================================
 * CONTACT INSIGHTS ENRICHMENT SERVICE
 * =====================================
 * This service enriches contacts with insights from their linked signals
 */

/**
 * Get contacts that haven't been processed yet
 * A contact is considered unprocessed if:
 * - No insight object exists OR
 * - No leadScore exists OR
 * - leadScore is 0
 */
export async function getUnprocessedContacts(limit: number = 50): Promise<string[]> {
  try {
    logger.info(`🔍 Finding unprocessed contacts (limit: ${limit})...`);

    const contacts = await Contact.find({
      $or: [
        { insight: { $exists: false } },
        { "insight.informativeInsight": { $exists: false } },
        { leadScore: { $exists: false } },
        { leadScore: 0 },
      ],
      // Only get contacts that have signals linked
      "signals.0": { $exists: true },
    })
      .select("_id fullName signals")
      .limit(limit)
      .lean();

    const contactIds = contacts.map((c) => c._id.toString());

    logger.info(`✅ Found ${contactIds.length} unprocessed contacts with signals`);

    return contactIds;
  } catch (error: any) {
    logger.error(`❌ Error getting unprocessed contacts:`, error);
    throw new Error(`Failed to get unprocessed contacts: ${error.message}`);
  }
}

/**
 * Enrich a single contact with insights from their linked signal
 */
export async function enrichContactWithSignalInsights(contactId: string): Promise<{
  success: boolean;
  contactId: string;
  contactName: string;
  message: string;
  insight?: any;
  leadScore?: number;
  signalType?: any;
}> {
  try {
    logger.info(`🔍 Enriching contact: ${contactId}`);

    // Fetch contact
    const contact = await Contact.findById(contactId);

    if (!contact) {
      return {
        success: false,
        contactId,
        contactName: "Unknown",
        message: "Contact not found",
      };
    }

    // Check if contact has signals
    if (!contact.signals || contact.signals.length === 0) {
      return {
        success: false,
        contactId,
        contactName: contact.fullName,
        message: "Contact has no linked signals",
      };
    }

    // Get the first signal (you can modify this logic to use a different signal or combine multiple)
    const firstSignalRef = contact.signals[0];
    const signalId = firstSignalRef.signalId;

    // Fetch the signal
    const signal = await SignalNew.findById(signalId).lean();

    if (!signal) {
      return {
        success: false,
        contactId,
        contactName: contact.fullName,
        message: `Signal ${signalId} not found`,
      };
    }

    logger.info(`📄 Found signal for ${contact.fullName}, analyzing with agent...`);

    // Convert signal to string for analysis
    const signalString = JSON.stringify(signal, null, 2);

    // Analyze with the insights agent
    const insightAnalysis = await analyzeDocumentForInsights(signalString);

    // Update contact with insights
    contact.insight = {
      informativeInsight: insightAnalysis.informativeInsight || "",
      actionableInsight: insightAnalysis.actionableInsight || "",
    };

    // Update lead score
    if (insightAnalysis.leadScore !== undefined) {
      contact.leadScore = insightAnalysis.leadScore;
    }

    // Update signal type if available
    if (insightAnalysis.signalType) {
      contact.signalType = {
        category: insightAnalysis.signalType.category || "",
        source: insightAnalysis.signalType.source || "",
      };
    }

    // Save the updated contact
    await contact.save();

    logger.info(`✅ Successfully enriched contact: ${contact.fullName}`);
    logger.info(`   📊 Lead Score: ${contact.leadScore}`);
    logger.info(`   💡 Insight: ${contact.insight?.informativeInsight?.substring(0, 100)}...`);

    return {
      success: true,
      contactId: contact._id.toString(),
      contactName: contact.fullName,
      message: "Contact enriched successfully",
      insight: contact.insight,
      leadScore: contact.leadScore,
      signalType: contact.signalType,
    };
  } catch (error: any) {
    logger.error(`❌ Error enriching contact ${contactId}:`, error);
    return {
      success: false,
      contactId,
      contactName: "Unknown",
      message: `Failed to enrich contact: ${error.message}`,
    };
  }
}

/**
 * Enrich multiple contacts in batch with rate limiting
 */
export async function enrichContactsBatch(
  contactIds: string[],
  batchSize: number = 5,
  delayMs: number = 20000,
): Promise<{
  totalContacts: number;
  successful: number;
  failed: number;
  results: Array<{
    success: boolean;
    contactId: string;
    contactName: string;
    message: string;
    insight?: any;
    leadScore?: number;
    signalType?: any;
  }>;
}> {
  logger.info(`🚀 Starting batch enrichment for ${contactIds.length} contacts...`);
  logger.info(`⚙️  Rate limiting: ${batchSize} contacts per batch, ${delayMs}ms delay`);

  const allResults: Array<any> = [];

  for (let i = 0; i < contactIds.length; i += batchSize) {
    const batch = contactIds.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(contactIds.length / batchSize);

    logger.info(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} contacts)...`);

    const batchStartTime = Date.now();
    const batchResults = await Promise.allSettled(
      batch.map((contactId) => enrichContactWithSignalInsights(contactId)),
    );
    const batchDuration = Date.now() - batchStartTime;

    // Extract values from settled promises
    const processedResults = batchResults.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        return {
          success: false,
          contactId: batch[index],
          contactName: "Unknown",
          message: `Promise rejected: ${result.reason}`,
        };
      }
    });

    allResults.push(...processedResults);

    const successCount = processedResults.filter((r) => r.success).length;
    const failCount = processedResults.filter((r) => !r.success).length;

    logger.info(
      `✅ Batch ${batchNumber}/${totalBatches} complete in ${batchDuration}ms: ${successCount} succeeded, ${failCount} failed`,
    );

    // Smart delay between batches
    if (i + batchSize < contactIds.length) {
      let smartDelay = delayMs;

      // If batch took longer than expected, increase delay
      if (batchDuration > 30000) {
        smartDelay = Math.max(delayMs, 30000);
        logger.info(`⚠️  Batch took ${batchDuration}ms. Increasing delay to ${smartDelay}ms`);
      }

      logger.info(`⏳ Waiting ${smartDelay}ms before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, smartDelay));
    }
  }

  const successful = allResults.filter((r) => r.success).length;
  const failed = allResults.filter((r) => !r.success).length;

  logger.info(
    `✅ Batch enrichment complete: ${successful} successful, ${failed} failed out of ${contactIds.length} total`,
  );

  return {
    totalContacts: contactIds.length,
    successful,
    failed,
    results: allResults,
  };
}

/**
 * Enrich all unprocessed contacts
 */
export async function enrichAllUnprocessedContacts(
  limit: number = 50,
  batchSize: number = 5,
  delayMs: number = 20000,
): Promise<{
  totalContacts: number;
  successful: number;
  failed: number;
  results: Array<any>;
}> {
  try {
    // Get unprocessed contacts
    const contactIds = await getUnprocessedContacts(limit);

    if (contactIds.length === 0) {
      logger.info("✅ No unprocessed contacts found");
      return {
        totalContacts: 0,
        successful: 0,
        failed: 0,
        results: [],
      };
    }

    // Enrich them in batches
    const result = await enrichContactsBatch(contactIds, batchSize, delayMs);

    return result;
  } catch (error: any) {
    logger.error(`❌ Error in enrichAllUnprocessedContacts:`, error);
    throw new Error(`Failed to enrich unprocessed contacts: ${error.message}`);
  }
}

/**
 * Get enrichment statistics
 */
export async function getContactEnrichmentStats(): Promise<{
  totalContacts: number;
  enrichedContacts: number;
  unenrichedContacts: number;
  contactsWithSignals: number;
  contactsWithoutSignals: number;
  contactsWithLeadScore: number;
  averageLeadScore: number;
}> {
  try {
    logger.info(`📊 Calculating contact enrichment statistics...`);

    const [
      totalContacts,
      enrichedContacts,
      unenrichedContacts,
      contactsWithSignals,
      contactsWithoutSignals,
      contactsWithLeadScore,
      leadScoreAgg,
    ] = await Promise.all([
      Contact.countDocuments(),
      Contact.countDocuments({
        "insight.informativeInsight": { $exists: true },
      }),
      Contact.countDocuments({
        $or: [
          { insight: { $exists: false } },
          { "insight.informativeInsight": { $exists: false } },
        ],
      }),
      Contact.countDocuments({ "signals.0": { $exists: true } }),
      Contact.countDocuments({ signals: { $size: 0 } }),
      Contact.countDocuments({
        leadScore: { $exists: true, $gt: 0 },
      }),
      Contact.aggregate([
        {
          $match: {
            leadScore: { $exists: true, $gt: 0 },
          },
        },
        {
          $group: {
            _id: null,
            avgScore: { $avg: "$leadScore" },
          },
        },
      ]),
    ]);

    const averageLeadScore = leadScoreAgg[0]?.avgScore || 0;

    logger.info(`✅ Statistics calculated successfully`);

    return {
      totalContacts,
      enrichedContacts,
      unenrichedContacts,
      contactsWithSignals,
      contactsWithoutSignals,
      contactsWithLeadScore,
      averageLeadScore: Math.round(averageLeadScore * 100) / 100,
    };
  } catch (error: any) {
    logger.error(`❌ Error getting enrichment stats:`, error);
    throw new Error(`Failed to get enrichment stats: ${error.message}`);
  }
}
