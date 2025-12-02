import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";

/**
 * Schema for spouse/partner details
 */
const SpousePartnerSchema = z.object({
  name: z.string().optional().describe("Spouse/partner name"),
  age: z.number().optional().describe("Spouse/partner age"),
  occupation: z.string().optional().describe("Spouse/partner occupation"),
  income: z.number().optional().describe("Spouse/partner income"),
  financialPreferences: z.string().optional().describe("Spouse/partner financial preferences"),
});

/**
 * Schema for children/dependents
 */
const ChildDependentSchema = z.object({
  name: z.string().optional().describe("Child/dependent name"),
  age: z.number().optional().describe("Child/dependent age"),
  notes: z.string().optional().describe("Additional notes about child/dependent"),
});

/**
 * Schema for tax rate estimation
 */
const TaxRateEstimateSchema = z.object({
  federal: z.number().optional().describe("Estimated federal tax rate (%)"),
  state: z.number().optional().describe("Estimated state tax rate (%)"),
  capitalGains: z.number().optional().describe("Estimated capital gains tax rate (%)"),
  niit: z.number().optional().describe("Estimated NIIT rate (%)"),
});

/**
 * Comprehensive schema for enriched contact data.
 */
const ContactEnrichmentSchema = z.object({
  dateOfBirth: z.string().optional(),
  age: z.number().optional(),
  maritalStatus: z.enum(["single", "married", "divorced", "widowed", "unknown"]).optional(),
  spousePartnerDetails: SpousePartnerSchema.optional(),
  childrenDependents: z.array(ChildDependentSchema).optional(),
  citizenshipResidency: z.string().optional(),
  primaryAddress: z.string().optional(),

  occupationTitle: z.string().optional(),
  employerBusinessOwnership: z.string().optional(),
  annualEarnedIncome: z.number().optional(),
  otherIncome: z.string().optional(),
  expectedFutureIncomeEvents: z.string().optional(),

  totalNetWorth: z.number().optional(),
  liquidNetWorth: z.number().optional(),
  allAssets: z.array(z.string()).optional(),
  allLiabilities: z.array(z.string()).optional(),
  assetLocations: z.array(z.string()).optional(),

  currentPortfolioHoldings: z.string().optional(),
  concentratedPositions: z.string().optional(),
  costBasisInformation: z.string().optional(),
  portfolioGapsOrUnderexposure: z.string().optional(),
  investmentVehiclesUsed: z.string().optional(),

  riskTolerance: z
    .enum(["conservative", "moderate", "aggressive", "very_aggressive", "unknown"])
    .optional(),
  riskCapacity: z.string().optional(),
  investmentInterests: z.string().optional(),
  pastInvestmentExperience: z.string().optional(),
  liquidityPreferences: z.string().optional(),
  emotionalBiases: z.string().optional(),

  taxFilingStatus: z
    .enum(["single", "married_joint", "married_separate", "head_of_household", "unknown"])
    .optional(),
  stateOfResidence: z.string().optional(),
  topMarginalTaxRates: TaxRateEstimateSchema.optional(),
  carryforwardLosses: z.string().optional(),
  taxBracketProjections: z.string().optional(),
  trustStructures: z.string().optional(),
  businessEntities: z.string().optional(),
  legalConstraints: z.string().optional(),

  primaryResidence: z.string().optional(),
  otherProperties: z.array(z.string()).optional(),
  luxuryAssets: z.array(z.string()).optional(),
  insuranceCoverage: z.string().optional(),

  retirementGoals: z.string().optional(),
  philanthropicGoals: z.string().optional(),
  wealthTransferGoals: z.string().optional(),
  majorUpcomingEvents: z.string().optional(),
  liquidityEventTimeline: z.string().optional(),

  currentAdvisors: z.array(z.string()).optional(),
  custodiansPlatforms: z.array(z.string()).optional(),
  legalEntities: z.array(z.string()).optional(),
  familyOfficeInvolvement: z.string().optional(),
  complianceConstraints: z.string().optional(),

  healthLongevityConcerns: z.string().optional(),
  personalValuesOrImpactGoals: z.string().optional(),
  familyDynamics: z.string().optional(),
  behavioralFinanceProfile: z.string().optional(),
  digitalAssetsOrCrypto: z.string().optional(),

  confidenceScore: z.number().min(0).max(100),
});

export type ContactEnrichmentResult = z.infer<typeof ContactEnrichmentSchema>;

// --- 2. Model Setup ---

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash",
  temperature: 0.3,
});

