import { z } from "zod";

export const maPartySchema = z.object({
  name: z.string().nullable().optional().describe("Company or individual name (null if unknown)"),
  nameVariants: z.array(z.string()).optional().describe("Alternative company names"),
  industry: z.string().nullable().optional().describe("Industry sector"),
  location: z.string().nullable().optional().describe("City, State or Headquarters location"),
  ticker: z.string().nullable().optional().describe("Stock ticker if public company"),
  description: z.string().nullable().optional().describe("Brief company description"),
  companyType: z
    .enum([
      "public",
      "private",
      "private-equity-backed",
      "venture-backed",
      "family-owned",
      "startup",
    ])
    .nullable()
    .optional()
    .describe("Type of company"),
  companySize: z
    .enum(["large-cap", "mid-cap", "small-cap", "micro-cap", "startup"])
    .nullable()
    .optional()
    .describe("Company size classification"),
  revenue: z.string().nullable().optional().describe("Annual revenue if mentioned"),
  employees: z.string().nullable().optional().describe("Number of employees"),
  fundingStage: z.string().nullable().optional().describe("Funding stage for startups"),
  marketCap: z.string().nullable().optional().describe("Market capitalization if public"),
});

export const maKeyPersonSchema = z.object({
  name: z.string().describe("Full name of person"),
  role: z.string().nullable().optional().describe("CEO, Founder, CFO, etc."),
  company: z.string().nullable().optional().describe("Which company they represent"),
  action: z
    .string()
    .nullable()
    .optional()
    .describe("What they did (e.g., 'sold company', 'led acquisition')"),
  background: z.string().nullable().optional().describe("Brief background or notable achievements"),
});

export const maFinancialDetailsSchema = z.object({
  totalValue: z.string().nullable().optional().describe("Total transaction value"),
  cashComponent: z.string().nullable().optional().describe("Cash portion of deal"),
  stockComponent: z.string().nullable().optional().describe("Stock/equity portion"),
  earnoutStructure: z
    .string()
    .nullable()
    .optional()
    .describe("Earnout or performance-based payments"),
  paymentTerms: z.string().nullable().optional().describe("Payment structure and timing"),
  valuationMultiple: z
    .string()
    .nullable()
    .optional()
    .describe("Valuation multiple (e.g., '5x revenue')"),
  debtAssumed: z.string().nullable().optional().describe("Debt taken on by acquirer"),
  workingCapital: z.string().nullable().optional().describe("Working capital adjustments"),
  targetRevenue: z.string().nullable().optional().describe("Target company's revenue"),
  targetEBITDA: z.string().nullable().optional().describe("Target company's EBITDA"),
});

export const maInsightsSchema = z.object({
  summary: z.string().nullable().optional().describe("Executive summary of the transaction"),
  keyInsights: z.array(z.string()).optional().describe("Key insights and takeaways"),
  strategicRationale: z.string().nullable().optional().describe("Why the deal was done"),
  marketImplications: z.string().nullable().optional().describe("Impact on the market/industry"),
  integrationConsiderations: z
    .string()
    .nullable()
    .optional()
    .describe("Integration challenges or plans"),
  keyRisks: z.string().nullable().optional().describe("Potential risks or concerns"),
});

export const maEventSchema = z.object({
  eventType: z
    .enum([
      "acquisition",
      "merger",
      "exit",
      "dissolution",
      "articles_of_merger",
      "asset_sale",
      "majority_stake_sale",
      "investment",
    ])
    .describe("Type of M&A event"),
  status: z.enum(["announced", "completed", "pending", "terminated"]).describe("Current status"),
  announcementDate: z
    .string()
    .nullable()
    .optional()
    .describe("Date announced (YYYY-MM-DD format only, or null if not stated)"),
  effectiveDate: z.string().nullable().optional().describe("Date effective (YYYY-MM-DD or null)"),
  dealValue: z
    .string()
    .nullable()
    .optional()
    .transform((val) => val ?? "undisclosed")
    .describe("Deal value like '$50M' or 'undisclosed'"),
  dealType: z
    .enum(["cash", "stock", "mixed", "undisclosed"])
    .nullable()
    .optional()
    .describe("Type of deal structure: cash, stock, mixed, or undisclosed"),
  dealStructure: z.string().nullable().optional().describe("Cash, stock, earnout structure"),
  insightSummary: z
    .string()
    .nullable()
    .optional()
    .describe("Crisp 1-sentence summary of the overall deal without leaving key details"),

  financialDetails: maFinancialDetailsSchema.nullable().optional(),

  insights: maInsightsSchema.nullable().optional(),

  keyPeople: z.array(maKeyPersonSchema).optional().describe("Key people involved in transaction"),

  targetCompany: maPartySchema.describe("Company being acquired/merged"),
  acquiringCompany: maPartySchema.nullable().optional().describe("Company doing the acquiring"),

  stateFiling: z
    .object({
      state: z.string().nullable().optional(),
      filingType: z.string().nullable().optional(),
      filingDate: z.string().nullable().optional(),
      filingNumber: z.string().nullable().optional(),
      filingUrl: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),

  sources: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().nullable().optional(),
        publishDate: z.string().nullable().optional(),
        sourceType: z.string().nullable().optional(),
      }),
    )
    .describe("Source URLs"),
});

export const maEventsArraySchema = z.array(maEventSchema);

export type MAScraperType =
  | "acquisitions"
  | "state-filings"
  | "founder-exits"
  | "sec-filings"
  | "comprehensive"
  | "custom";

export type MAScraperOptions = {
  type: MAScraperType;
  limit?: number;
  days?: number;
  country?: string;
  timeframe?: string;
  states?: string[];
  year?: number;
  query?: string;
};

export type MAScrapingResult = {
  success: boolean;
  successful: number;
  alreadyExists: number;
  failed: number;
  signalIds: string[];
  error?: string;
};

export type MAParty = z.infer<typeof maPartySchema>;
export type MAKeyPerson = z.infer<typeof maKeyPersonSchema>;
export type MAFinancialDetails = z.infer<typeof maFinancialDetailsSchema>;
export type MAInsights = z.infer<typeof maInsightsSchema>;
export type MAEvent = z.infer<typeof maEventSchema>;
export type MAEventsArray = z.infer<typeof maEventsArraySchema>;
