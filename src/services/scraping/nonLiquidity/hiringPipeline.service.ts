import { SignalNew } from "../../../models/newSignal.model.js";
import {
  scrapeFamilyOfficeHiring,
  discoverAndScrapeFamilyOffices,
  searchFamilyOfficeCompanies,
  mapJobPostingsToSignals,
  scrapeJobPostings,
} from "../../../tools/AiAgents/scraperAgents/nonLiquidity/FamilyOfficeHiringAgent.js";
import type {
  JobPosting,
  HiringScrapingResult,
  HiringScraperOptions,
} from "../../../types/jobPosting.types.js";

// Re-export types for convenience
export type {
  HiringScrapingResult,
  HiringScraperOptions,
} from "../../../types/jobPosting.types.js";

/**
 * Family Office Hiring Signal Pipeline
 * Scrapes job postings for CFO/Controller/Analyst roles at Family Offices
 * Indicates professionalization and OCIO needs
 */

/**
 * Process job postings and save as signals
 */
async function processJobPostingsToSignals(jobs: JobPosting[]): Promise<string[]> {
  if (jobs.length === 0) return [];

  const signals = mapJobPostingsToSignals(jobs);
  console.log(`✅ Mapped ${jobs.length} job(s) to ${signals.length} signal(s)`);

  const signalIds: string[] = [];
  for (const signalData of signals) {
    try {
      // Check for existing signal (same company + job title + posting date)
      const existingSignal = await SignalNew.findOne({
        fullName: signalData.fullName,
        filingType: "hiring-event",
        "jobPostingData.jobTitle": signalData.jobPostingData?.jobTitle,
        "jobPostingData.postingDate": signalData.jobPostingData?.postingDate,
      });

      if (existingSignal) {
        signalIds.push(String(existingSignal._id));
        console.log(
          `   ⏭️  Already exists: ${signalData.fullName} - ${signalData.jobPostingData?.jobTitle}`,
        );
        continue;
      }

      const newSignal = await SignalNew.create(signalData);
      signalIds.push(String(newSignal._id));
      console.log(`✅ Created: ${signalData.fullName} - ${signalData.jobPostingData?.jobTitle}`);
    } catch (error: any) {
      console.error(`❌ Error saving ${signalData.fullName}:`, error.message);
    }
  }

  return signalIds;
}

/**
 * Unified Family Office hiring scraping function
 * Handles all scraping types: discovery, monitoring, custom queries, ATS searches
 */
