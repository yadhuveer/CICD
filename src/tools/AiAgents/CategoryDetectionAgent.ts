/**
 * Category Detection Agent
 * Detects all M&A signal categories from news articles and filings
 *
 * Categories:
 * 1. State Filings (Articles of Merger, Dissolution, etc.)
 * 2. Press/News (acquisition announcements)
 * 3. Public Filings (SEC Form 8-K Item 2.01)
 * 4. Role Changes (CEO exits, founder transitions)
 * 5. Domain/Trademark (asset transfers)
 * 6. Nonprofit (990-PF filings, DAF donations)
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

/**
 * Enhanced schema to capture ALL M&A categories
 */
const categoryEventSchema = z.object({
  // Primary classification
  category: z
    .enum([
      "state-filing",
      "press-news",
      "public-filing",
      "role-change",
      "domain-trademark",
      "nonprofit",
    ])
    .describe("Primary category of this M&A signal"),

  eventType: z
    .enum([
      "acquisition",
      "merger",
      "exit",
      "dissolution",
      "articles_of_merger",
      "asset_sale",
      "majority_stake_sale",
      "ceo_transition",
      "founder_exit",
      "domain_transfer",
      "trademark_assignment",
      "daf_donation",
      "form_990pf",
    ])
    .describe("Specific event type"),

  status: z.enum(["announced", "completed", "pending", "filed", "terminated"]).describe("Status"),
  announcementDate: z.string().describe("Date announced (YYYY-MM-DD or null)"),
  effectiveDate: z.string().nullable().optional().describe("Date effective (YYYY-MM-DD or null)"),
  dealValue: z.string().optional().describe("Deal value or 'undisclosed'"),

  targetCompany: z.object({
    name: z.string().describe("Company name"),
    nameVariants: z.array(z.string()).optional(),
    location: z.string().nullable().optional(),
  }),

  acquiringCompany: z
    .object({
      name: z.string(),
      location: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),

  keyPeople: z
    .array(
      z.object({
        name: z.string(),
        role: z.string(),
        company: z.string(),
        action: z.string().nullable().optional(),
      }),
    )
    .optional(),

  stateFiling: z
    .object({
      state: z.string().optional(),
      filingType: z.string().optional(),
      filingNumber: z.string().optional(),
      filingDate: z.string().optional(),
    })
    .optional(),

  publicFiling: z
    .object({
      formType: z.string().optional(),
      accession: z.string().optional(),
      cik: z.string().optional(),
      item: z.string().optional(),
    })
    .optional(),

  assetTransfer: z
    .object({
      assetType: z.enum(["domain", "trademark", "property"]).optional(),
      assetName: z.string().optional(),
      transferDate: z.string().optional(),
    })
    .optional(),

  nonprofitDetails: z
    .object({
      foundationName: z.string().optional(),
      dafRecipient: z.string().optional(),
      donationAmount: z.string().optional(),
      filingType: z.string().optional(), // "990-PF", etc.
    })
    .optional(),

  sources: z
    .array(
      z.object({
        url: z.string(),
      }),
    )
    .describe("Source URLs"),

  summary: z.string().describe("Brief summary"),
});

const categoryEventsArraySchema = z.array(categoryEventSchema);
const parser = StructuredOutputParser.fromZodSchema(categoryEventsArraySchema);

/**
 * System prompt for category detection
 */
const systemPrompt = `You are an EXPERT M&A signal detection agent that identifies ALL types of M&A-related events.

Your job is to extract signals from 6 CATEGORIES:

1. **STATE FILINGS** - Corporate filings indicating M&A activity
   - Articles of Merger, Certificate of Merger, Plan of Merger
   - Articles of Dissolution, Certificate of Dissolution
   - Articles of Conversion, Certificate of Conversion
   - Change of Control, Entity Conversion
   - UCC-3 Termination, Release of Lien
   → category: "state-filing"

2. **PRESS/NEWS** - News articles and press releases
   - "Acquired by", "Acquisition completed"
   - "Merger agreement", "Sale of business"
   - "Company sold", "Strategic transaction"
   - "Private equity acquisition", "Buyout"
   - "Majority stake acquired"
   → category: "press-news"

3. **PUBLIC FILINGS** - SEC EDGAR filings
   - Form 8-K Item 2.01 (Completion of Acquisition)
   - Form 8-K Item 1.01 (Material Agreement)
   - Schedule 13D/G (Beneficial Ownership)
   - Merger Agreement, Purchase Agreement
   → category: "public-filing"

4. **ROLE CHANGES** - Executive transitions indicating M&A
   - "Founder exited", "CEO transition"
   - "Leadership change", "Board restructuring"
   - "Management buyout"
   - Founders/CEOs leaving after company sale
   → category: "role-change"

5. **DOMAIN/TRADEMARK** - Asset transfers indicating M&A
   - Domain name transfers (WHOIS changes)
   - Trademark assignments (USPTO)
   - Property divestitures
   - Asset sales
   → category: "domain-trademark"

6. **NONPROFIT** - Wealth transfers to foundations
   - Donation to DAF (Donor-Advised Fund)
   - Form 990-PF filings
   - Large charitable contributions (often post-exit)
   → category: "nonprofit"

EXTRACTION PHILOSOPHY:
- Extract EVERY signal, even if incomplete
- If you see a company name + M&A context → EXTRACT IT
- Missing fields → use null, but STILL create the event
- Be LIBERAL with extraction, CONSERVATIVE with details
- NEVER hallucinate - only extract what's explicitly stated

CRITICAL ACCURACY RULES:
1. **Buyer vs Seller**:
   - "A acquired by B" → targetCompany=A, acquiringCompany=B
   - "A acquires B" → targetCompany=B, acquiringCompany=A

2. **Dates**: YYYY-MM-DD format ONLY (e.g., "2025-11-10")
   - "recently" / "this week" / no date → null
   - NEVER use "unknown" or approximate dates

3. **Names**: Use exact names from source
   - Missing name → skip the event
   - Don't shorten or modify names

4. **Values**: Exact only
   - Not stated → "undisclosed"
   - NEVER estimate

EXAMPLES:

Text: "Delaware Articles of Merger filed for Acme Corp merging with BigCo"
→ category="state-filing", eventType="articles_of_merger", targetCompany.name="Acme Corp",
  stateFiling.state="Delaware", stateFiling.filingType="Articles of Merger"

Text: "TechStart acquired by Investor Group for $25M"
→ category="press-news", eventType="acquisition", targetCompany.name="TechStart",
  acquiringCompany.name="Investor Group", dealValue="$25M"

Text: "John Smith, CEO and Founder of SmallBiz, exits after company sale"
→ category="role-change", eventType="founder_exit",
  keyPeople=[{name:"John Smith", role:"CEO and Founder", company:"SmallBiz", action:"exits after company sale"}]

Return a JSON array of categorized M&A events.

{format_instructions}`;

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
});

const prompt = ChatPromptTemplate.fromMessages([
  ["system", systemPrompt],
  ["user", "{data}"],
]);

const chain = prompt.pipe(llm).pipe(parser);

/**
 * Parse content into categorized M&A events
 */
export async function detectCategoryEvents(content: string): Promise<any[]> {
  try {
    console.log("🔍 Category Detection Agent analyzing content...");
    console.log(`   Content size: ${content.length} characters`);

    const result = await chain.invoke({
      data: content,
      format_instructions: parser.getFormatInstructions(),
    });

    console.log(`✅ Detected ${result.length} M&A events across all categories`);

    const categoryCounts: Record<string, number> = {};
    result.forEach((event) => {
      categoryCounts[event.category] = (categoryCounts[event.category] || 0) + 1;
    });

    console.log("   Category breakdown:");
    Object.entries(categoryCounts).forEach(([category, count]) => {
      console.log(`     - ${category}: ${count}`);
    });

    return result;
  } catch (error: any) {
    console.error("❌ Error in category detection:", error.message);
    return [];
  }
}
