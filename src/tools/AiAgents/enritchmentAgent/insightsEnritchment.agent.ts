import { ChatAnthropic } from "@langchain/anthropic";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

// SYSTEM PROMPT
const LONGWALL_SYSTEM_PROMPT = `
You are Longwall's Private Wealth Signal Intelligence Agent.

Your task: analyze ANY scraped document (SEC filings, XML, JSON, text, news, county property data, corporate data, etc.) and produce:

1. INFORMATIVE INSIGHT — A factual description of what is happening. Use numbered points (1., 2., 3.) on separate lines for clarity.
2. ACTIONABLE INSIGHT (LONGWALL POV) — Why this matters: liquidity, tax windows, diversification, timing urgency. Use numbered points on separate lines.
3. SHOULD LONGWALL REACH OUT? — Yes/No/Maybe with reason.
4. CASH-IN-HAND LIKELIHOOD — High / Medium / Low.
5. NEED FOR LONGWALL SERVICES — Yes/No + reason.
6. LEAD SCORE — Numerical score (0–100) based on the scoring rubric.
7. SIGNAL TYPE — Category + source from Longwall taxonomy.
8. CONTEXT — stake changes, transaction amounts, vesting cycles, deal values, etc.

SCORING LOGIC (STRICT)
A. Liquidity Event Weight (0–40)
- Insider sale / option sale: 40
- M&A / business sale: 40
- Property sale: 35
- RSU/Option vest: 30
- S-1/S-3 offering: 25
- 10b5-1 plan sale cadence: 20
- No liquidity: 0

B. Cash in Hand Probability (0–30)
- High: 30
- Medium: 15
- Low: 5

C. Wealth Complexity (0–20)
- Foundation/990-PF: 20
- Multi-state property: 15
- Aircraft/vessel: 15
- Form D LP participation: 10
- Next-gen leadership: 10
- High-comp partner (law/PE/medical): 10
- None: 0

D. Strategic Value (0–10)
- Founder: 10
- Public company executive: 8
- 13D/13G investor: 5
- Non-exec: 2

Total score = A + B + C + D (max 100).

OUTPUT FORMAT (MANDATORY JSON):

{{
  "informativeInsight": "",
  "actionableInsight": "",
  "shouldReachOut": "",
  "reachOutReason": "",
  "cashInHandLikelihood": "",
  "needsLongwallServices": "",
  "needsReason": "",
  "leadScore": "",
  "signalType": {{
    "category": "",
    "source": ""
  }},
  "context": {{
    "stakeBefore": null,
    "stakeAfter": null,
    "transactionAmount": null,
    "transactionType": "",
    "additionalNotes": ""
  }}
}}

If information is missing, infer only when reasonable.
Always fill ALL fields.
`;

// ==========================================================
// ZOD SCHEMA FOR STRUCTURED OUTPUT
// ==========================================================

const signalTypeSchema = z.object({
  category: z.string().describe("Signal category from Longwall taxonomy"),
  source: z.string().describe("Signal source type"),
});

/**
 * Schema for complete insights analysis
 */
export const insightAnalysisSchema = z.object({
  informativeInsight: z.string().describe("Factual description of what is happening"),
  actionableInsight: z
    .string()
    .describe(
      "Why this matters from Longwall POV: liquidity, tax windows, diversification, timing urgency",
    ),
  shouldReachOut: z
    .enum(["Yes", "No", "Maybe"])
    .describe("Whether Longwall should reach out to this lead"),
  reachOutReason: z.string().describe("Reason for reach out recommendation"),
  cashInHandLikelihood: z
    .enum(["High", "Medium", "Low"])
    .describe("Likelihood of cash in hand from this event"),
  needsLongwallServices: z
    .enum(["Yes", "No"])
    .describe("Whether this lead needs Longwall services"),
  needsReason: z.string().describe("Reason for service need assessment"),
  leadScore: z.number().min(0).max(100).describe("Lead score 0-100 based on scoring rubric"),
  signalType: signalTypeSchema,
  //   context: contextSchema,
});

// Create parser
const insightAnalysisParser = StructuredOutputParser.fromZodSchema(insightAnalysisSchema);

// ==========================================================
// LLM CONFIGURATION
// ==========================================================

