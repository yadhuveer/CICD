import { Request, Response } from "express";
import { InstitutionalFiler } from "../models/13FInstitutes.model.js";
import { Holding } from "../models/13FHoldings.model.js";
import {
  processAllCompanies,
  processSingleCompany,
} from "../services/institutional-v2/pipeline.service.js";
import { TARGET_COMPANIES } from "../services/institutional-v2/fetcher.service.js";
import {
  generateInsightsForFiler,
  generateInsightsForAllFilers,
  getInsightsStatus,
} from "../services/institutional-v2/form13fInsightsGeneration.service.js";
import logger from "../utils/logger.js";

export async function process13FFilings(req: Request, res: Response) {
  try {
    const { startYear = 2023, endYear = 2025, cik } = req.body;

    console.log(`\nReceived processing request:`);
    console.log(`   Start Year: ${startYear}`);
    console.log(`   End Year: ${endYear}`);
    console.log(`   Single CIK: ${cik || "All companies"}`);

    const result = cik
      ? await processSingleCompany(cik, startYear, endYear)
      : await processAllCompanies(startYear, endYear);

    res.json({
      success: true,
      message: "Processing completed",
      result,
    });
  } catch (error: any) {
    console.error("Error processing 13F filings:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to process 13F filings",
    });
  }
}

export async function getFilers(req: Request, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const sortBy = (req.query.sortBy as string) || "latestActivity.lastFilingDate";
    const order = (req.query.order as string) === "asc" ? 1 : -1;
    const search = req.query.search as string;

    const skip = (page - 1) * limit;

    const query: any = {};
    if (search) {
      query.$or = [
        { filerName: { $regex: search, $options: "i" } },
        { cik: { $regex: search, $options: "i" } },
      ];
    }

    const total = await InstitutionalFiler.countDocuments(query);

    const filers = await InstitutionalFiler.find(query)
      .select("cik filerName latestActivity address quarterlyReports")
      .sort({ [sortBy]: order })
      .skip(skip)
      .limit(limit);

    const formattedFilers = await Promise.all(
      filers.map(async (filer) => {
        // Calculate quarterly change from the last two quarters
        let quarterlyChange: number | null = null;
        let quarterlyChangePct: number | null = null;

        if (filer.quarterlyReports && filer.quarterlyReports.length >= 2) {
          const latest = filer.quarterlyReports[filer.quarterlyReports.length - 1];
          const previous = filer.quarterlyReports[filer.quarterlyReports.length - 2];

          if (latest?.summary?.totalMarketValue && previous?.summary?.totalMarketValue) {
            quarterlyChange = latest.summary.totalMarketValue - previous.summary.totalMarketValue;
            quarterlyChangePct = (quarterlyChange / previous.summary.totalMarketValue) * 100;
          }
        }

        // Extract enriched data from latest quarterly report
        let topHolding = "—";
        let recentlyBought = "—";
        let recentlySold = "—";

        if (filer.quarterlyReports && filer.quarterlyReports.length > 0) {
          const latestReport = filer.quarterlyReports[filer.quarterlyReports.length - 1];

          // Fetch holdings from separate collection (grouped document)
          const quarterlyHoldings = await Holding.findOne({
            cik: filer.cik,
            quarter: latestReport.quarter,
          }).lean();

          const holdings = quarterlyHoldings?.holdings || [];

          if (holdings.length > 0) {
            // Sort by value to get top holdings
            const sortedHoldings = [...holdings].sort((a: any, b: any) => b.value - a.value);

            // Top holding (first one, as they're sorted by value)
            topHolding = sortedHoldings[0]?.issuerName || "—";

            // Recently bought (NEW or INCREASED)
            const bought = holdings.find(
              (h: any) => h.changeType === "NEW" || h.changeType === "INCREASED",
            );
            recentlyBought = bought?.issuerName || "—";

            // Recently sold (DECREASED or EXITED)
            const sold = holdings.find(
              (h: any) => h.changeType === "DECREASED" || h.changeType === "EXITED",
            );
            recentlySold = sold?.issuerName || "—";
          }
        }

        return {
          _id: filer._id.toString(),
          cik: filer.cik,
          filerName: filer.filerName,
          latestActivity: {
            ...filer.latestActivity,
            quarterlyChange,
            quarterlyChangePct,
          } as any,
          location: `${filer.address?.city || "N/A"}, ${filer.address?.state || "N/A"}`,
          quarterlyReportsCount: filer.quarterlyReports?.length || 0,
          topHolding,
          recentlyBought,
          recentlySold,
        };
      }),
    );

    res.json({
      success: true,
      data: {
        filers: formattedFilers,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error("Error fetching filers:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch filers",
    });
  }
}

export async function getFilerByCIK(req: Request, res: Response) {
  try {
    const { cik } = req.params;

    const filer = await InstitutionalFiler.findOne({ cik });

    if (!filer) {
      return res.status(404).json({
        success: false,
        error: "Filer not found",
      });
    }

    // Include overallInsight in the response
    const response = {
      _id: filer._id.toString(),
      cik: filer.cik,
      filerName: filer.filerName,
      address: filer.address,
      latestActivity: filer.latestActivity,
      quarterlyReports: filer.quarterlyReports,
      overallInsight: filer.overallInsight || null,
    };

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("Error fetching filer:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch filer",
    });
  }
}

