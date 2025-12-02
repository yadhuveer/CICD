import { ChatAnthropic } from "@langchain/anthropic";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

// SIMPLIFIED SYSTEM PROMPT FOR TAX PROFESSIONAL ANALYSIS
const TAX_PROFESSIONAL_SYSTEM_PROMPT = `
You are Longwall's Advisor Network Agent.

Analyze tax professionals/advisors as REFERRAL SOURCES (not wealth clients).

SCORING (0-100):
- Serves UHNW/business owners/cross-border clients: +40
- Big 4 partner or boutique wealth firm: +30
- Cross-border/M&A/estate planning specialist: +30

OUTPUT RULES:
- Use numbered points (1., 2., 3.) or clear paragraphs
- Be concise and actionable
- Focus on their CLIENTS' needs, not the advisor's personal wealth
- Each point should be on a new line for clarity

OUTPUT FORMAT:
{{
  "informativeInsight": "1. Brief summary\\n2. Key specialization\\n3. Client profile",
  "actionableInsight": "1. Why their clients need Longwall\\n2. Partnership approach\\n3. Next steps",
  "shouldReachOut": "Yes/No/Maybe",
  "reachOutReason": "Brief reason",
  "advisorLeadScore": 0,
  "advisorType": {{
    "category": "",
    "specialization": ""
  }}
}}
`;

// ZOD SCHEMA
const advisorTypeSchema = z.object({
  category: z.string().describe("Category (e.g., 'Tax Advisor', 'CPA Firm Partner')"),
  specialization: z.string().describe("Specialization (e.g., 'Cross-Border Tax', 'M&A Advisory')"),
});

export const taxProfessionalInsightSchema = z.object({
  informativeInsight: z
    .string()
    .describe("Brief summary of who they are and what they do (2-3 bullets)"),
  actionableInsight: z
    .string()
    .describe("Why their clients need Longwall + partnership approach (bullet points)"),
  shouldReachOut: z.enum(["Yes", "No", "Maybe"]).describe("Whether to reach out"),
  reachOutReason: z.string().describe("Brief reason for reach out decision"),
  advisorLeadScore: z.number().min(0).max(100).describe("Advisor lead score 0-100"),
  advisorType: advisorTypeSchema,
});

const taxProfessionalInsightParser = StructuredOutputParser.fromZodSchema(
  taxProfessionalInsightSchema,
);

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  temperature: 0,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

const taxProfessionalInsightPrompt = ChatPromptTemplate.fromTemplate(`
${TAX_PROFESSIONAL_SYSTEM_PROMPT}

### PROFESSIONAL DATA
{professionalData}

### OUTPUT FORMAT
{format_instructions}

Be concise. Use numbered points (1., 2., 3.) on separate lines. Focus on referral value.
`);

/**
 * Analyzes a tax professional / advisor from ContactOut data
 * @param professionalData - The ContactOut API response or LinkedIn data (as string)
 * @returns Structured advisor insight analysis
 */
export async function analyzeTaxProfessionalForInsights(
  professionalData: string,
): Promise<z.infer<typeof taxProfessionalInsightSchema>> {
  try {
    console.log(`🔍 Analyzing tax professional for advisor insights...`);

    const prompt = await taxProfessionalInsightPrompt.format({
      professionalData,
      format_instructions: taxProfessionalInsightParser.getFormatInstructions(),
    });

    const response = await llm.invoke(prompt);
    const content =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((c) => (typeof c === "string" ? c : (c.text ?? ""))).join("\n")
          : "";

    const result = await taxProfessionalInsightParser.parse(content);

    console.log(`✅ Tax professional insight analysis complete`);
    console.log(`   📊 Advisor Lead Score: ${result.advisorLeadScore}`);
    console.log(`   🤝 Should Reach Out: ${result.shouldReachOut}`);

    return result;
  } catch (error: any) {
    console.error(`❌ Error analyzing tax professional:`, error.message);
    throw new Error(`Failed to analyze tax professional: ${error.message}`);
  }
}

/**
 * Batch analyzes multiple tax professionals
 * @param professionalDataArray - Array of ContactOut responses or LinkedIn data
 * @returns Array of advisor insight analysis results
 */
export async function analyzeTaxProfessionalsBatch(
  professionalDataArray: string[],
): Promise<z.infer<typeof taxProfessionalInsightSchema>[]> {
  console.log(`🔍 Batch analyzing ${professionalDataArray.length} tax professionals...`);

  const results = await Promise.all(
    professionalDataArray.map((data) => analyzeTaxProfessionalForInsights(data)),
  );

  console.log(`✅ Batch tax professional analysis complete`);
  return results;
}

export type TaxProfessionalInsightResult = z.infer<typeof taxProfessionalInsightSchema>;
export type AdvisorType = z.infer<typeof advisorTypeSchema>;
