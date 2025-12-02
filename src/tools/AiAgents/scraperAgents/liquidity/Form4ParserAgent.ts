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
    address: z.string(),
    designation: z.string(),
    companyName: z.string(),
    companyNameVariants: z.array(z.string()).optional(),
    keyPeople: z
      .array(
        z.object({
          name: z.string(),
          designation: z.string(),
          location: z.string(),
        }),
      )
      .optional(),
    insight: z.string(),
  }),
);

const parser = StructuredOutputParser.fromZodSchema(schema);

/**
 * -----------------------------------
 * System Prompt
 * -----------------------------------
 */
// const systemPrompt = `You are a precise SEC Form 4 XML parser.

// Extract this JSON as an array (one object per <reportingOwner> in document order):
// [
//   {{
//     "entityType": "Individual" | "Company",
//     "name": "<string>",
//     "address": "<one-line full address>",
//     "designation": "<officer/director/10% Owner or empty>",
//     "companyName": "<company where that designation applies or empty>",
//     "keyPeople": [
//       {{
//         "name": "<person name>",
//         "designation": "<person designation>",
//         "location": "<person location>"
//       }}
//     ]
//   }}
// ]

// Rules (apply to each <reportingOwner> independently):

// Entity Type (determine ONLY from <rptOwnerName>):
// - Look at <reportingOwnerId>/<rptOwnerName>.
// - If it contains (case-insensitive) any of these terms:
//   ["LLC", "Inc", "Ltd", "Corporation", "Corp", "Capital", "Fund", "Holdings", "Partners", "Group", "Trust", "LP", "PLC"]
//   → entityType = "Company".
// - Otherwise → entityType = "Individual".
// - Ignore officerTitle, relationships, or issuer data when deciding entityType.

// Name:
// - Use the text of <reportingOwnerId>/<rptOwnerName> exactly, trimmed.

// Address (one line):
// - Combine: <rptOwnerStreet1>, <rptOwnerStreet2>, <rptOwnerCity>, <rptOwnerState> <rptOwnerZipCode>.
// - Skip empty fields. Separate with ", " except put a single space between State and Zip.
// - Example: "713 SILVERMINE ROAD, NEW CANAAN, CT 06840".
// - If all address fields are missing, return "".

// Designation:
// - If <isDirector> = "1" → "Director".
// - Else if <isOfficer> = "1":
//   - If <officerTitle> has text → use that text.
//   - Else → "Officer".
// - Else if <isTenPercentOwner> = "1" → "10% Owner".
// - Else → "" (empty string).
// - If multiple apply, prefer Officer (if officerTitle given), else Director.

// companyName:
// - For Individuals:
//   - If designation is "Director" or an officer title → use <issuer>/<issuerName> if available.
//   - If designation is only "10% Owner" → use <issuer>/<issuerName> if available.
//   - If no issuerName → "".
// - For Companies:
//   - Leave companyName = "" unless explicitly stated in title text that they act for another firm.
// - Never assign the reporting owner's own entity name as companyName (e.g., don't repeat "Myrmikan Capital, LLC").

// companyNameVariants (for all entities):
// - Generate at least 6-8 realistic variations of the entity's name to maximize ContactOut API matching.
// - Use the companyTicker (if available) to inform name variants.
// - For Companies:
//   - Include full legal variations: "Inc.", "Incorporated", "Corp.", "Corporation", "Holdings", "Ltd.", "Limited", "LLC", "L.L.C.", "LP", "L.P.", "PLC"
//   - Include abbreviated forms: remove suffixes entirely (e.g., "Apple" from "Apple Inc.")
//   - Include ticker-based variations if ticker exists: "Apple Inc.", "Apple (AAPL)", "AAPL Inc.", "AAPL Corporation", "Apple - AAPL"
//   - Include common alternate forms: with/without commas, with/without periods in abbreviations
//   - Example for "Myrmikan Capital, LLC": ["Myrmikan Capital", "Myrmikan Capital LLC", "Myrmikan Capital L.L.C.", "Myrmikan Capital Partners", "Myrmikan", "Myrmikan Capital Management"]
// - For Individuals:
//   - Include variations: "First Last", "Last, First", "F. Last", "First M. Last", "Last", "F Last" (no period)
//   - Include ticker-based associations if relevant: "James Britton (LWLC)", "James Britton - LWLC"
//   - Include middle initial variations if middle name/initial present
// - IMPORTANT: All variants must be realistic and commonly used in business contexts for CRM/API searches.
// - Always generate at least 6 variations, more if the name is complex or has multiple parts.

// keyPeople (ONLY for entityType = "Company"):
// - If entityType is "Company", extract key people associated with the company from the Form 4 XML.
// - Look for any individuals mentioned in connection with the company entity.
// - For each person, extract:
//   - name: Full name of the person
//   - designation: Their role/title (e.g., "Managing Partner", "Portfolio Manager", "CEO", etc.)
//   - location: Person's location in format "City, State" or "City, State ZIP"
// - If no key people are found or entityType is "Individual", omit the keyPeople field entirely.
// - Search in related sections like <reportingOwnerRelationship>, footnotes, or any associated data.

