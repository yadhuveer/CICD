import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

/*
 * CONTACT ENRICHMENT SCHEMA
 
 */

const spousePartnerSchema = z.object({
  name: z.string().nullable().describe("Spouse/partner name if available"),
  age: z.number().nullable().describe("Spouse/partner age if available"),
  occupation: z.string().nullable().describe("Spouse/partner occupation"),
  income: z.number().nullable().describe("Spouse/partner estimated income"),
  financialPreferences: z.string().nullable().describe("Financial preferences or attitudes"),
});

const childSchema = z.object({
  name: z.string().nullable().describe("Child name if available"),
  age: z.number().nullable().describe("Child age"),
  notes: z.string().nullable().describe("Additional notes about child"),
});

const taxRateSchema = z.object({
  federal: z.number().nullable().describe("Estimated federal tax rate"),
  state: z.number().nullable().describe("Estimated state tax rate"),
  capitalGains: z.number().nullable().describe("Estimated capital gains tax rate"),
  niit: z.number().nullable().describe("Net Investment Income Tax rate"),
});

const portfolioHoldingsSchema = z.object({
  publicEquities: z.string().nullable().describe("Public equity holdings"),
  privateCompanyStock: z.string().nullable().describe("Private company stock holdings"),
  realEstate: z.string().nullable().describe("Real estate holdings"),
  cashEquivalents: z.string().nullable().describe("Cash and equivalents"),
  alternativeInvestments: z.string().nullable().describe("Alternative investments"),
});

const enrichedContactDataSchema = z.object({
  // Personal Information
  fullName: z.string().describe("Full name of the contact"),
  dateOfBirth: z.string().nullable().describe("Date of birth if available (YYYY-MM-DD format)"),
  age: z.number().nullable().describe("Estimated age if available"),
  maritalStatus: z.string().nullable().describe("Marital status (Single, Married, Divorced, etc.)"),
  spousePartnerDetails: spousePartnerSchema.nullable(),
  childrenDependents: z.array(childSchema).describe("Children/dependents information"),
  citizenshipResidency: z.string().nullable().describe("Citizenship or residency status"),
  primaryAddress: z.string().nullable().describe("Primary residential address"),

  // Professional & Income Data
  occupationTitle: z.string().nullable().describe("Current occupation or title"),
  employerBusinessOwnership: z
    .string()
    .nullable()
    .describe("Employer or business ownership details"),
  annualEarnedIncome: z.number().describe("Estimated annual earned income"),
  otherIncome: z.string().nullable().describe("Other sources of income"),
  expectedFutureIncomeEvents: z
    .string()
    .nullable()
    .describe("Expected future income events (vesting, bonuses, etc.)"),

  // Net Worth & Balance Sheet
  totalNetWorth: z.number().describe("Estimated total net worth"),
  liquidNetWorth: z.number().nullable().describe("Estimated liquid net worth"),
  allAssets: z.array(z.string()).describe("List of all major assets"),
  allLiabilities: z.array(z.string()).describe("List of all major liabilities"),
  assetLocations: z.array(z.string()).describe("Where assets are held (institutions, custodians)"),

  // Portfolio Details
  currentPortfolioHoldings: portfolioHoldingsSchema.nullable(),
  concentratedPositions: z
    .string()
    .nullable()
    .describe("Concentrated positions (>10% of portfolio in single asset)"),
  costBasisInformation: z.string().nullable().describe("Cost basis information for major holdings"),
  portfolioGapsOrUnderexposure: z
    .string()
    .nullable()
    .describe("Portfolio gaps or areas of underexposure"),
  investmentVehiclesUsed: z
    .string()
    .nullable()
    .describe("Investment vehicles used (IRAs, 401k, trusts, etc.)"),

  // Behavioral & Investment Preferences
  riskTolerance: z
    .string()
    .nullable()
    .describe("Risk tolerance (Conservative, Moderate, Aggressive)"),
  riskCapacity: z.string().nullable().describe("Risk capacity based on financial position"),
  investmentInterests: z.string().nullable().describe("Investment interests or preferences"),
  pastInvestmentExperience: z.string().nullable().describe("Past investment experience"),
  liquidityPreferences: z.string().nullable().describe("Liquidity preferences and needs"),
  emotionalBiases: z.string().nullable().describe("Identified emotional biases in investing"),

  // Tax & Legal
  taxFilingStatus: z.string().nullable().describe("Tax filing status"),
  stateOfResidence: z.string().nullable().describe("State of residence for tax purposes"),
  topMarginalTaxRates: taxRateSchema.nullable(),
  carryforwardLosses: z.string().nullable().describe("Tax loss carryforwards if any"),
  taxBracketProjections: z.string().nullable().describe("Future tax bracket projections"),
  trustStructures: z.string().nullable().describe("Trust structures in place"),
  businessEntities: z.string().nullable().describe("Business entities owned or controlled"),
  legalConstraints: z.string().nullable().describe("Legal constraints or considerations"),

  // Real Estate & Lifestyle Assets
  primaryResidence: z.string().nullable().describe("Primary residence details"),
  otherProperties: z.array(z.string()).describe("Other properties owned"),
  luxuryAssets: z.array(z.string()).describe("Luxury assets (boats, planes, art, etc.)"),
  insuranceCoverage: z.string().nullable().describe("Insurance coverage details"),

  // Planning Horizons & Goals
  retirementGoals: z.string().nullable().describe("Retirement goals and timeline"),
  philanthropicGoals: z.string().nullable().describe("Philanthropic goals and interests"),
  wealthTransferGoals: z.string().nullable().describe("Wealth transfer and estate planning goals"),
  majorUpcomingEvents: z
    .string()
    .nullable()
    .describe("Major upcoming events (business sale, retirement, etc.)"),
  liquidityEventTimeline: z.string().nullable().describe("Timeline for liquidity events"),

  // Administrative & Advisor Relationships
  currentAdvisors: z.array(z.string()).describe("Current advisors (financial, legal, tax, etc.)"),
  custodiansPlatforms: z.array(z.string()).describe("Custodians and platforms used"),
  legalEntities: z.array(z.string()).describe("Legal entities associated with"),
  familyOfficeInvolvement: z.string().nullable().describe("Family office involvement if any"),
  complianceConstraints: z.string().nullable().describe("Compliance constraints"),

  // Optional but Highly Valuable Data
  healthLongevityConcerns: z.string().nullable().describe("Health or longevity concerns"),
  personalValuesOrImpactGoals: z.string().nullable().describe("Personal values or impact goals"),
  familyDynamics: z.string().nullable().describe("Family dynamics that may affect planning"),
  behavioralFinanceProfile: z.string().nullable().describe("Behavioral finance profile"),
  digitalAssetsOrCrypto: z
    .string()
    .nullable()
    .describe("Digital assets or cryptocurrency holdings"),

  // Confidence & Source
  confidenceScore: z
    .number()
    .min(0)
    .max(100)
    .describe("Confidence score for the enrichment (0-100)"),
  dataQuality: z.enum(["high", "medium", "low"]).describe("Overall quality of the enrichment data"),
  missingDataPoints: z.array(z.string()).describe("List of data points that could not be inferred"),
  enrichmentNotes: z.string().describe("Additional notes about the enrichment process"),
});

