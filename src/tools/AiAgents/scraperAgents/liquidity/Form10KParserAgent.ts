import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

/**
 * -----------------------------------
 * Schema definition for structured LLM output
 * -----------------------------------
 */
const schema = z.array(
  z.object({
    entityType: z.string(),
    name: z.string(),
    designation: z.string(),
    location: z.string(),
    companyName: z.string(),
    companyNameVariants: z.array(z.string()).optional(),
    boardMembership: z.string().optional(),
    committeeMemberships: z.array(z.string()).optional(),
    yearsOfService: z.string().optional(),
    age: z.string().optional(),
    keyPeople: z
      .array(
        z.object({
          name: z.string(),
          designation: z.string(),
          location: z.string(),
        }),
      )
      .optional(),
  }),
);

const parser = StructuredOutputParser.fromZodSchema(schema);

/**
 * -----------------------------------
 * System Prompt
 * -----------------------------------
 */
const systemPrompt = `You are a precise SEC Form 10-K (Annual Report) parser.

Extract this JSON as an array (one object per key person/entity mentioned in the 10-K):
[
  {{
    "entityType": "Individual" | "Company",
    "name": "<string>",
    "designation": "<role/title>",
    "location": "<one-line address or location>",
    "companyName": "<company filing the 10-K>",
    "companyNameVariants": ["<variant1>", "<variant2>", ...],
    "boardMembership": "<board membership status if applicable>",
    "committeeMemberships": ["<committee1>", "<committee2>", ...],
    "yearsOfService": "<years of service if mentioned>",
    "age": "<age if mentioned>",
    "keyPeople": [
      {{
        "name": "<person name>",
        "designation": "<person designation>",
        "location": "<person location>"
      }}
    ]
  }}
]

Rules:

Entity Type:
- Analyze the context and name to determine if this is an "Individual" or "Company".
- If the name contains business entity indicators like "LLC", "Inc", "Ltd", "Corporation", "Corp", "Capital", "Fund", "Holdings", "Partners", "Group", "Trust", "LP", "PLC" → entityType = "Company".
- Otherwise → entityType = "Individual".

Name:
- Extract the full name exactly as it appears in the 10-K filing.
- For individuals: Full name including middle initials if present.
- For companies: Complete legal entity name.

Designation:
- Extract the primary role/title:
  - For executives: "CEO", "Chief Executive Officer", "CFO", "Chief Financial Officer", "COO", "President", "Vice President", "Chief [Title] Officer"
  - For directors: "Director", "Independent Director", "Chairman", "Vice Chairman", "Lead Independent Director"
  - For other officers: "Secretary", "Treasurer", "General Counsel", "Chief Legal Officer"
- If multiple roles exist, use the most senior/primary role.

Location:
- Extract location information in format "City, State" or "City, State ZIP"
- If full address available: "Street, City, State ZIP"
- If only state available: use state
- If no location found: ""

companyName:
- For Individuals: Use the company filing the 10-K (the issuer)
- For Companies: Use the company filing the 10-K (the issuer)
- This should be consistent across all entries from the same 10-K

companyNameVariants:
- IMPORTANT: This field contains variations of the COMPANY NAME (from companyName field), NOT the entity's individual name
- For both Individuals AND Companies: Generate 6-8 realistic variations of the COMPANY FILING THE 10-K (the issuer)
- Include full legal variations: "Inc.", "Incorporated", "Corp.", "Corporation", "Holdings", "Ltd.", "Limited", "LLC", "L.L.C.", "LP", "L.P.", "PLC"
- Include abbreviated forms: remove suffixes entirely
- Include ticker-based variations if ticker exists
- Include common alternate forms: with/without commas, with/without periods
- Example for "Tesla, Inc.": ["Tesla Inc", "Tesla Inc.", "Tesla, Inc.", "Tesla", "TESLA", "Tesla Corporation", "Tesla Motors", "TSLA"]
- DO NOT generate variations of individual person names - only company name variations
- Always generate at least 6 variations of the company name

boardMembership (optional):
- Extract board membership information:
  - "Director" / "Director Since [Year]"
  - "Independent Director"
  - "Non-Independent Director"
  - "Chairman" / "Vice Chairman"
  - "Lead Independent Director"
- Only include if explicitly mentioned

committeeMemberships (optional, array):
- Extract committee memberships if mentioned:
  - "Audit Committee"
  - "Compensation Committee"
  - "Nominating and Governance Committee"
  - "Executive Committee"
  - "Risk Committee"
  - etc.
- Include leadership roles: "Audit Committee Chair"
- Only include if explicitly mentioned

yearsOfService (optional):
- Extract years of service with the company if mentioned
- Examples: "5 years", "Since 2019", "10+ years"
- Only include if explicitly mentioned

age (optional):
- Extract age if mentioned
- Examples: "52", "45 years old"
- Only include if explicitly mentioned

keyPeople (ONLY for entityType = "Company"):
- If entityType is "Company", extract key people associated with that company
- Look for executives, partners, principals mentioned in connection with the entity
- For each person:
  - name: Full name
  - designation: Their role/title
  - location: Their location if mentioned
- If no key people found or entityType is "Individual", omit this field

Extraction Strategy:
- Focus on: Executive Officers, Directors, Named Executive Officers (NEOs)
- Look in sections: "Directors and Executive Officers", "Executive Officers", "Item 10", "Item 11", "Corporate Governance", "Management"
- Extract only significant individuals/entities (executives, directors, key management)
- DO NOT extract every person mentioned - focus on key decision-makers and leadership
- Typically expect 5-20 entities per 10-K filing

General:
- Output a JSON array of all key entities
- Each entry should strictly follow the schema
- Trim whitespace, use "" for missing values
- No commentary or text outside JSON
- If optional fields not found, omit them entirely

{format_instructions}`;

