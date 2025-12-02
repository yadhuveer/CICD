import { InstitutionalFiler } from "../../models/13FInstitutes.model.js";
import {
  generateForm13FOverallInsights,
  prepareFilerDataForInsights,
} from "../../tools/AiAgents/enritchmentAgent/form13FOverallInsights.agent.js";
import logger from "../../utils/logger.js";

/**
 * Generate insight for a specific filer
 * Analyzes all quarters and generates ONE insight for the entire filer
 * @param cik - The CIK of the institutional filer
 * @param force - If true, regenerate insight even if it already exists
 */
export async function generateInsightsForFiler(cik: string, force: boolean = false) {
  try {
    logger.info(`🔍 Generating insight for filer CIK: ${cik}...`);

    const filer = await InstitutionalFiler.findOne({ cik });

    if (!filer) {
      throw new Error(`Filer with CIK ${cik} not found`);
    }

    // Check if insight already exists
    if (filer.overallInsight && !force) {
      logger.info(`⏭️  Filer already has insight. Skipping.`);
      return {
        cik: filer.cik,
        filerName: filer.filerName,
        insight: filer.overallInsight,
        generated: false,
      };
    }

    logger.info(`Found filer: ${filer.filerName} with ${filer.quarterlyReports.length} quarters`);

    // Prepare filer data (now async - fetches holdings from separate collection)
    const filerData = await prepareFilerDataForInsights(filer);

    // Generate insight
    const insightResult = await generateForm13FOverallInsights(filerData);

    // Update filer with insight
    filer.overallInsight = insightResult.insight;
    await filer.save();

    logger.info(`✅ Insight generated and saved for ${filer.filerName}`);
    logger.info(`   💡 ${insightResult.insight}`);

    return {
      cik: filer.cik,
      filerName: filer.filerName,
      insight: insightResult.insight,
      generated: true,
    };
  } catch (error: any) {
    logger.error(`❌ Error generating insight for filer: ${error.message}`);
    throw error;
  }
}

/**
 * Generate insights for all filers that don't have insights yet
 * @param force - If true, regenerate insights even if they already exist
 * @param limit - Maximum number of filers to process (optional)
 */
export async function generateInsightsForAllFilers(force: boolean = false, limit?: number) {
  try {
    logger.info(`🔍 Finding filers that need insights...`);

    let query: any = {};
    if (!force) {
      query = {
        $or: [{ overallInsight: { $exists: false } }, { overallInsight: null }],
      };
    }

    const filers = await InstitutionalFiler.find(query)
      .select("cik filerName")
      .limit(limit || 0)
      .lean();

    logger.info(`Found ${filers.length} filers to process`);

    const results: any[] = [];
    for (const filer of filers) {
      try {
        const result = await generateInsightsForFiler(filer.cik, force);
        results.push(result);
      } catch (error: any) {
        logger.error(`❌ Error processing filer ${filer.cik}: ${error.message}`);
        results.push({
          cik: filer.cik,
          filerName: filer.filerName,
          error: error.message,
          generated: false,
        });
      }
    }

    logger.info(
      `✅ Batch complete: ${results.filter((r: any) => r.generated).length} insights generated`,
    );
    return results;
  } catch (error: any) {
    logger.error(`❌ Error in generateInsightsForAllFilers: ${error.message}`);
    throw error;
  }
}

/**
 * Check insights status for all filers
 */
export async function getInsightsStatus() {
  try {
    const total = await InstitutionalFiler.countDocuments();
    const withInsights = await InstitutionalFiler.countDocuments({
      overallInsight: { $exists: true, $ne: null },
    });

    return {
      totalFilers: total,
      filersWithInsights: withInsights,
      filersWithoutInsights: total - withInsights,
    };
  } catch (error: any) {
    logger.error(`❌ Error in getInsightsStatus: ${error.message}`);
    throw error;
  }
}