const llm = new ChatAnthropic({
  //   model: "claude-sonnet-4-5-20250929",
  model: "claude-haiku-4-5-20251001",
  temperature: 0,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

// ==========================================================
// INSIGHT ANALYSIS PROMPT
// ==========================================================

const insightAnalysisPrompt = ChatPromptTemplate.fromTemplate(`
${LONGWALL_SYSTEM_PROMPT}

---

### SCRAPED DOCUMENT TO ANALYZE
{scrapedDocument}

---

### OUTPUT FORMAT
{format_instructions}

CRITICAL:
- Analyze the document thoroughly
- Apply the scoring rubric strictly
- Fill ALL fields in the JSON output
- Be factual in informative insight
- Be strategic in actionable insight
- Output valid JSON only
`);

// ==========================================================
// INSIGHT ANALYSIS FUNCTION
// ==========================================================

/**
 * Analyzes a scraped document and generates insights for Longwall
 * @param scrapedDocument - The scraped document content (can be SEC filing, JSON, text, etc.)
 * @returns Structured insight analysis
 */
export async function analyzeDocumentForInsights(
  scrapedDocument: string,
): Promise<z.infer<typeof insightAnalysisSchema>> {
  try {
    console.log(`🔍 Analyzing scraped document for insights...`);

    const prompt = await insightAnalysisPrompt.format({
      scrapedDocument,
      format_instructions: insightAnalysisParser.getFormatInstructions(),
    });

    const response = await llm.invoke(prompt);
    const content =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((c) => (typeof c === "string" ? c : (c.text ?? ""))).join("\n")
          : "";

    const result = await insightAnalysisParser.parse(content);

    console.log(`✅ Insight analysis complete`);
    console.log(`   📊 Lead Score: ${result.leadScore}`);
    console.log(`   💰 Cash Likelihood: ${result.cashInHandLikelihood}`);
    console.log(`   📞 Should Reach Out: ${result.shouldReachOut}`);
    console.log(`   📁 Signal Type: ${result.signalType.category} (${result.signalType.source})`);

    return result;
  } catch (error: any) {
    console.error(`❌ Error analyzing document for insights:`, error.message);
    throw new Error(`Failed to analyze document: ${error.message}`);
  }
}

/**
 * Batch analyzes multiple scraped documents
 * @param scrapedDocuments - Array of scraped document contents
 * @returns Array of insight analysis results
 */

export async function analyzeDocumentsBatch(
  scrapedDocuments: string[],
): Promise<z.infer<typeof insightAnalysisSchema>[]> {
  console.log(`🔍 Batch analyzing ${scrapedDocuments.length} documents...`);

  const results = await Promise.all(scrapedDocuments.map((doc) => analyzeDocumentForInsights(doc)));

  console.log(`✅ Batch analysis complete`);
  return results;
}

// ==========================================================
// CONVENIENCE FUNCTIONS FOR SIMPLIFIED OUTPUT
// ==========================================================

/**
 * Gets just the insights (informative + actionable) from analysis
 * @param scrapedDocument - The scraped document to analyze
 * @returns Object with informative and actionable insights
 */
export async function getInsights(
  scrapedDocument: string,
): Promise<{ informative: string; actionable: string }> {
  const result = await analyzeDocumentForInsights(scrapedDocument);
  return {
    informative: result.informativeInsight,
    actionable: result.actionableInsight,
  };
}

/**
 * Gets just the signal type from analysis
 * @param scrapedDocument - The scraped document to analyze
 * @returns Signal type object
 */
export async function getSignalType(
  scrapedDocument: string,
): Promise<z.infer<typeof signalTypeSchema>> {
  const result = await analyzeDocumentForInsights(scrapedDocument);
  return result.signalType;
}

/**
 * Gets insights and signal type together
 * @param scrapedDocument - The scraped document to analyze
 * @returns Object with insights and signal type
 */
export async function getInsightsAndSignalType(scrapedDocument: string): Promise<{
  insight: { informative: string; actionable: string };
  signalType: z.infer<typeof signalTypeSchema>;
}> {
  const result = await analyzeDocumentForInsights(scrapedDocument);
  return {
    insight: {
      informative: result.informativeInsight,
      actionable: result.actionableInsight,
    },
    signalType: result.signalType,
  };
}

// ==========================================================
// TYPE EXPORTS
// ==========================================================

export type InsightAnalysisResult = z.infer<typeof insightAnalysisSchema>;
export type SignalType = z.infer<typeof signalTypeSchema>;