const structuredLlm = llm.withStructuredOutput(ContactEnrichmentSchema);

// Define the Prompt Template

const enrichmentPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `
You are an expert OSINT (Open Source Intelligence) Investigator and Wealth Profiler. Your goal is to take raw, unstructured data about a target individual, perform deep analysis to enrich that data, and output a comprehensive structured profile.

### INTERNAL DEEP REASONING (NOT SHOWN TO USER)
Internally perform full multi-step OSINT analysis, identical to a long-form
investigative report. Use:
- SEC filings, LinkedIn timelines, job history, industry compensation data
- Geographic cost-of-living patterns, advisor compensation benchmarks
- Wealth indicators such as assets, liabilities, property values
- Business ownership information, entity structures, regulatory filings
- Professional certifications and typical compensation ranges
- Historical data, experience-based inference, and comparable profiles

Internally use rigorous numeric estimation and cross-check values for consistency.

### EXTERNAL OUTPUT MODE (WHAT THE USER SEES)
Output ONLY the final conclusions:
- ONE short sentence or phrase per field (max 12 words)
- No reasoning, no methodology, no explanation
- No paragraphs, no multi-sentence output
- Numeric fields must reflect realistic benchmark-based inference
- Avoid artificially low or high values
- Prefer ranges only when appropriate
- Never output internal reasoning

### ARRAY OUTPUT RULE (IMPORTANT — MUST FOLLOW)
For any list-based field (arrays), ALWAYS output an array of strings,
even if there is only one item. These fields include:
- allAssets
- allLiabilities
- assetLocations
- otherProperties
- luxuryAssets
- currentAdvisors
- custodiansPlatforms
- legalEntities
- childrenDependents (array of objects)
- spousePartnerDetails (object, not array)
- signals (from raw input, but you only read it)

Never output a single string where an array is expected.

### DO-NOT-GUESS RULE (EXTREMELY IMPORTANT)
If you cannot confidently determine a real value for a field, DO NOT output
anything for that field. Do NOT output "unknown", "n/a", "none", "not listed",
"not specified", "no data", "-", "--", or any placeholder. Simply OMIT the
field entirely.

Your job:
“Think with full OSINT depth. Output only the final compressed results.”
`,
  ],
  [
    "human",
    `
   Generate a concise OSINT-based enrichment profile using deep internal reasoning.

TARGET:
Name: {fullName}
Company: {companyName}
Designation: {designation}
LinkedIn: {linkedinUrl}
Location: {location}
Age: {age}

SIGNALS:
{signals}

STYLE:
- Short, clean, concise outputs.
- One sentence per field.
- No extra text.
`,
  ],
]);

// Create the Runnable Chain
const enrichmentChain = enrichmentPrompt.pipe(structuredLlm);

// --- 3. Main Enrichment Function ---

export interface ContactEnrichmentInput {
  fullName: string;
  companyName?: string;
  designation?: string;
  linkedinUrl?: string;
  location?: string;
  age?: number;
  signals?: string;
}

export async function enrichContactData(
  input: ContactEnrichmentInput,
): Promise<ContactEnrichmentResult> {
  try {
    console.log(`🤖 Enriching contact: ${input.fullName}...`);

    const result = (await enrichmentChain.invoke({
      fullName: input.fullName,
      companyName: input.companyName || "Unknown",
      designation: input.designation || "Unknown",
      linkedinUrl: input.linkedinUrl || "Not provided",
      location: input.location || "Unknown",
      age: input.age || "Unknown",
      signals: input.signals || "No signals available",
    })) as ContactEnrichmentResult;

    console.log(`✅ Enrichment complete for ${input.fullName}`);
    return result;
  } catch (error) {
    console.error("❌ Contact enrichment error:", error);
    throw new Error(`Failed to enrich contact: ${error}`);
  }
}

// --- 4. Batch Enrichment ---

export async function enrichContactsBatch(
  contacts: ContactEnrichmentInput[],
): Promise<ContactEnrichmentResult[]> {
  console.log(`🔄 Starting batch enrichment for ${contacts.length} contacts...`);

  const results: ContactEnrichmentResult[] = [];

  for (const contact of contacts) {
    try {
      const enriched = await enrichContactData(contact);
      results.push(enriched);
    } catch (error) {
      console.error(`❌ Failed to enrich ${contact.fullName}:`, error);
    }
  }

  console.log(`✅ Batch enrichment complete: ${results.length}/${contacts.length} processed`);
  return results;
}