/**
 * -----------------------------------
 * LangChain setup
 * -----------------------------------
 */
const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
});

const prompt = ChatPromptTemplate.fromMessages([
  ["system", systemPrompt],
  ["user", "{content}"],
]);

const chain = prompt.pipe(llm).pipe(parser);

/**
 * -----------------------------------
 * Content preprocessing helper
 * -----------------------------------
 */
function preprocessForm10KContent(content: string): string {
  // Remove HTML tags but keep text content
  let cleanedContent = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  cleanedContent = cleanedContent.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  cleanedContent = cleanedContent.replace(/<[^>]+>/g, " ");

  // Decode HTML entities
  cleanedContent = cleanedContent
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Remove excessive whitespace
  cleanedContent = cleanedContent.replace(/\s+/g, " ").trim();

  // Extract key sections using common headings for 10-K filings
  const sections = [
    "item 10",
    "item 11",
    "directors and executive officers",
    "executive officers",
    "directors, executive officers",
    "executive compensation",
    "named executive officers",
    "corporate governance",
    "board of directors",
    "management",
    "our executive officers",
    "our directors",
    "biographical information",
    "director information",
    "committee",
    "audit committee",
    "compensation committee",
    "governance",
    "executive officer",
    "senior management",
    "management team",
  ];

  const relevantSections: string[] = [];
  const lowerContent = cleanedContent.toLowerCase();
  const sectionsFound: string[] = [];

  // Find and extract sections
  for (const section of sections) {
    const index = lowerContent.indexOf(section);
    if (index !== -1) {
      sectionsFound.push(section);
      // Extract content around this section (20000 characters window for 10-K)
      const start = Math.max(0, index - 500);
      const end = Math.min(cleanedContent.length, index + 20000);
      const sectionContent = cleanedContent.substring(start, end);
      relevantSections.push(sectionContent);
    }
  }

  console.log(
    `   📋 Found ${sectionsFound.length} relevant sections: ${sectionsFound.slice(0, 5).join(", ")}${sectionsFound.length > 5 ? "..." : ""}`,
  );

  // If we found relevant sections, use them
  if (relevantSections.length > 0) {
    // Deduplicate by combining and removing overlaps
    const combined = relevantSections.join("\n\n---SECTION---\n\n");

    // Limit to approximately 90,000 characters (roughly 22,500 tokens)
    // This leaves room for the system prompt and response
    if (combined.length > 90000) {
      console.log(`   ✂️  Truncating combined sections from ${combined.length} to 90000 chars`);
      return combined.substring(0, 90000) + "\n\n[Content truncated due to length...]";
    }
    return combined;
  }

  console.log(`   ⚠️  No relevant sections found, using full content approach`);

  // Fallback: if no sections found, just take the first 90,000 characters
  if (cleanedContent.length > 90000) {
    console.log(`   ✂️  Truncating from ${cleanedContent.length} to 90000 chars`);
    return cleanedContent.substring(0, 90000) + "\n\n[Content truncated due to length...]";
  }

  return cleanedContent;
}