// Create parser
const enrichmentParser = StructuredOutputParser.fromZodSchema(enrichedContactDataSchema);

//LLM CONFIGURATION

const llm = new ChatOpenAI({
  model: "grok-3",
  temperature: 0.3,
  apiKey: process.env.GROK_API_KEY || process.env.XAI_API_KEY,
  configuration: {
    baseURL: "https://api.x.ai/v1",
  },
});

//ENRICHMENT PROMPT

const ENRICHMENT_SYSTEM_PROMPT = `
You are an expert financial data analyst specializing in high-net-worth individual profiling.

Your task is to analyze SEC filings, signal data, and contact information to create a comprehensive enriched profile of a contact.

INSTRUCTIONS:
1. Carefully analyze ALL provided data (contact info, signals, filing links, and filing metadata)
2. Make REASONABLE inferences based on:
   - Transaction types and amounts (Form 4 sales suggest liquidity events)
   - Company positions (CEO, CFO, Director suggests high income)
   - Filing types (13D/G suggests activist investor profile)
   - M&A events (suggests concentrated wealth from business sale)
   - Property transactions (suggests real estate wealth)
   - Age and position (infer career stage and wealth accumulation)
3. Be CONSERVATIVE with numbers - provide ranges when exact figures aren't available
4. Mark confidence levels accurately - don't overstate certainty
5. Fill ALL fields - use null only when absolutely no inference is possible
6. In missingDataPoints, list specific items you couldn't determine
7. Provide actionable insights in enrichmentNotes

INFERENCE GUIDELINES:
- C-Suite executives at public companies: $500K-$5M annual income typical
- Directors: $100K-$500K annual income typical
- Form 4 sales >$1M suggest liquid net worth >$5M
- 13D/G filers typically have net worth >$50M
- M&A sellers: estimate based on stake percentage � deal value
- Real estate >$5M suggests total net worth >$20M
- Age 45-55 + exec role: likely in wealth accumulation phase
- Age 55-65 + exec role: likely planning for retirement/succession

OUTPUT FORMAT:
Return valid JSON matching the schema. Be thorough and precise.
`;

const enrichmentPrompt = ChatPromptTemplate.fromTemplate(`
${ENRICHMENT_SYSTEM_PROMPT}

---

### CONTACT INFORMATION
{contactData}

---

### LINKED SIGNALS
{signalsData}

---

### FILING LINKS AND METADATA
{filingMetadata}

---

### OUTPUT FORMAT
{format_instructions}

CRITICAL:
- Analyze all data carefully
- Make reasonable inferences based on the guidelines
- Fill ALL fields in the JSON output
- Be specific in your estimates and ranges
- Provide detailed enrichmentNotes explaining your reasoning
- List all missing data points you couldn't infer
- Output valid JSON only
`);

/**
 * =====================================
 * ENRICHMENT FUNCTION
 * =====================================
 */