export async function getFilerHoldings(req: Request, res: Response) {
  try {
    const { cik } = req.params;
    const quartersParam = parseInt(req.query.quarters as string);
    // Default to 4 quarters, but allow fetching all available (up to 200)
    const quarters = quartersParam && quartersParam > 0 ? Math.min(quartersParam, 200) : 4;
    const sortBy = (req.query.sortBy as string) || "latestValue";
    const changeType = req.query.changeType as string;

    const filer = await InstitutionalFiler.findOne({ cik });

    if (!filer) {
      return res.status(404).json({
        success: false,
        error: "Filer not found",
      });
    }

    // Get most recent N quarters and sort in descending order (newest first)
    const recentReports = filer.quarterlyReports
      .slice(-quarters)
      .sort(
        (a: any, b: any) =>
          new Date(b.periodOfReport).getTime() - new Date(a.periodOfReport).getTime(),
      );

    const quarterList = recentReports.map((r: any) => r.quarter);

    // Build a map of sectorBreakdown by quarter
    const sectorBreakdownMap = new Map<string, any[]>();
    recentReports.forEach((report: any) => {
      if (report.sectorBreakdown && report.sectorBreakdown.length > 0) {
        sectorBreakdownMap.set(report.quarter, report.sectorBreakdown);
      }
    });

    // Fetch all holdings for these quarters from separate collection (grouped documents)
    const quarterlyHoldingsDocs = await Holding.find({
      cik: cik,
      quarter: { $in: quarterList },
    }).lean();

    const holdingsMap = new Map<string, any>();

    // Build holdings map by CUSIP from grouped documents
    quarterlyHoldingsDocs.forEach((doc: any) => {
      const quarter = doc.quarter;
      const holdings = doc.holdings || [];

      holdings.forEach((holding: any) => {
        const cusip = holding.cusip;

        if (!holdingsMap.has(cusip)) {
          holdingsMap.set(cusip, {
            cusip,
            issuerName: holding.issuerName,
            ticker: holding.ticker,
            sector: holding.sector,
            quarterlyData: [],
          });
        }

        holdingsMap.get(cusip).quarterlyData.push({
          quarter: quarter,
          value: holding.value,
          shares: holding.shares,
          percentOfPortfolio: holding.percentOfPortfolio,
          changeFromPrevQuarter: holding.valueChangePct,
          type: holding.changeType,
        });
      });
    });

    let holdings = Array.from(holdingsMap.values());

    // CRITICAL FIX: Sort each holding's quarterlyData to match the order of quarterList
    // This ensures quarterlyData[i] corresponds to quarters[i] for frontend compatibility
    holdings.forEach((holding) => {
      const sortedQuarterlyData: any[] = [];
      quarterList.forEach((quarter) => {
        const data = holding.quarterlyData.find((qd: any) => qd.quarter === quarter);
        if (data) {
          sortedQuarterlyData.push(data);
        }
      });
      holding.quarterlyData = sortedQuarterlyData;
    });

    if (changeType) {
      holdings = holdings.filter((h) => h.quarterlyData.some((q: any) => q.type === changeType));
    }

    if (sortBy === "latestValue") {
      holdings.sort((a, b) => {
        const aLatest = a.quarterlyData[0]?.value || 0;
        const bLatest = b.quarterlyData[0]?.value || 0;
        return bLatest - aLatest;
      });
    }

    res.json({
      success: true,
      data: {
        filer: {
          filerName: filer.filerName,
          cik: filer.cik,
          latestQuarter: recentReports[0]?.quarter || "",
        },
        quarters: quarterList,
        holdings,
        sectorBreakdownByQuarter: Object.fromEntries(sectorBreakdownMap),
      },
    });
  } catch (error: any) {
    console.error("Error fetching holdings:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch holdings",
    });
  }
}

