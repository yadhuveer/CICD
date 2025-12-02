import { InstitutionalFiler } from "../models/13FInstitutes.model.js";
import logger from "../utils/logger.js";

/**
 * =========================================
 * INSTITUTIONAL FILER SERVICE
 * =========================================
 * Provides clean, frontend-optimized APIs for 13F institutional data
 * Separate from the scraping/processing pipeline
 */

interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  order?: "asc" | "desc";
  search?: string;
}

interface FilerListResult {
  filers: any[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

interface HoldingQuarterlyData {
  quarter: string;
  value: number;
  shares: number;
  percentOfPortfolio: number;
  changeFromPrevQuarter: number | null;
  type: "NEW" | "INCREASED" | "DECREASED" | "UNCHANGED" | "EXITED";
}

interface HoldingTimeline {
  issuerName: string;
  cusip: string;
  ticker: string | undefined;
  quarterlyData: HoldingQuarterlyData[];
}

interface FilerHoldingsResult {
  filer: {
    filerName: string;
    cik: string;
    latestQuarter: string;
  };
  quarters: string[];
  holdings: HoldingTimeline[];
}

/**
 * Get all institutional filers with pagination and search
 */
export async function getAllFilers(params: PaginationParams): Promise<FilerListResult> {
  try {
    const { page = 1, limit = 20, sortBy = "currentMarketValue", order = "desc", search } = params;

    logger.info(`📋 Fetching filers: page=${page}, limit=${limit}, sortBy=${sortBy}`);

    const skip = (page - 1) * limit;
    const sortOrder = order === "desc" ? -1 : 1;

    // Build query
    const query: any = {};
    if (search) {
      query.$or = [
        { filerName: { $regex: search, $options: "i" } },
        { cik: { $regex: search, $options: "i" } },
      ];
    }

    // Build sort object
    let sortField = `latestActivity.${sortBy}`;
    if (sortBy === "filerName") {
      sortField = "filerName";
    }

    // Execute queries in parallel
    const [filers, total] = await Promise.all([
      InstitutionalFiler.find(query)
        .select("filerName cik latestActivity address.city address.stateOrCountry quarterlyReports")
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      InstitutionalFiler.countDocuments(query),
    ]);

    // Format filers for frontend
    const formattedFilers = filers.map((filer) => {
      // Get the latest quarterly report for portfolio changes
      const latestQuarter = filer.quarterlyReports?.[0];
      const portfolioChanges = latestQuarter?.portfolioChanges;

      return {
        _id: filer._id,
        filerName: filer.filerName,
        cik: filer.cik,
        latestActivity: {
          ...filer.latestActivity,
          quarterlyChange: portfolioChanges?.totalValueChange || null,
          quarterlyChangePct: portfolioChanges?.totalValueChangePct || null,
        },
        location:
          filer.address?.city && filer.address?.state
            ? `${filer.address.city}, ${filer.address.state}`
            : null,
      };
    });

    logger.info(`✅ Found ${total} filers, returning page ${page}`);

    return {
      filers: formattedFilers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (err: any) {
    logger.error(`Error fetching filers: ${err.message}`);
    throw err;
  }
}

/**
 * Get single filer by CIK
 */
export async function getFilerByCik(cik: string) {
  try {
    logger.info(`🔍 Fetching filer by CIK: ${cik}`);

    const filer = await InstitutionalFiler.findOne({ cik })
      .select(
        "filerName cik latestActivity address contactInfo signature form13FFileNumber quarterlyReports.quarter quarterlyReports.periodOfReport quarterlyReports.summary",
      )
      .lean();

    if (!filer) {
      throw new Error(`Filer not found with CIK: ${cik}`);
    }

    // Format quarterly summary
    const quarterSummary = filer.quarterlyReports?.map((qr: any) => ({
      quarter: qr.quarter,
      periodOfReport: qr.periodOfReport,
      holdingsCount: qr.summary?.totalHoldingsCount,
      marketValue: qr.summary?.totalMarketValue,
    }));

    logger.info(`✅ Found filer: ${filer.filerName}`);

    return {
      ...filer,
      quarterSummary,
    };
  } catch (err: any) {
    logger.error(`Error fetching filer ${cik}: ${err.message}`);
    throw err;
  }
}

/**
 * Get filer holdings with QoQ data in frontend-optimized format
 */
export async function getFilerHoldings(
  cik: string,
  quartersCount: number = 4,
  sortBy: string = "latestValue",
  changeType?: string,
): Promise<FilerHoldingsResult> {
  try {
    logger.info(
      `📊 Fetching holdings for CIK: ${cik}, quarters=${quartersCount}, sortBy=${sortBy}`,
    );

    // Fetch filer with quarterly reports
    const filer = await InstitutionalFiler.findOne({ cik })
      .select("filerName cik quarterlyReports")
      .lean();

    if (!filer) {
      throw new Error(`Filer not found with CIK: ${cik}`);
    }

    if (!filer.quarterlyReports || filer.quarterlyReports.length === 0) {
      return {
        filer: {
          filerName: filer.filerName,
          cik: filer.cik,
          latestQuarter: "N/A",
        },
        quarters: [],
        holdings: [],
      };
    }

    // Get recent quarters (already sorted newest first)
    const recentQuarters = filer.quarterlyReports.slice(0, quartersCount);
    const quartersList = recentQuarters.map((qr: any) => qr.quarter);

    // Transform to holdings-centric view (grouped by CUSIP)
    const holdingsMap = transformHoldingsToQoQ(recentQuarters);

    // Convert Map to Array
    let holdingsArray = Array.from(holdingsMap.values());

    // Filter by changeType if specified
    if (changeType) {
      holdingsArray = holdingsArray.filter((holding) =>
        holding.quarterlyData.some((qd) => qd.type === changeType),
      );
    }

    // Sort holdings
    if (sortBy === "latestValue") {
      holdingsArray.sort((a, b) => {
        const aLatest = a.quarterlyData[0]?.value || 0;
        const bLatest = b.quarterlyData[0]?.value || 0;
        return bLatest - aLatest;
      });
    } else if (sortBy === "name") {
      holdingsArray.sort((a, b) => a.issuerName.localeCompare(b.issuerName));
    }

    logger.info(
      `✅ Processed ${holdingsArray.length} holdings across ${quartersList.length} quarters`,
    );

    return {
      filer: {
        filerName: filer.filerName,
        cik: filer.cik,
        latestQuarter: quartersList[0] || "N/A",
      },
      quarters: quartersList,
      holdings: holdingsArray,
    };
  } catch (err: any) {
    logger.error(`Error fetching holdings for ${cik}: ${err.message}`);
    throw err;
  }
}

/**
 * Transform quarterly reports into holdings-centric view
 * FROM: Quarter → Holdings[]
 * TO: Holding → Quarters[]
 */
function transformHoldingsToQoQ(quarterlyReports: any[]): Map<string, HoldingTimeline> {
  const holdingsMap = new Map<string, HoldingTimeline>();

  // Iterate through quarters (newest to oldest)
  quarterlyReports.forEach((qr) => {
    if (!qr.holdings) return;

    qr.holdings.forEach((holding: any) => {
      const key = holding.cusip;

      // Initialize holding entry if not exists
      if (!holdingsMap.has(key)) {
        holdingsMap.set(key, {
          issuerName: holding.issuerName,
          cusip: holding.cusip,
          ticker: holding.ticker,
          quarterlyData: [],
        });
      }

      // Add quarterly data point
      holdingsMap.get(key)!.quarterlyData.push({
        quarter: qr.quarter,
        value: holding.value,
        shares: holding.shares,
        percentOfPortfolio: holding.percentOfPortfolio || 0,
        changeFromPrevQuarter: holding.valueChangePct || null,
        type: holding.changeType || "NEW",
      });
    });
  });

  return holdingsMap;
}

/**
 * Search filers by name or CIK
 */
export async function searchFilers(query: string, limit: number = 10) {
  try {
    logger.info(`🔎 Searching filers with query: "${query}"`);

    const filers = await InstitutionalFiler.find({
      $or: [
        { filerName: { $regex: query, $options: "i" } },
        { cik: { $regex: query, $options: "i" } },
      ],
    })
      .select("filerName cik latestActivity.lastReportedQuarter latestActivity.currentMarketValue")
      .limit(limit)
      .lean();

    logger.info(`✅ Found ${filers.length} matching filers`);

    return filers;
  } catch (err: any) {
    logger.error(`Error searching filers: ${err.message}`);
    throw err;
  }
}

/**
 * Get aggregate statistics for institutional filers
 */
export async function getInstitutionalStats() {
  try {
    logger.info("📊 Calculating institutional statistics...");

    // Get all filers
    const filers = await InstitutionalFiler.find()
      .select("filerName cik latestActivity quarterlyReports")
      .lean();

    const totalFilers = filers.length;

    // Calculate aggregate metrics
    let totalMarketValue = 0;
    let totalHoldings = 0;
    const changeTypeCounts: Record<string, number> = {
      NEW: 0,
      INCREASED: 0,
      DECREASED: 0,
      UNCHANGED: 0,
      EXITED: 0,
    };

    filers.forEach((filer) => {
      if (filer.latestActivity?.currentMarketValue) {
        totalMarketValue += filer.latestActivity.currentMarketValue;
      }

      // Count holdings and change types from latest quarter
      if (filer.quarterlyReports && filer.quarterlyReports.length > 0) {
        const latestReport = filer.quarterlyReports[0];
        totalHoldings += latestReport.holdings?.length || 0;

        latestReport.holdings?.forEach((holding: any) => {
          if (holding.changeType && changeTypeCounts[holding.changeType] !== undefined) {
            changeTypeCounts[holding.changeType]++;
          }
        });
      }
    });

    // Get top 10 filers by portfolio value
    const topFilers = filers
      .filter((f) => f.latestActivity?.currentMarketValue)
      .sort((a, b) => {
        const aValue = a.latestActivity?.currentMarketValue || 0;
        const bValue = b.latestActivity?.currentMarketValue || 0;
        return bValue - aValue;
      })
      .slice(0, 10)
      .map((f) => ({
        filerName: f.filerName,
        cik: f.cik,
        quarter: f.latestActivity?.lastReportedQuarter,
        marketValue: f.latestActivity?.currentMarketValue,
        holdingsCount: f.latestActivity?.currentHoldingsCount,
      }));

    logger.info("✅ Statistics calculated successfully");

    return {
      totalFilers,
      totalMarketValue,
      totalHoldings,
      changeTypeBreakdown: Object.entries(changeTypeCounts).map(([type, count]) => ({
        type,
        count,
      })),
      topFilers,
    };
  } catch (err: any) {
    logger.error(`Error calculating statistics: ${err.message}`);
    throw err;
  }
}