export interface ContactEnrichmentInput {
  contactId: string;
  fullName: string;
  emailAddress?: {
    personal?: string[];
    business?: string[];
  };
  phoneNumber?: {
    personal?: string[];
    business?: string[];
  };
  linkedinUrl?: string;
  companyName?: string;
  dateOfBirth?: Date;
  age?: number;
  designation?: string;
  location?: string;
  signals: Array<{
    signalId: string;
    signalType: string;
    filingType: string;
    filingLink?: string;
    filingDate?: Date;
    insights?: string;
    fullName?: string;
    designation?: string;
    companyName?: string;
    form4Data?: any;
    form13Data?: any;
    form8kData?: any;
    maEventData?: any;
    jobPostingData?: any;
    dafContributionData?: any;
    nextGenData?: any;
    k1IncomeData?: any;
  }>;
}

/**
 * Enriches contact data using signals and filing information
 * @param input - Contact and signals data
 * @returns Enriched contact data
 */
export async function enrichContactWithSignals(
  input: ContactEnrichmentInput,
): Promise<z.infer<typeof enrichedContactDataSchema>> {
  try {
    console.log(`=
 Enriching contact: ${input.fullName} (${input.contactId})`);
    console.log(`Analyzing ${input.signals.length} signals...`);

    // Prepare contact data summary
    const contactData = `
Name: ${input.fullName}
Email: ${JSON.stringify(input.emailAddress)}
Phone: ${JSON.stringify(input.phoneNumber)}
LinkedIn: ${input.linkedinUrl || "Not available"}
Company: ${input.companyName || "Not available"}
Date of Birth: ${input.dateOfBirth || "Not available"}
Age: ${input.age || "Not available"}
Designation: ${input.designation || "Not available"}
Location: ${input.location || "Not available"}
    `.trim();

    // Prepare signals data summary
    const signalsData = input.signals
      .map(
        (signal, idx) => `
Signal ${idx + 1}:
  - Signal Type: ${signal.signalType}
  - Filing Type: ${signal.filingType}
  - Filing Date: ${signal.filingDate || "Not available"}
  - Company: ${signal.companyName || "Not available"}
  - Designation: ${signal.designation || "Not available"}
  - Insights: ${signal.insights || "Not available"}
  - Form 4 Data: ${JSON.stringify(signal.form4Data) || "Not available"}
  - Form 13 Data: ${JSON.stringify(signal.form13Data) || "Not available"}
  - Form 8K Data: ${JSON.stringify(signal.form8kData) || "Not available"}
  - M&A Event Data: ${JSON.stringify(signal.maEventData) || "Not available"}
  - Job Posting Data: ${JSON.stringify(signal.jobPostingData) || "Not available"}
  - DAF Contribution Data: ${JSON.stringify(signal.dafContributionData) || "Not available"}
  - NextGen Data: ${JSON.stringify(signal.nextGenData) || "Not available"}
  - K1 Income Data: ${JSON.stringify(signal.k1IncomeData) || "Not available"}
    `,
      )
      .join("\n---\n");

    // Prepare filing metadata
    const filingMetadata = input.signals
      .map(
        (signal, idx) => `
Filing ${idx + 1}:
  - Link: ${signal.filingLink || "Not available"}
  - Date: ${signal.filingDate || "Not available"}
  - Type: ${signal.filingType}
    `,
      )
      .join("\n");

    // Format the prompt
    const prompt = await enrichmentPrompt.format({
      contactData,
      signalsData,
      filingMetadata,
      format_instructions: enrichmentParser.getFormatInstructions(),
    });

    // Invoke LLM
    console.log(`Calling Grok API for enrichment...`);
    const response = await llm.invoke(prompt);

    // Extract content
    const content =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .map((c: any) => (typeof c === "string" ? c : (c.text ?? "")))
              .join("\n")
          : "";

    // Parse result
    const result = await enrichmentParser.parse(content);

    console.log(`Enrichment complete for ${input.fullName}`);
    console.log(`Confidence Score: ${result.confidenceScore}%`);
    console.log(`Data Quality: ${result.dataQuality}`);
    console.log(`Estimated Net Worth: $${result.totalNetWorth.toLocaleString()}`);
    console.log(`Estimated Annual Income: $${result.annualEarnedIncome.toLocaleString()}`);

    return result;
  } catch (error: any) {
    console.error(`L Error enriching contact ${input.fullName}:`, error.message);
    throw new Error(`Failed to enrich contact: ${error.message}`);
  }
}

/**
 * Batch enriches multiple contacts
 * @param inputs - Array of contact enrichment inputs
 * @returns Array of enriched contact data
 */
export async function enrichContactsBatch(
  inputs: ContactEnrichmentInput[],
): Promise<z.infer<typeof enrichedContactDataSchema>[]> {
  console.log(`=
 Batch enriching ${inputs.length} contacts...`);

  const results = await Promise.all(inputs.map((input) => enrichContactWithSignals(input)));

  console.log(`Batch enrichment complete`);
  return results;
}

/**
 * =====================================
 * TYPE EXPORTS
 * =====================================
 */

export type EnrichedContactData = z.infer<typeof enrichedContactDataSchema>;
