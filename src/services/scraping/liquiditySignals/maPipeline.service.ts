import { SignalNew } from "../../../models/newSignal.model.js";
// import { mapMAEventsToSignals } from "../../../tools/AiAgents/scraperAgents/MandAScraperAgent.js";
import {
  scrapeMAEvents as scrapeCustomQuery,
  findRecentAcquisitions,
  findStateFilings,
  findFounderExits,
  findSECFilings,
  findAllMAEvents,
  mapMAEventsToSignals,
} from "../../../tools/AiAgents/scraperAgents/liquidity/MandAScraperAgent.js";
import type {
  MAScrapingResult,
  MAScraperType,
  MAScraperOptions,
} from "../../../types/maSignal.types.js";
import logger from "../../../utils/logger.js";

export type { MAScrapingResult, MAScraperType, MAScraperOptions };

function getTimeframeString(days?: number, timeframe?: string): string {
  if (days) {
    if (days <= 7) return "last 7 days";
    if (days <= 30) return "last 30 days";
    if (days <= 90) return "last 90 days";
    return "last 6 months";
  }
  return timeframe || "last 30 days";
}

async function processMAEventsToSignals(
  maEvents: any[],
): Promise<{ signalIds: string[]; alreadyExists: number; failed: number }> {
  if (maEvents.length === 0) return { signalIds: [], alreadyExists: 0, failed: 0 };

  const signals = mapMAEventsToSignals(maEvents);
  logger.info(`✅ Mapped ${maEvents.length} events to ${signals.length} signal(s)`);

  const signalIds: string[] = [];
  let alreadyExists = 0;
  let failed = 0;

  for (const signalData of signals) {
    try {
      const updateResult = await SignalNew.updateOne(
        {
          fullName: signalData.fullName,
          filingType: "ma-event",
          "maEventData.announcementDate": signalData.maEventData?.announcementDate,
        },
        { $setOnInsert: signalData },
        { upsert: true },
      );

      const doc = await SignalNew.findOne({
        fullName: signalData.fullName,
        filingType: "ma-event",
        "maEventData.announcementDate": signalData.maEventData?.announcementDate,
      });

      if (doc) {
        signalIds.push(String(doc._id));

        if (updateResult.upsertedId) {
          logger.info(
            `✅ Created: ${signalData.fullName} (${signalData.maEventData?.dealValue || "N/A"})`,
          );
        } else {
          alreadyExists++;
          logger.info(`⏭️  Already exists: ${signalData.fullName}`);
        }
      }
    } catch (error: any) {
      logger.error(`❌ Error saving ${signalData.fullName}:`, error.message);
      failed++;
    }
  }

  return { signalIds, alreadyExists, failed };
}

export async function scrapeMAEvents(options: MAScraperOptions): Promise<MAScrapingResult> {
  try {
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error("FIRECRAWL_API_KEY required");
    }

    const allSignalIds: string[] = [];
    let totalProcessed = 0;
    let totalFailed = 0;
    let totalAlreadyExists = 0;
    let description = "";

    switch (options.type) {
      case "acquisitions": {
        const days = options.days || 30;
        const country = options.country || "United States";
        description = `Acquisitions (${days} days, ${country})`;
        break;
      }
      case "state-filings": {
        const timeframe = getTimeframeString(options.days, options.timeframe);
        const display = options.states ? options.states.join(", ") : "all US";
        description = `State filings (${display}, ${timeframe})`;
        break;
      }
      case "founder-exits": {
        const year = options.year || new Date().getFullYear();
        description = `Founder/CEO exits from press releases (${year})`;
        break;
      }
      case "sec-filings": {
        description = `SEC EDGAR 8-K filings (M&A items)`;
        break;
      }
      case "comprehensive": {
        description = `Comprehensive M&A search (all official sources)`;
        break;
      }
      case "custom": {
        if (!options.query) throw new Error("Query required for custom scraping");
        description = `Custom query: ${options.query.substring(0, 60)}...`;
        break;
      }
    }

    logger.info(`\n🔍 ${description}`);
    logger.info(`🚀 Starting real-time scraping from verified sources...`);

    const onEventsFound = async (events: any[]) => {
      const result = await processMAEventsToSignals(events);
      allSignalIds.push(...result.signalIds);
      totalProcessed += events.length;
      totalFailed += result.failed;
      totalAlreadyExists += result.alreadyExists;
      logger.info(
        `💾 Progress: ${allSignalIds.length} new, ${totalAlreadyExists} existing, ${totalFailed} failed`,
      );
    };

    switch (options.type) {
      case "acquisitions": {
        const country = options.country || "United States";
        await findRecentAcquisitions(country, onEventsFound);
        break;
      }

      case "state-filings": {
        const timeframe = getTimeframeString(options.days, options.timeframe);
        await findStateFilings(timeframe, options.states, onEventsFound);
        break;
      }

      case "founder-exits": {
        const year = options.year || new Date().getFullYear();
        await findFounderExits(year, onEventsFound);
        break;
      }

      case "sec-filings": {
        await findSECFilings(onEventsFound);
        break;
      }

      case "comprehensive": {
        await findAllMAEvents(onEventsFound);
        break;
      }

      case "custom": {
        if (!options.query) throw new Error("Query required for custom scraping");
        await scrapeCustomQuery([options.query], 5, onEventsFound);
        break;
      }
    }

    logger.info(`\n✅ Scraping complete!`);
    logger.info(
      `📊 Total: ${allSignalIds.length - totalAlreadyExists} new, ${totalAlreadyExists} existing, ${totalFailed} failed`,
    );

    return {
      success: true,
      successful: allSignalIds.length - totalAlreadyExists,
      alreadyExists: totalAlreadyExists,
      failed: totalFailed,
      signalIds: allSignalIds,
    };
  } catch (error: any) {
    logger.error(`❌ M&A scraping error:`, error.message);
    return {
      success: false,
      successful: 0,
      alreadyExists: 0,
      failed: 0,
      signalIds: [],
      error: error.message,
    };
  }
}

export async function getMAStats(): Promise<any> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const maMatch = { $match: { filingType: "ma-event" } };

  const [total, enrichment, eventTypes, statuses, recent, bySource] = await Promise.all([
    SignalNew.countDocuments({ filingType: "ma-event" }),
    SignalNew.aggregate([
      maMatch,
      { $group: { _id: "$contactEnrichmentStatus", count: { $sum: 1 } } },
    ]),
    SignalNew.aggregate([
      maMatch,
      {
        $group: {
          _id: "$maEventData.eventType",
          count: { $sum: 1 },
          avgDealValue: { $avg: "$maEventData.dealValue" },
        },
      },
      { $sort: { count: -1 } },
    ]),
    SignalNew.aggregate([
      maMatch,
      { $group: { _id: "$maEventData.status", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    SignalNew.countDocuments({ filingType: "ma-event", createdAt: { $gte: sevenDaysAgo } }),
    SignalNew.aggregate([maMatch, { $group: { _id: "$signalSource", count: { $sum: 1 } } }]),
  ]);

  return {
    total,
    enrichmentStatus: enrichment,
    eventTypes,
    statuses,
    recentSignals: { last7Days: recent },
    bySource,
  };
}