// General:
// - Output a JSON array of all <reportingOwner> entries.
// - Each entry should strictly follow the schema above.
// - Trim whitespace, use "" for missing values.
// - No commentary or text outside JSON.
// - Do not use derivative or non-derivative tables for these fields.

// {format_instructions}`;

const systemPrompt = `

You are a precise SEC Form 4 XML extraction agent. Parse the XML and return a JSON array (one per <reportingOwner>):



[

  {{

    "entityType": "Individual" | "Company",

    "name": "<string>",

    "address": "<formatted one-line address>",

    "designation": "<officer/director/10% Owner or empty>",

    "companyName": "<related company or empty>",

    "companyNameVariants": ["<variant1>", "<variant2>", ...],

    "keyPeople": [

      {{"name": "<string>", "designation": "<string>", "location": "<string>"}}

    ],

    "insight": "<4–5 sentence factual summary of the transaction>"

  }}

]



Rules:

- **Entity Type:** From <rptOwnerName>. If it contains words like LLC, Inc, Ltd, Corp, Capital, Fund, Holdings, Partners, Group, Trust, LP, PLC → "Company". Otherwise → "Individual".

- **Name:** Exact text from <reportingOwnerId>/<rptOwnerName>, trimmed.

- **Address:** Join <rptOwnerStreet1>, <rptOwnerStreet2>, <rptOwnerCity>, <rptOwnerState> <rptOwnerZipCode>. Skip blanks. Example: "713 SILVERMINE ROAD, NEW CANAAN, CT 06840".

- **Designation:** 

  - <isDirector>=1 → "Director"

  - <isOfficer>=1 → <officerTitle> if exists else "Officer"

  - <isTenPercentOwner>=1 → "10% Owner"

  - Prefer Officer over Director if both apply.

- **Company Name:** 

  - For Individuals: use <issuerName> if designation implies relation (Director, Officer, 10% Owner).

  - For Companies: leave blank unless acting for another firm (never echo its own name).

- **Name Variants (≥6 realistic):**

  - Company → add suffix/prefix/legal variants: Inc, LLC, Ltd, Holdings, Partners, Management, Corp, etc. + ticker-based if available.

  - Individual → add forms like “First Last”, “Last, First”, “F. Last”, “F Last”, “First M. Last”, “Last”, and ticker-based if relevant.

- **Key People:** Only for entityType="Company". Extract individuals associated with it, from <reportingOwnerRelationship>, footnotes, or nearby tags.

- **Insight (mandatory):**

  Provide a concise 3-4 sentence summary of what happened in this Form 4 filing. Include: (1) who the reporting owner is and their role/relationship to the company, (2) what transaction occurred (purchase, sale, grant, exercise, etc.), (3) the number of shares and approximate value if available, and (4) brief interpretation of significance (e.g., "signals insider confidence", "routine equity compensation", "portfolio rebalancing"). Focus on the actual transaction details from the XML.



Formatting:

- Strict JSON only. 

- Use "" for missing fields.

- Trim spaces.

- Follow schema exactly.

- {format_instructions}

`;
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
  ["user", "{xml}"],
]);

const chain = prompt.pipe(llm).pipe(parser);

/**
 * -----------------------------------
 * Exported helper function
 * -----------------------------------
 */
export async function extractEntitiesFromForm4(xml: string) {
  try {
    console.log("AI🤖 Model Extracting entities from Form 4 XML...");
    const result = await chain.invoke({
      xml,
      format_instructions: parser.getFormatInstructions(),
    });
    return result;
  } catch (err) {
    console.error("Error extracting entities:", err);
    throw err;
  }
}

/**
 * Map extracted entities to Signal schema format (OLD schema)
 * @param entities - Array of extracted entities from Form 4
 * @param form4Data - The original Form 4 filing document
 * @returns Array of signals ready to be saved to DB
 */
