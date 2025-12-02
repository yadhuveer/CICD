import {
  discoverAllPhilanthropySignals2,
  PhilanthropySignal,
} from "../../../tools/AiAgents/PhilanthropyAgent2.js";

import { SignalNew } from "../../../models/newSignal.model.js";

export type PhilanthropyScrapingResult = {
  success: boolean;
  totalSignals: number;
  signals: PhilanthropySignal[];
  error?: string;
  metadata?: {
    categories: string[];
    queriesProcessed: number;
    estimatedPagesScraped: number;
    deduplicationApplied: boolean;
  };
};

export interface PhilanthropyScraperOptions {
  maxQueriesPerCategory?: number;

  maxPagesPerQuery?: number;

  categories?: Array<"museum" | "medical" | "educational" | "cultural">;
}

export async function scrapePhilanthropySignals2(
  options: PhilanthropyScraperOptions = {},
): Promise<PhilanthropyScrapingResult> {
  try {
    if (!process.env.FIRECRAWL_API_KEY) {
      throw new Error("FIRECRAWL_API_KEY is required");
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required");
    }

    // Set defaults - optimized for 40+ high-quality LATEST signals in under 1 minute
    // 4 categories × 3 queries × 1 page = 12 pages total (~4-5 signals per page = 48-60 total)
    const maxQueriesPerCategory = Math.min(options.maxQueriesPerCategory || 3, 10);
    const maxPagesPerQuery = Math.min(options.maxPagesPerQuery || 1, 5);
    const categories = options.categories || ["museum", "medical", "educational", "cultural"];

    console.log(` Starting  philanthropy discovery`);

    // Run the automated discovery
    const signals = await discoverAllPhilanthropySignals2({
      maxQueriesPerCategory,
      maxPagesPerQuery,
      categories,
    });

    const estimatedPagesScraped = categories.length * maxQueriesPerCategory * maxPagesPerQuery;

    const signalIds: string[] = [];
    let successful = 0;
    let alreadyExists = 0;
    let failed = 0;

    for (const signal of signals) {
      try {
        // Check if signal already exists by fullName + institutionName
        const existingSignal = await SignalNew.findOne({
          fullName: signal.fullName,
          filingType: "philanthropy-event",
          "philanthropyData.institutionName": signal.institutionName,
        });

        if (existingSignal) {
          console.log(`Already exists: ${signal.fullName} at ${signal.institutionName}`);
          signalIds.push(String(existingSignal._id));
          alreadyExists++;
          continue;
        }

        // Parse and validate appointment date
        let appointmentDate: Date | undefined = undefined;
        if (signal.appointmentDate) {
          const parsedDate = new Date(signal.appointmentDate);
          // Check if date is valid (not NaN)
          if (!isNaN(parsedDate.getTime())) {
            appointmentDate = parsedDate;
          }
        }

        // Create new signal document
        const signalData = {
          signalSource: "Person" as const,
          signalType: "philanthropy-sponsorship",
          filingType: "philanthropy-event" as const,
          filingLink: signal.sourceUrl,
          filingDate: appointmentDate || new Date(),
          fullName: signal.fullName,
          companyName: signal.companyName,
          location: signal.institutionLocation,
          insights: signal.description,
          aiModelUsed: "gpt-4o-mini",
          processingStatus: "Processed" as const,
          philanthropyData: {
            role: signal.role,
            institutionName: signal.institutionName,
            institutionType: signal.institutionType,
            sponsorshipLevel: signal.sponsorshipLevel,
            wealthIndicators: signal.wealthIndicators,
            sourceTitle: signal.sourceTitle,
          },
        };

        const newSignal = await SignalNew.create(signalData);
        signalIds.push(String(newSignal._id));
        successful++;
        console.log(`Saved: ${signal.fullName} at ${signal.institutionName}`);
      } catch (error: any) {
        console.error(`Error saving ${signal.fullName}:`, error.message);
        failed++;
      }
    }

    console.log(` Philanthropy scraping completed`);
    console.log(`   Total unique signals discovered: ${signals.length}`);

    console.log(`Database save summary:`);
    console.log(`   Successfully saved: ${successful}`);
    console.log(`   Already existed: ${alreadyExists}`);
    console.log(`   Failed: ${failed}`);

    /*return {
      success: true,
      totalSignals: signals.length,
      
     
    
      
      metadata: {
        categories,
        queriesProcessed: categories.length * maxQueriesPerCategory,
        estimatedPagesScraped,
        deduplicationApplied: true,
      },
    };*/

    // Return signals as JSON array
    return {
      success: true,
      totalSignals: signals.length,
      signals: signals,
      metadata: {
        categories,
        queriesProcessed: categories.length * maxQueriesPerCategory,
        estimatedPagesScraped,
        deduplicationApplied: true,
      },
    };
  } catch (error: any) {
    console.error(`Philanthropy scraping error:`, error.message);
    return {
      success: false,
      totalSignals: 0,
      signals: [],
      error: error.message,
    };
  }
}

/**
 * For Testing - Returns JSON array without database save
 */
export async function testPhilanthropyPipeline2(): Promise<PhilanthropyScrapingResult> {
  console.log("Testing Philanthropy Pipeline (Museums only)...\n");

  return scrapePhilanthropySignals2({
    maxQueriesPerCategory: 1, // Only 1 museum query
    maxPagesPerQuery: 2, // Only 2 pages per query
    categories: ["museum"], // Only museums
  });
}
