import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

/**
 * =========================================
 * AIRCRAFT ENRICHMENT SCHEMA
 * =========================================
 */

const aircraftEnrichmentSchema = z.object({
  // Signal Source Classification
  signalSource: z
    .enum(["Person", "Company"])
    .describe(
      'Classify as "Person" if individual name (John Smith, Smith Family Trust) or "Company" if business entity (ABC Aviation LLC, XYZ Corp, Airlines Inc)',
    ),

  // Executive Summary (1-2 sentences for main insights field)
  summary: z
    .string()
    .describe("1-2 sentence summary: WHO owns WHAT aircraft and WHERE they are located"),

  // Transaction Context (what this transaction means)
  transactionContext: z
    .string()
    .describe(
      "What this transaction represents: new purchase, ownership transfer, upgrade, business acquisition, etc. Keep brief.",
    ),

  // Estimated Aircraft Value
  estimatedValue: z
    .string()
    .describe(
      "Estimated market value range for this aircraft. Format: '$5M-$8M' or 'Unknown' if cannot estimate",
    ),

  // Business Context (likely use case)
  businessContext: z
    .string()
    .describe(
      "Likely use case: personal aviation, business travel, charter operations, flight training, etc. One sentence max.",
    ),

  // Aircraft Category Classification
  aircraftCategory: z
    .enum(["entry-level", "mid-tier", "luxury", "ultra-luxury"])
    .describe(
      "Aircraft tier: entry-level (<$1M), mid-tier ($1M-$10M), luxury ($10M-$50M), ultra-luxury ($50M+)",
    ),

  // Usage Inference
  usageCategory: z
    .enum(["personal", "business", "charter", "training"])
    .describe(
      "Inferred primary use: personal (individual owner, small aircraft), business (LLC/Corp, cabin aircraft), charter (commercial use), training (small, basic aircraft)",
    ),
});

const parser = StructuredOutputParser.fromZodSchema(aircraftEnrichmentSchema);

/**
 * =========================================
 * AI AGENT SYSTEM PROMPT
 * =========================================
 */

const systemPrompt = `You are an aircraft registration analyst. Analyze FAA aircraft records and provide concise context.

SIGNAL SOURCE CLASSIFICATION:
**Person**: Individual names ("John Smith"), family trusts ("Smith Family Trust"), personal structures
**Company**: Business entities ("ABC Aviation LLC", "XYZ Corp"), operational businesses

ANALYSIS TASKS:

1. **AIRCRAFT VALUE & CATEGORY**:
   Classify aircraft tier based on manufacturer, model, and year:
   - entry-level (<$1M): Cirrus, Beechcraft, small Cessna
   - mid-tier ($1M-$10M): Citation CJ series, Phenom
   - luxury ($10M-$50M): Citation Latitude/Longitude, Challenger, Falcon
   - ultra-luxury ($50M+): Gulfstream G550/G650/G700, Global 7500, BBJ, ACJ

2. **USAGE CATEGORY**:
   Infer primary use:
   - personal: Individual owner, small aircraft, recreational use
   - business: LLC/Corp, cabin aircraft, business travel
   - charter: Commercial operations, revenue generation
   - training: Flight schools, basic aircraft, instructional use

3. **TRANSACTION CONTEXT**:
   What this transaction represents:
   - New Registration → Recent purchase, new ownership
   - Ownership Transfer → Change of ownership, sale or estate transfer
   - Re-registration → Administrative update

4. **BUSINESS CONTEXT**:
   Brief assessment of likely use case based on aircraft type, ownership structure, and location.
   Examples:
   - "Personal business travel for entrepreneur"
   - "Corporate flight department for mid-sized company"
   - "Charter operations in Florida region"
   - "Private recreational aviation"

RULES:
- Only use data explicitly provided in FAA record
- Be conservative with estimates
- Keep summary to 1-2 sentences: WHO owns WHAT aircraft WHERE
- Format estimated value as range: "$5M-$8M" or "Unknown"

{format_instructions}`;

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.2,
});

const prompt = ChatPromptTemplate.fromMessages([
  ["system", systemPrompt],
  ["user", "{aircraftData}"],
]);

const chain = prompt.pipe(llm).pipe(parser);

/**
 * =========================================
 * ENRICHMENT FUNCTION
 * =========================================
 */