export function mapEntitiesToSignals(entities: any[], form4Data: any) {
  return entities.map((entity) => {
    // Determine if this is a Person or Company signal
    const signalSource = entity.entityType === "Individual" ? "Person" : "Company";

    // Base signal object
    const signal: any = {
      // Signal Classification
      signalSource,
      signalType: "form-4",

      // Filing Information from Form 4
      filingType: "Form 4 insider activity",
      companyName: form4Data.companyName || entity.companyName,
      companyTicker: form4Data.companyTicker,
      cik: form4Data.companyCik,
      accession: form4Data.accession,
      filingDate: form4Data.filingDate,
      periodOfReport: form4Data.periodOfReport,
      filingLink: form4Data.filingLink,
      sourceUrl: form4Data.filingLink,

      // Primary Entity Information
      fullName: entity.name,
      designation: entity.designation,
      location: entity.address,

      // Company name variations for ContactOut API matching
      companyNameVariants: entity.companyNameVariants || [],

      // Source metadata
      sourceOfInformation: "SEC EDGAR - Form 4",
      aiModelUsed: "gpt-4o-mini",
      filerType: entity.entityType === "Individual" ? "Individual Insider" : "Company/Fund",

      // Processing status
      processingStatus: "Processed",
      contactEnrichmentStatus: "pending",

      scrapingId: form4Data._id,

      // Timestamps
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // For Individual signals
    if (signalSource === "Person") {
      signal.insiderName = entity.name;
      signal.insiderCik = form4Data.insiderCik;
      signal.insiderRole = entity.designation;

      // Parse designation to set relationship flags
      const designation = entity.designation?.toLowerCase() || "";
      signal.insiderRelationship = {
        isDirector: designation.includes("director"),
        isOfficer:
          designation.includes("officer") ||
          designation.includes("ceo") ||
          designation.includes("cfo") ||
          designation.includes("president") ||
          designation.includes("chief"),
        isTenPercentOwner: designation.includes("10% owner"),
        officerTitle: entity.designation,
      };
    }

    // For Company signals - add key people if available
    if (signalSource === "Company" && entity.keyPeople && entity.keyPeople.length > 0) {
      signal.keyPeople = entity.keyPeople.map((person: any) => ({
        fullName: person.name,
        designation: person.designation,
        location: person.location,
        sourceOfInformation: "SEC Form 4 Filing",
        dateAdded: new Date(),
        lastUpdated: new Date(),
      }));
    }

    return signal;
  });
}

//new logic
/**
 * Map extracted entities to NEW Signal schema format (Contact/newSignal model)
 * @param entities - Array of extracted entities from Form 4
 * @param form4Data - The original Form 4 filing document with accession, filingLink, rawXml, etc.
 * @returns Array of new signals ready to be saved to Contact (newSignal) DB
 */
export function mapEntitiesToNewSignals(entities: any[], form4Data: any) {
  return entities.map((entity) => {
    // Determine if this is a Person or Company signal
    const signalSource = entity.entityType === "Individual" ? "Person" : "Company";

    // Parse designation to set relationship flags for form4Data
    const designation = entity.designation?.toLowerCase() || "";
    const isDirector = designation.includes("director");
    const isOfficer =
      designation.includes("officer") ||
      designation.includes("ceo") ||
      designation.includes("cfo") ||
      designation.includes("president") ||
      designation.includes("chief");
    const isTenPercentOwner = designation.includes("10% owner");

    // Base signal object matching newSignal interface
    const newSignal: any = {
      // Required fields
      signalSource, // "Person" | "Company"
      signalType: "form-4",
      filingType: "form-4", // matches filingTypeEnum
      fullName: entity.name,

      // Filing information
      filingLink: form4Data.filingLink,
      filingDate: form4Data.filingDate || new Date(),

      // AI insights
      insights:
        entity.insight ||
        `Form 4 filing extracted for ${entity.name}${entity.designation ? ` (${entity.designation})` : ""}`,
      signalIndicator:
        entity.entityType === "Individual"
          ? "Insider Trading Activity"
          : "Institutional Position Change",
      aiModelUsed: "gpt-4o-mini",

      // Person/Entity information
      designation: entity.designation,
      location: entity.address,

      // Company information
      companyName: form4Data.companyName || entity.companyName || "",
      companyNameVariants: entity.companyNameVariants || [],
      companyTicker: form4Data.companyTicker || "",
      companyAddress: entity.entityType === "Company" ? entity.address : "",

      // Processing status
      processingStatus: "Processed",
      contactEnrichmentStatus: "pending",

      // Form
      form4Data: {
        insiderName: entity.name,
        insiderCik: form4Data.insiderCik || "",
        insiderRole: entity.designation,
        insiderRelationship: {
          isDirector,
          isOfficer,
          isTenPercentOwner,
          officerTitle: isOfficer ? entity.designation : "",
        },
        transactionDate: form4Data.transactionDate || form4Data.filingDate || new Date(),
        transactionType: form4Data.transactionType || "",
        numberOfShares: form4Data.numberOfShares || 0,
        pricePerShare: form4Data.pricePerShare || 0,
      },
    };

    // For Company signals - add key people if available
    if (signalSource === "Company" && entity.keyPeople && entity.keyPeople.length > 0) {
      newSignal.keyPeople = entity.keyPeople.map((person: any) => ({
        fullName: person.name,
        designation: person.designation,
        location: person.location,
        sourceOfInformation: "SEC Form 4 Filing",
        dateAdded: new Date(),
        lastUpdated: new Date(),
      }));
    }

    return newSignal;
  });
}
