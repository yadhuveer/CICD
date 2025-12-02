import { scrapeHiringEvents } from "../services/scraping/nonLiquidity/hiringPipeline.service.js";
import {
  SEARCH_QUERIES,
  PARALLEL_DISCOVERY_QUERIES,
  ATS_PLATFORMS,
} from "../config/hiring.config.js";
import type { HiringScrapingResult } from "../types/jobPosting.types.js";

// Use imported constants
const DISCOVERY_QUERIES = [...SEARCH_QUERIES];

// Command line a
const args = process.argv.slice(2);
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const noParallel = args.includes("--no-parallel");
const LIMIT_PER_TYPE = limitArg ? parseInt(limitArg.split("=")[1]) : 50;

interface DiscoveryResults {
  parallelDiscovery: HiringScrapingResult[];
  firecrawlSearches: HiringScrapingResult[];
  atsPlatforms: HiringScrapingResult[];
  summary: {
    totalSignals: number;
    totalSuccessful: number;
    totalFailed: number;
    totalAlreadyExists: number;
    uniqueSignalIds: string[];
    duration: string;
    strategiesUsed: number;
    estimatedCost: string;
  };
}

/**
 * Run comprehensive Family Office discovery (PURE WEB SEARCH)
 */
async function discoverAllFamilyOffices(): Promise<DiscoveryResults> {
  const startTime = Date.now();

  console.log("\n" + "=".repeat(80));
  console.log("🔍 PURE WEB DISCOVERY - NO SEEDS");
  console.log("=".repeat(80));
  console.log(`Mode: ${noParallel ? "BUDGET (Firecrawl only)" : "FULL (Parallel + Firecrawl)"}`);
  console.log(`Limit per strategy: ${LIMIT_PER_TYPE}`);
  console.log(`Discovery queries: ${DISCOVERY_QUERIES.length}`);
  console.log(`ATS platforms: ${ATS_PLATFORMS.length}`);
  console.log("=".repeat(80) + "\n");

  const results: DiscoveryResults = {
    parallelDiscovery: [],
    firecrawlSearches: [],
    atsPlatforms: [],
    summary: {
      totalSignals: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      totalAlreadyExists: 0,
      uniqueSignalIds: [],
      duration: "",
      strategiesUsed: 0,
      estimatedCost: "$0",
    },
  };

  // ============================================================================
  // STRATEGY 1: Parallel.ai Multi-Query Discovery
  // ============================================================================
  if (!noParallel) {
    console.log("\n" + "─".repeat(80));
    console.log("🤖 STRATEGY 1: PARALLEL.AI DISCOVERY");
    console.log("─".repeat(80));
    console.log("Using AI to discover new Family Offices from web...");

    const parallelQueries = [...PARALLEL_DISCOVERY_QUERIES];

    for (let i = 0; i < parallelQueries.length; i++) {
      const query = parallelQueries[i];
      console.log(`\n[${i + 1}/${parallelQueries.length}] ${query.substring(0, 70)}...`);

      try {
        const result = await scrapeHiringEvents({
          type: "discovery",
          query,
          limit: Math.floor(LIMIT_PER_TYPE / parallelQueries.length),
        });
        results.parallelDiscovery.push(result);
        console.log(`   ✅ Found ${result.successful} signals`);

        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } catch (error: any) {
        console.error(`   ❌ Failed:`, error.message);
        results.parallelDiscovery.push({
          success: false,
          successful: 0,
          alreadyExists: 0,
          failed: 0,
          signalIds: [],
          error: error.message,
        });
      }
    }
  } else {
    console.log("\n⏭️  STRATEGY 1: SKIPPED (--no-parallel flag)");
  }

  // ============================================================================
  // STRATEGY 2 & 3: DISABLED (Redundant - Parallel.ai already does everything)
  // ============================================================================
  // Parallel.ai discovers companies → Returns domains
  // Firecrawl scrapes those domains → Returns markdown
  // GPT parses markdown → Returns structured job data
  // No need for separate Firecrawl searches or ATS searches
  console.log("\n⏭️  STRATEGIES 2 & 3: SKIPPED (Parallel.ai pipeline is sufficient)");

  // ============================================================================
  // SUMMARY
  // ============================================================================
  const endTime = Date.now();
  const durationMs = endTime - startTime;
  const durationMin = (durationMs / 60000).toFixed(1);

  // Aggregate all signal IDs (only from Parallel.ai now)
  const allSignalIds = [...results.parallelDiscovery.flatMap((r) => r.signalIds)];
  const uniqueSignalIds = [...new Set(allSignalIds)];

  results.summary = {
    totalSignals: uniqueSignalIds.length,
    totalSuccessful: results.parallelDiscovery.reduce((sum, r) => sum + r.successful, 0),
    totalFailed: results.parallelDiscovery.reduce((sum, r) => sum + r.failed, 0),
    totalAlreadyExists: results.parallelDiscovery.reduce((sum, r) => sum + r.alreadyExists, 0),
    uniqueSignalIds,
    duration: `${durationMin} minutes`,
    strategiesUsed: results.parallelDiscovery.length > 0 ? 1 : 0,
    estimatedCost: "$0",
  };

  console.log("\n" + "=".repeat(80));
  console.log("📈 PURE WEB DISCOVERY COMPLETE");
  console.log("=".repeat(80));
  console.log(`Total Unique Signals: ${results.summary.totalSignals}`);
  console.log(`Successful: ${results.summary.totalSuccessful}`);
  console.log(`Already Exists: ${results.summary.totalAlreadyExists}`);
  console.log(`Failed: ${results.summary.totalFailed}`);
  console.log(`Duration: ${results.summary.duration}`);
  console.log(`Strategies Used: ${results.summary.strategiesUsed}/3`);
  console.log("=".repeat(80));

  console.log("\n📊 SIGNALS:");
  console.log(
    `  Total signals from Parallel.ai pipeline: ${results.parallelDiscovery.reduce((sum, r) => sum + r.successful, 0)} signals`,
  );

  console.log("\n✅ Discovery complete! All Family Offices found from web searches (no seeds)\n");

  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  discoverAllFamilyOffices()
    .then(() => {
      console.log("\n✅ Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Script failed:", error);
      process.exit(1);
    });
}

export { discoverAllFamilyOffices };
