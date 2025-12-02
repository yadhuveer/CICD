import { ChatAnthropic } from "@langchain/anthropic";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { Holding } from "../../../models/13FHoldings.model.js";

// SYSTEM PROMPT FOR FORM 13F OVERALL INSIGHTS
const FORM_13F_INSIGHTS_SYSTEM_PROMPT = `
You are Longwall's Form 13F Institutional Filer Intelligence Agent.

Your task: analyze ALL quarterly reports for an institutional filer and produce ONE CRITICAL INSIGHT about their overall investment strategy and portfolio.

GUIDELINES:
1. Look at trends across ALL quarters
2. Identify the single most important pattern about this institutional investor
3. Focus on:
   - Overall investment strategy and philosophy
   - Key sector concentrations or rotations over time
   - Portfolio management approach (active vs passive, concentrated vs diversified)
   - Notable patterns in their buying/selling behavior
4. Be specific and actionable
5. Keep it concise (2-3 sentences maximum)

OUTPUT FORMAT (MANDATORY JSON):
{{
  "insight": "One critical insight about this institutional filer's investment approach and portfolio strategy"
}}

Always output valid JSON with a single insight string.
`;

// ==========================================================
// ZOD SCHEMA FOR STRUCTURED OUTPUT
// ==========================================================

/**
 * Schema for Form 13F overall insight
 */
export const form13FInsightsSchema = z.object({
  insight: z
    .string()
    .describe("One critical insight about the institutional filer's investment approach"),
});

// Create parser
const form13FInsightsParser = StructuredOutputParser.fromZodSchema(form13FInsightsSchema);

// ==========================================================
// LLM CONFIGURATION
// ==========================================================

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  temperature: 0,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

// ==========================================================
// FORM 13F INSIGHTS PROMPT
// ==========================================================

const form13FInsightsPrompt = ChatPromptTemplate.fromTemplate(`
${FORM_13F_INSIGHTS_SYSTEM_PROMPT}

---

### INSTITUTIONAL FILER DATA (ALL QUARTERS)
{filerData}

---

### OUTPUT FORMAT
{format_instructions}

CRITICAL:
- Analyze all quarterly reports together
- Identify the single most critical insight
- Be specific and actionable
- Output valid JSON only
`);

// ==========================================================
// FORM 13F INSIGHTS FUNCTION
// ==========================================================

/**
 * Analyzes all quarterly reports for a filer and generates ONE critical insight
 * @param filerData - All filer data including all quarters (can be JSON stringified or plain text summary)
 * @returns Single critical insight
 */
export async function generateForm13FOverallInsights(
  filerData: string,
): Promise<z.infer<typeof form13FInsightsSchema>> {
  try {
    console.log(`🔍 Generating overall insight for institutional filer...`);

    const prompt = await form13FInsightsPrompt.format({
      filerData,
      format_instructions: form13FInsightsParser.getFormatInstructions(),
    });

    const response = await llm.invoke(prompt);
    const content =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((c) => (typeof c === "string" ? c : (c.text ?? ""))).join("\n")
          : "";

    const result = await form13FInsightsParser.parse(content);

    console.log(`✅ Overall insight generated successfully`);
    console.log(
      `   💡 ${result.insight.substring(0, 100)}${result.insight.length > 100 ? "..." : ""}`,
    );

    return result;
  } catch (error: any) {
    console.error(`❌ Error generating Form 13F insight:`, error.message);
    throw new Error(`Failed to generate insight: ${error.message}`);
  }
}

/**
 * Helper function to prepare filer data for insights generation
 * Takes a filer object with all quarterly reports and formats it as a readable summary
 * @param filer - The filer object from the database with all quarterly reports
 * @returns Formatted string summary for the AI agent
 */
export async function prepareFilerDataForInsights(filer: any): Promise<string> {
  const quarterlyReports = filer.quarterlyReports || [];

  // Get latest quarter summary
  const latestReport = quarterlyReports[quarterlyReports.length - 1];
  if (!latestReport) {
    return `INSTITUTIONAL FILER: ${filer.filerName} (${filer.cik})\nNo quarterly reports available.`;
  }

  const summary = latestReport.summary || {};
  const sectorBreakdown = latestReport.sectorBreakdown || [];

  // Analyze trends across quarters
  const quarterSummaries = quarterlyReports
    .slice(-4)
    .reverse()
    .map((qr: any) => ({
      quarter: qr.quarter,
      totalValue: qr.summary?.totalMarketValue || 0,
      holdingsCount: qr.summary?.totalHoldingsCount || 0,
      changes: qr.portfolioChanges,
    }));

  // Fetch top holdings from separate collection (grouped document)
  const quarterlyHoldings = await Holding.findOne({
    cik: filer.cik,
    quarter: latestReport.quarter,
  }).lean();

  const allHoldings = quarterlyHoldings?.holdings || [];
  const topHoldings = allHoldings
    .filter((h: any) => h.changeType !== "EXITED")
    .sort((a: any, b: any) => b.value - a.value)
    .slice(0, 10);

  return `
INSTITUTIONAL FILER OVERVIEW
============================
Filer Name: ${filer.filerName}
CIK: ${filer.cik}
Total Quarterly Reports: ${quarterlyReports.length}

LATEST QUARTER (${latestReport.quarter})
==========================================
Total Holdings: ${summary.totalHoldingsCount || 0}
Total Market Value: $${((summary.totalMarketValue || 0) / 1000000).toFixed(2)}M

SECTOR ALLOCATION (Latest Quarter)
==================================
${sectorBreakdown
  .slice(0, 5)
  .map((s: any) => `${s.sector}: ${s.percentage.toFixed(2)}% ($${(s.value / 1000000).toFixed(2)}M)`)
  .join("\n")}

QUARTERLY TREND (Last 4 Quarters)
==================================
${quarterSummaries
  .map(
    (q: any) =>
      `${q.quarter}: $${(q.totalValue / 1000000).toFixed(2)}M, ${q.holdingsCount} holdings | New: ${q.changes?.newPositions || 0}, Increased: ${q.changes?.increasedPositions || 0}, Decreased: ${q.changes?.decreasedPositions || 0}, Exited: ${q.changes?.exitedPositions || 0}`,
  )
  .join("\n")}

TOP HOLDINGS (Latest Quarter)
==============================
${topHoldings
  .map(
    (h: any, i: number) =>
      `${i + 1}. ${h.issuerName} (${h.ticker || h.cusip}): $${(h.value / 1000000).toFixed(2)}M (${h.percentOfPortfolio?.toFixed(2) || "N/A"}%)`,
  )
  .join("\n")}
`.trim();
}

// ==========================================================
// TYPE EXPORTS
// ==========================================================

export type Form13FInsightsResult = z.infer<typeof form13FInsightsSchema>;