export async function searchFilers(req: Request, res: Response) {
  try {
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Search query is required",
      });
    }

    const filers = await InstitutionalFiler.find({
      $or: [
        { filerName: { $regex: query, $options: "i" } },
        { cik: { $regex: query, $options: "i" } },
      ],
    })
      .select("cik filerName latestActivity")
      .limit(limit);

    res.json({
      success: true,
      data: filers,
    });
  } catch (error: any) {
    console.error("Error searching filers:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to search filers",
    });
  }
}

export async function getStats(req: Request, res: Response) {
  try {
    const totalFilers = await InstitutionalFiler.countDocuments();

    const topFilers = await InstitutionalFiler.find()
      .select("cik filerName latestActivity")
      .sort({ "latestActivity.currentMarketValue": -1 })
      .limit(10);

    const stats = {
      totalFilers,
      topFilersByValue: topFilers.map((f) => ({
        cik: f.cik,
        name: f.filerName,
        marketValue: f.latestActivity?.currentMarketValue,
        lastQuarter: f.latestActivity?.lastReportedQuarter,
      })),
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("Error fetching stats:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch stats",
    });
  }
}

export async function getTargetCompanies(req: Request, res: Response) {
  try {
    res.json({
      success: true,
      data: TARGET_COMPANIES,
    });
  } catch (error: any) {
    console.error("Error fetching target companies:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch target companies",
    });
  }
}

/**
 * Generate Form 13F insights for a specific filer
 * POST /api/institutional-v2/filers/:cik/generate-insights
 * Query params:
 * - force: boolean (optional, default: false) - If true, regenerate insights even if they exist
 */
export async function generateFilerInsights(req: Request, res: Response) {
  try {
    const { cik } = req.params;
    const force = req.query?.force === "true" || req.body?.force === true;

    logger.info(`🔍 Request to generate insights for filer CIK: ${cik} (force: ${force})`);

    const result = await generateInsightsForFiler(cik, force);

    res.json({
      success: true,
      message: "Insights generation completed",
      data: result,
    });
  } catch (error: any) {
    logger.error("Error generating filer insights:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate insights",
    });
  }
}

/**
 * Generate Form 13F insights for all filers
 * POST /api/institutional-v2/generate-all-insights
 * Query params:
 * - force: boolean (optional, default: false) - If true, regenerate all insights
 * - limit: number (optional) - Maximum number of filers to process
 */
export async function generateAllFilersInsights(req: Request, res: Response) {
  try {
    const force = req.query?.force === "true" || req.body?.force === true;
    const limit = req.query?.limit ? parseInt(req.query.limit as string) : undefined;

    logger.info(
      `🔍 Request to generate insights for all filers (force: ${force}, limit: ${limit || "none"})`,
    );

    const results = await generateInsightsForAllFilers(force, limit);

    const summary = {
      totalFilers: results.length,
      generated: results.filter((r: any) => r.generated).length,
      skipped: results.filter((r: any) => !r.generated && !r.error).length,
      errors: results.filter((r: any) => r.error).length,
    };

    res.json({
      success: true,
      message: "Batch insights generation completed",
      data: {
        summary,
        results,
      },
    });
  } catch (error: any) {
    logger.error("Error generating all filer insights:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate insights for all filers",
    });
  }
}

/**
 * Get insights status across all filers
 * GET /api/institutional-v2/insights-status
 */
export async function getFilersInsightsStatus(req: Request, res: Response) {
  try {
    logger.info(`📊 Request to check insights status`);

    const status = await getInsightsStatus();

    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    logger.error("Error checking insights status:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to check insights status",
    });
  }
}