/**
 * -----------------------------------
 * Exported helper function
 * -----------------------------------
 */
export async function extractEntitiesFromForm10K(content: string) {
  try {
    console.log("AI🤖 Model Extracting entities from Form 10-K...");
    console.log(`📄 Original content length: ${content.length} characters`);

    // Preprocess content to extract relevant sections and reduce size
    const processedContent = preprocessForm10KContent(content);
    console.log(`📄 Processed content length: ${processedContent.length} characters`);

    const result = await chain.invoke({
      content: processedContent,
      format_instructions: parser.getFormatInstructions(),
    });
    return result;
  } catch (err) {
    console.error("Error extracting entities from Form 10-K:", err);
    throw err;
  }
}

/**
 * Map extracted entities to Signal schema format
 * @param entities - Array of extracted entities from Form 10-K
 * @param form10kData - The original Form 10-K filing document
 * @returns Array of signals ready to be saved to DB
 */
export function mapEntitiesToSignals(entities: any[], form10kData: any) {
  return entities.map((entity) => {
    // Determine if this is a Person or Company signal
    const signalSource = entity.entityType === "Individual" ? "Person" : "Company";

    // Base signal object
    const signal: any = {
      // Signal Classification
      signalSource,
      signalType: "10-k",

      // Filing Information from Form 10-K
      filingType: "Form 10-K annual report",
      companyName: form10kData.companyName || entity.companyName,
      companyTicker: form10kData.companyTicker,
      cik: form10kData.companyCik,
      accession: form10kData.accession,
      filingDate: form10kData.filingDate,
      // periodOfReport is optional for 10-K - we use filingDate
      filingLink: form10kData.filingLink,
      sourceUrl: form10kData.filingLink,

      // Primary Entity Information
      fullName: entity.name,
      designation: entity.designation,
      location: entity.location,

      // Company name variations for ContactOut API matching
      companyNameVariants: entity.companyNameVariants || [],

      // 10-K specific fields
      boardMembership: entity.boardMembership,
      committeeMemberships: entity.committeeMemberships || [],

      // Source metadata
      sourceOfInformation: "SEC EDGAR - Form 10-K",
      aiModelUsed: "gpt-4o-mini",
      filerType: entity.entityType === "Individual" ? "Executive/Director" : "Corporate Entity",

      // Processing status
      processingStatus: "Processed",
      contactEnrichmentStatus: "pending",

      scrapingId: form10kData._id,

      // Timestamps
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // For Individual signals
    if (signalSource === "Person") {
      signal.insiderName = entity.name;
      signal.insiderRole = entity.designation;

      // Parse designation to set relationship flags
      const designation = entity.designation?.toLowerCase() || "";
      signal.insiderRelationship = {
        isDirector:
          designation.includes("director") ||
          designation.includes("board member") ||
          entity.boardMembership !== undefined,
        isOfficer:
          designation.includes("officer") ||
          designation.includes("ceo") ||
          designation.includes("cfo") ||
          designation.includes("coo") ||
          designation.includes("president") ||
          designation.includes("chief"),
        isTenPercentOwner: false,
        officerTitle: entity.designation,
      };
    }

    // For Company signals - add key people if available
    if (signalSource === "Company" && entity.keyPeople && entity.keyPeople.length > 0) {
      signal.keyPeople = entity.keyPeople.map((person: any) => ({
        fullName: person.name,
        designation: person.designation,
        location: person.location,
        sourceOfInformation: "SEC Form 10-K Filing",
        dateAdded: new Date(),
        lastUpdated: new Date(),
      }));
    }

    return signal;
  });
}