/**
 * Enrich aircraft ownership data with AI-generated insights
 * @param aircraftRecord - Raw FAA aircraft registration record
 * @returns Enriched insights for lead qualification
 */
export async function enrichAircraftOwnership(aircraftRecord: any): Promise<any> {
  try {
    console.log(
      `🤖 AI enriching aircraft ownership: ${aircraftRecord.manufacturer} ${aircraftRecord.model} (${aircraftRecord.ownerName})`,
    );

    // Format the data for AI analysis
    const formattedData = `
AIRCRAFT REGISTRATION RECORD:

Owner Information:
- Name: ${aircraftRecord.ownerName || "Unknown"}
- Owner Type: ${aircraftRecord.ownerType || "Unknown"}
- Location: ${aircraftRecord.ownerCity || "Unknown"}, ${aircraftRecord.ownerState || "Unknown"}
- Full Address: ${aircraftRecord.ownerAddress || "Not provided"}

Aircraft Details:
- Registration (N-Number): ${aircraftRecord.nNumber || "Unknown"}
- Manufacturer: ${aircraftRecord.manufacturer || "Unknown"}
- Model: ${aircraftRecord.model || "Unknown"}
- Aircraft Type: ${aircraftRecord.aircraftTypeDescription || aircraftRecord.aircraftType || "Unknown"}
- Engine Type: ${aircraftRecord.engineTypeDescription || aircraftRecord.engineType || "Unknown"}
- Year Manufactured: ${aircraftRecord.yearManufactured || "Unknown"}

Transaction Details:
- Transaction Type: ${aircraftRecord.transactionType || "Unknown"}
- Transaction Date: ${aircraftRecord.lastActionDate || "Unknown"}

ANALYSIS TASK:
Classify signal source (Person vs Company), estimate aircraft value and category, determine usage type, and provide brief transaction and business context.
`;

    const result = await chain.invoke({
      aircraftData: formattedData,
      format_instructions: parser.getFormatInstructions(),
    });

    console.log(`✅ Enrichment complete. Signal source: ${result.signalSource}`);
    console.log(`   Aircraft category: ${result.aircraftCategory}`);
    console.log(`   Estimated value: ${result.estimatedValue}`);

    return result;
  } catch (error: any) {
    console.error("❌ Error enriching aircraft ownership:", error.message);

    // Return minimal enrichment on error with basic signalSource detection
    const ownerName = aircraftRecord.ownerName || "Unknown";
    const isCompany =
      ownerName.includes("LLC") ||
      ownerName.includes("Inc") ||
      ownerName.includes("Corp") ||
      ownerName.includes("Aviation") ||
      ownerName.includes("Airlines") ||
      ownerName.includes("Jet");

    return {
      signalSource: isCompany ? ("Company" as const) : ("Person" as const),
      summary: `${aircraftRecord.ownerName || "Unknown owner"} owns a ${aircraftRecord.manufacturer || "aircraft"} ${aircraftRecord.model || ""} in ${aircraftRecord.ownerState || "Unknown location"}`,
      transactionContext: `${aircraftRecord.transactionType || "Aircraft transaction"}`,
      estimatedValue: "Unknown",
      businessContext: "Insufficient data for detailed analysis",
      aircraftCategory: "mid-tier" as const,
      usageCategory: "personal" as const,
    };
  }
}

/**
 * =========================================
 * BATCH ENRICHMENT
 * =========================================
 */

/**
 * Enrich multiple aircraft records in batch
 * @param records - Array of FAA aircraft records
 * @param concurrency - Number of concurrent API calls (default: 3)
 * @returns Array of enriched records
 */
export async function enrichAircraftBatch(records: any[], concurrency: number = 3): Promise<any[]> {
  const enriched: any[] = [];

  console.log(
    `🔄 Batch enriching ${records.length} aircraft records (concurrency: ${concurrency})`,
  );

  // Process in batches to avoid rate limits
  for (let i = 0; i < records.length; i += concurrency) {
    const batch = records.slice(i, i + concurrency);

    const batchResults = await Promise.all(batch.map((record) => enrichAircraftOwnership(record)));

    enriched.push(...batchResults);

    console.log(
      `   Processed ${Math.min(i + concurrency, records.length)}/${records.length} records`,
    );

    // Small delay between batches to avoid rate limits
    if (i + concurrency < records.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log(`✅ Batch enrichment complete. ${enriched.length} records enriched`);

  return enriched;
}