export async function scrapeHiringEvents(
  options: HiringScraperOptions,
): Promise<HiringScrapingResult> {
  try {
    // Check for required environment variables
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    const parallelKey = process.env.PARALLEL_API_KEY;

    if (!firecrawlKey && options.type !== "ats-search") {
      throw new Error("FIRECRAWL_API_KEY required for this scraping type");
    }

    const limit = options.limit || 10;
    let allJobs: JobPosting[] = [];
    let description = "";

    // Call appropriate scraper based on type
    switch (options.type) {
      case "discovery": {
        // Discover new Family Offices and scrape their job postings
        if (!parallelKey) {
          throw new Error("PARALLEL_API_KEY required for discovery");
        }

        const query =
          options.query || "Find Family Office companies hiring CFO or Controller roles";
        description = `Discovery: ${query.substring(0, 60)}...`;

        allJobs = await discoverAndScrapeFamilyOffices(query, limit);
        break;
      }

      case "monitoring": {
        // Monitor specific Family Office domains for new postings
        if (!options.domains || options.domains.length === 0) {
          throw new Error("Domains required for monitoring");
        }

        description = `Monitoring ${options.domains.length} domains`;

        for (const domain of options.domains.slice(0, limit)) {
          console.log(`\n🔍 Monitoring: ${domain}`);
          const jobs = await scrapeFamilyOfficeHiring(domain);
          allJobs.push(...jobs);

          // Rate limiting
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        break;
      }

      case "custom": {
        // Custom search query using Firecrawl
        if (!options.query) {
          throw new Error("Query required for custom scraping");
        }

        description = `Custom: ${options.query.substring(0, 60)}...`;

        const searchResults = await searchFamilyOfficeCompanies(options.query, limit);

        console.log(`\n📄 Processing ${searchResults.length} search result(s)...`);

        // Scrape the job URLs directly (search results ARE job postings)
        for (const result of searchResults) {
          try {
            console.log(`\n🔗 Scraping job URL: ${result.url.substring(0, 60)}...`);

            const jobs = await scrapeJobPostings(result.url);
            allJobs.push(...jobs);

            // Rate limiting
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } catch (e: any) {
            console.log(`   ⚠️  Error scraping ${result.url}: ${e.message}`);
          }
        }
        break;
      }

      case "ats-search": {
        // Search ATS platforms (Greenhouse, Lever, etc.) for Family Office jobs
        const platform = options.atsPlatform || "greenhouse";
        const searchQuery =
          options.query ||
          `"family office" CFO OR Controller OR "Financial Analyst" site:${platform}.io`;

        description = `ATS Search: ${platform}`;

        const searchResults = await searchFamilyOfficeCompanies(searchQuery, limit);

        // Scrape job postings from ATS URLs
        for (const result of searchResults.slice(0, limit)) {
          try {
            console.log(`\n🔍 Scraping ATS posting: ${result.url}`);
            // ATS pages are typically single job postings
            const jobs = await scrapeFamilyOfficeHiring(result.url);
            allJobs.push(...jobs);

            // Rate limiting
            await new Promise((resolve) => setTimeout(resolve, 1500));
          } catch (e: any) {
            console.log(`   ⚠️  Error scraping ${result.url}:`, e.message);
          }
        }
        break;
      }
    }

    console.log(`\n🔍 ${description}`);
    console.log(`📊 Found ${allJobs.length}, processing ${Math.min(limit, allJobs.length)}`);

    const limitedJobs = allJobs.slice(0, limit);
    const signalIds = await processJobPostingsToSignals(limitedJobs);

    const successCount = signalIds.length;
    const failedCount = limitedJobs.length - signalIds.length;

    // Count how many already existed (approximation)
    const alreadyExistsCount = 0; // This is tracked in processJobPostingsToSignals logs

    return {
      success: true,
      successful: successCount,
      alreadyExists: alreadyExistsCount,
      failed: failedCount,
      signalIds,
    };
  } catch (error: any) {
    console.error(`❌ Hiring scraping error:`, error.message);
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

/**
 * Get comprehensive hiring statistics
 */
export async function getHiringStats(): Promise<any> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const hiringMatch = { $match: { filingType: "hiring-event" } };

  const [total, enrichment, jobLevels, urgency, recent, byCompany] = await Promise.all([
    SignalNew.countDocuments({ filingType: "hiring-event" }),

    // Enrichment status breakdown
    SignalNew.aggregate([
      hiringMatch,
      { $group: { _id: "$contactEnrichmentStatus", count: { $sum: 1 } } },
    ]),

    // Job levels (CFO, Controller, Director, etc.)
    SignalNew.aggregate([
      hiringMatch,
      {
        $group: {
          _id: "$jobPostingData.jobLevel",
          count: { $sum: 1 },
          avgQualityScore: { $avg: "$jobPostingData.qualityScore" },
        },
      },
      { $sort: { count: -1 } },
    ]),

    // Hiring urgency distribution
    SignalNew.aggregate([
      hiringMatch,
      {
        $group: {
          _id: "$jobPostingData.hiringUrgency",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]),

    // Recent signals (last 7 days)
    SignalNew.countDocuments({
      filingType: "hiring-event",
      createdAt: { $gte: sevenDaysAgo },
    }),

    // Top companies hiring
    SignalNew.aggregate([
      hiringMatch,
      {
        $group: {
          _id: "$companyName",
          count: { $sum: 1 },
          roles: { $push: "$jobPostingData.jobTitle" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);

  // Calculate Family Office indicators stats
  const foIndicators = await SignalNew.aggregate([
    hiringMatch,
    {
      $match: {
        "jobPostingData.familyOfficeIndicators": { $exists: true, $ne: [] },
      },
    },
    { $count: "total" },
  ]);

  const foIndicatorsCount = foIndicators[0]?.total || 0;

  // Calculate new roles vs replacements
  const newRoles = await SignalNew.countDocuments({
    filingType: "hiring-event",
    "jobPostingData.isNewRole": true,
  });

  return {
    total,
    enrichmentStatus: enrichment,
    jobLevels,
    urgency,
    recentSignals: { last7Days: recent },
    topCompanies: byCompany,
    familyOfficeIndicators: {
      totalWithIndicators: foIndicatorsCount,
      percentage: total > 0 ? ((foIndicatorsCount / total) * 100).toFixed(1) : 0,
    },
    roleTypes: {
      newRoles,
      replacements: total - newRoles,
    },
  };
}

/**
 * Get hiring trends over time
 */
export async function getHiringTrends(days: number = 30): Promise<any> {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const trendData = await SignalNew.aggregate([
    {
      $match: {
        filingType: "hiring-event",
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
        },
        count: { $sum: 1 },
        companies: { $addToSet: "$companyName" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return {
    period: `Last ${days} days`,
    dailyData: trendData,
    totalSignals: trendData.reduce((sum, day) => sum + day.count, 0),
    uniqueCompanies: new Set(trendData.flatMap((day) => day.companies)).size,
  };
}

/**
 * Monitor specific Family Office domains for new job postings
 * This function is designed to be run on a schedule (e.g., daily cron job)
 */
export async function monitorFamilyOfficeDomains(
  domains: string[],
  limit?: number,
): Promise<HiringScrapingResult> {
  console.log(`\n📅 Daily monitoring of ${domains.length} Family Office domains`);

  return scrapeHiringEvents({
    type: "monitoring",
    domains,
    limit,
  });
}

/**
 * Discover new Family Offices hiring finance roles
 * This function is designed to be run weekly to discover new FO companies
 */
export async function discoverNewFamilyOffices(
  query?: string,
  limit?: number,
): Promise<HiringScrapingResult> {
  const defaultQuery =
    query ||
    "Find Family Office companies hiring CFO, Controller, or Financial Analyst roles in 2025";

  console.log(`\n🔎 Weekly discovery of new Family Offices`);

  return scrapeHiringEvents({
    type: "discovery",
    query: defaultQuery,
    limit,
  });
}

/**
 * Search ATS platforms for Family Office job postings
 */
export async function searchATSPlatforms(
  platform: "greenhouse" | "lever" | "workday" | "bamboo" = "greenhouse",
  limit?: number,
): Promise<HiringScrapingResult> {
  console.log(`\n🎯 Searching ${platform} for Family Office jobs`);

  return scrapeHiringEvents({
    type: "ats-search",
    atsPlatform: platform,
    limit,
  });
}
