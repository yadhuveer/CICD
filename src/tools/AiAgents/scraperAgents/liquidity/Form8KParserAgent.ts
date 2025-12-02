import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { generateCompanyNameVariants } from "../../../../helpers/Form13XMLParser.js";

/**
 * =========================================
 * Form 8-K Schema - Streamlined for People & Companies
 * =========================================
 * Form 8-K reports material corporate events. This parser focuses on:
 * - Extracting people (officers, directors) from Item 5.02 events
 * - Company information
 * - Event categorization for lead generation
 */

const schema = z.object({
  // Document Metadata (from DEI namespace)
  issuerName: z.string(),
  issuerCik: z.string().nullable().optional(),
  issuerTicker: z.string().nullable().optional(),
  formType: z.string(), // 8-K, 8-K/A
  filingDate: z.string(), // Date of filing (YYYY-MM-DD)
  dateOfEvent: z.string(), // Date when the event occurred (YYYY-MM-DD)
  accessionNo: z.string().nullable().optional(),
  filingUrl: z.string().nullable().optional(), // Direct link to the filing

  // Company Contact Information
  issuerAddress: z.string().nullable().optional(),
  issuerPhone: z.string().nullable().optional(),
  stateOfIncorporation: z.string().nullable().optional(),
  fiscalYearEnd: z.string().nullable().optional(),

  // Event Classification (Critical for signal routing)
  eventItems: z
    .array(z.string())
    .optional()
    .describe(
      "Item numbers from 8-K: Item 1.01 (Material Agreement), Item 2.01 (Acquisition/Disposition), " +
        "Item 2.02 (Financial Results), Item 5.02 (Officer/Director Changes), Item 8.01 (Other Events), etc.",
    ),
  eventSummary: z
    .string()
    .nullable()
    .optional()
    .describe("One-sentence summary of the material event(s)"),

  // People Extraction (HIGH VALUE for lead generation)
  people: z
    .array(
      z.object({
        name: z.string(),
        designation: z.string().nullable().optional(), // Title/Role: CEO, CFO, Director, etc.
        eventType: z
          .string()
          .nullable()
          .optional()
          .describe(
            'Type of personnel event: "appointed", "resigned", "departed", "elected", "promoted", "retired"',
          ),
        effectiveDate: z
          .string()
          .nullable()
          .optional()
          .describe("Date when the personnel change is effective"),
        priorRole: z.string().nullable().optional().describe("Previous position if mentioned"),
        reason: z
          .string()
          .nullable()
          .optional()
          .describe("Reason for departure/change if mentioned"),
      }),
    )
    .optional()
    .describe(
      "People mentioned in Item 5.02 or other sections (officers, directors, key personnel)",
    ),

  // Related Companies (M&A, partnerships, material agreements)
  relatedCompanies: z
    .array(
      z.object({
        name: z.string(),
        relationship: z
          .string()
          .nullable()
          .optional()
          .describe(
            'Relationship type: "acquired", "merger partner", "vendor", "customer", "partner"',
          ),
        dealValue: z.string().nullable().optional().describe("Transaction value if disclosed"),
      }),
    )
    .optional()
    .describe("Other companies mentioned in acquisitions, partnerships, or material agreements"),

  // Financial Data (if Item 2.02 - Earnings)
  hasFinancialResults: z.boolean().optional(),
  revenue: z.string().nullable().optional(),
  netIncome: z.string().nullable().optional(),
  eps: z.string().nullable().optional(),
});

const parser = StructuredOutputParser.fromZodSchema(schema);

/**
 * =========================================
 * Form 8-K AI System Prompt - Optimized
 * =========================================
 */
const systemPrompt = `You are a precise Form 8-K parser focused on extracting people and companies for B2B lead generation.

Form 8-K is a "current report" filed to announce material corporate events. Your job is to extract:
1. Company information (issuer filing the 8-K)
2. People (especially from Item 5.02 officer/director changes)
3. Related companies (from M&A, partnerships, agreements)
4. Event categorization

Return JSON:
{{
  "issuerName": "<company filing the 8-K>",
  "issuerCik": "<CIK number>",
  "issuerTicker": "<stock ticker>",
  "formType": "8-K|8-K/A",
  "filingDate": "<YYYY-MM-DD>",
  "dateOfEvent": "<YYYY-MM-DD>",
  "accessionNo": "<accession number>",
  "filingUrl": "<direct link to filing if available in XML>",
  "issuerAddress": "<full address as single string>",
  "issuerPhone": "<phone>",
  "stateOfIncorporation": "<state>",
  "fiscalYearEnd": "<MMDD>",
  "eventItems": ["Item 5.02", "Item 2.01"],
  "eventSummary": "<one sentence description>",
  "people": [
    {{
      "name": "<full name>",
      "designation": "<CEO|CFO|Director|etc>",
      "eventType": "appointed|resigned|departed|elected|promoted|retired",
      "effectiveDate": "<YYYY-MM-DD>",
      "priorRole": "<previous title if mentioned>",
      "reason": "<reason for change if mentioned>"
    }}
  ],
  "relatedCompanies": [
    {{
      "name": "<company name>",
      "relationship": "acquired|merger partner|vendor|customer|partner",
      "dealValue": "<transaction value if disclosed>"
    }}
  ],
  "hasFinancialResults": true|false,
  "revenue": "<amount if Item 2.02>",
  "netIncome": "<amount if Item 2.02>",
  "eps": "<earnings per share if Item 2.02>"
}}

EXTRACTION RULES:

1. COMPANY INFORMATION (Issuer):
   - issuerName: Extract from <conformed-name>, <companyName>, dei:EntityRegistrantName
   - issuerCik: Extract from <cik>, dei:EntityCentralIndexKey
   - issuerTicker: Extract from <trading-symbol>, dei:TradingSymbol
   - filingDate: Extract from <filing-date>, dei:DocumentPeriodEndDate (convert MM/DD/YYYY → YYYY-MM-DD)
   - dateOfEvent: Extract from <date-of-event>, dei:DocumentDate (convert to YYYY-MM-DD)
   - accessionNo: Extract from <accession-number>
   - filingUrl: Extract from any <filing-href> or <link> tags pointing to the HTML/HTM filing
   - issuerAddress: Combine dei:EntityAddressAddressLine1, EntityAddressCityOrTown, EntityAddressStateOrProvince, EntityAddressPostalZipCode
   - issuerPhone: Extract from dei:LocalPhoneNumber or <phone>

2. EVENT CLASSIFICATION (Critical!):
   - eventItems: Extract ALL Item numbers mentioned (e.g., ["Item 5.02", "Item 2.01"])
   - Common items:
     * Item 1.01 - Entry into Material Agreement
     * Item 2.01 - Completion of Acquisition/Disposition → Extract to relatedCompanies
     * Item 2.02 - Results of Operations and Financial Condition → Set hasFinancialResults=true
     * Item 5.02 - Departure/Election of Directors/Officers → Extract to people array
     * Item 8.01 - Other Events
     * Item 9.01 - Financial Statements and Exhibits
   - eventSummary: ONE sentence summarizing the material event(s)

3. PEOPLE EXTRACTION (HIGH PRIORITY for Item 5.02):
   - Look for sections mentioning officer or director changes
   - Extract:
     * name: Full name (check <person>, <officer>, <director> tags or text sections)
     * designation: Current or new title (CEO, CFO, President, Director, etc.)
     * eventType: Categorize as "appointed", "resigned", "departed", "elected", "promoted", "retired"
     * effectiveDate: When the change is effective
     * priorRole: If they had a previous role at the company
     * reason: If reason for departure is mentioned (retirement, new opportunity, termination, etc.)
   - IMPORTANT: Also extract people from signature sections (signers) and contact information sections

4. RELATED COMPANIES (M&A, Partnerships):
   - For Item 2.01 (Acquisitions/Dispositions):
     * Extract the other party's name
     * relationship: "acquired", "disposed to", "merger partner"
     * dealValue: Transaction value if mentioned
   - For Item 1.01 (Material Agreements):
     * Extract counterparty name
     * relationship: "vendor", "customer", "partner", "licensor"

5. FINANCIAL DATA (Item 2.02 only):
   - hasFinancialResults: Set to true if Item 2.02 is present
   - revenue, netIncome, eps: Extract if explicitly stated

IMPORTANT NOTES:
- Form 8-K uses XBRL format with dei: (Document Entity Information) namespace
- Item 5.02 (personnel changes) is the HIGHEST VALUE for B2B lead generation
- The filingUrl should be the direct link to the HTML filing for verification
- People data is more valuable than financial data for our use case
- Keep extraction focused and minimal - only extract what's clearly stated

Return only valid JSON matching the schema.

{{format_instructions}}`;

/**
 * =========================================
 * LangChain setup
 * =========================================
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
 * Extract Form 8-K data from raw XML/XBRL string
 */
export async function extract8KDataFromParsed(xmlString: string) {
  try {
    console.log("AI🤖 Processing Form 8-K Current Report...");
    console.log(`📊 XML size: ${xmlString.length} characters`);

    // Send raw XML to AI agent for extraction
    const result = await chain.invoke({
      xml: xmlString,
      format_instructions: parser.getFormatInstructions(),
    });

    // Post-process: Generate company name variants
    const enrichedResult = {
      ...result,
      companyNameVariants: generateCompanyNameVariants(result.issuerName),
    };

    console.log(`✅ Extracted Form 8-K data for ${result.issuerName}`);
    console.log(`   Event Items: ${result.eventItems?.join(", ") || "None"}`);
    console.log(`   People: ${result.people?.length || 0}`);
    console.log(`   Related Companies: ${result.relatedCompanies?.length || 0}`);
    if (result.eventSummary) {
      console.log(`   Summary: ${result.eventSummary}`);
    }

    return enrichedResult;
  } catch (err) {
    console.error("Error processing Form 8-K data:", err);
    throw err;
  }
}

/**
 * =========================================
 * Map to Signal schema - Optimized
 * =========================================
 */
export function map8KToSignals(parsed: any, raw: any) {
  const signals: any[] = [];

  // Map formType to signal type enum
  const signalTypeMap: Record<string, string> = {
    "8-K": "form-8k",
    "8-K/A": "form-8ka",
  };

  // Determine filer type based on event items
  let filerType = "Public Company - Material Event";
  const eventItems = parsed.eventItems || [];

  if (eventItems.some((item: string) => item.includes("5.02"))) {
    filerType = "Public Company - Personnel Change (Item 5.02)";
  } else if (eventItems.some((item: string) => item.includes("2.02"))) {
    filerType = "Public Company - Financial Results (Item 2.02)";
  } else if (eventItems.some((item: string) => item.includes("2.01"))) {
    filerType = "Public Company - M&A Activity (Item 2.01)";
  } else if (eventItems.some((item: string) => item.includes("1.01"))) {
    filerType = "Public Company - Material Agreement (Item 1.01)";
  }

  // Create primary Company signal for the issuer
  const primarySignal: any = {
    // Signal Classification
    signalSource: "Company",
    signalType: signalTypeMap[parsed.formType] || "form-8k",

    // Core Entity Fields
    fullName: parsed.issuerName,

    // Filing Information
    filingType: parsed.formType,
    accession: parsed.accessionNo,
    filingDate: parsed.filingDate ? new Date(parsed.filingDate) : undefined,
    dateOfEvent: parsed.dateOfEvent ? new Date(parsed.dateOfEvent) : undefined,
    periodOfReport: parsed.dateOfEvent ? new Date(parsed.dateOfEvent) : undefined,

    // Company Information
    companyName: parsed.issuerName,
    companyTicker: parsed.issuerTicker,
    companyCik: parsed.issuerCik,
    cik: parsed.issuerCik,
    location: parsed.issuerAddress,
    phoneNumber: parsed.issuerPhone,
    stateOfIncorporation: parsed.stateOfIncorporation,
    fiscalYearEnd: parsed.fiscalYearEnd,

    // Company name variations for ContactOut API matching
    companyNameVariants: parsed.companyNameVariants || [],

    // Form 8-K specific fields (stored as metadata)
    eventItems: parsed.eventItems || [],
    eventDescription: parsed.eventSummary,

    // Financial data if available (Item 2.02)
    ...(parsed.hasFinancialResults && {
      financialHighlights: {
        revenue: parsed.revenue,
        netIncome: parsed.netIncome,
        earningsPerShare: parsed.eps,
      },
    }),

    // Source metadata
    sourceOfInformation: "SEC EDGAR - Form 8-K",
    aiModelUsed: "gpt-4o-mini",
    filerType,

    // Processing status
    processingStatus: "Processed",
    contactEnrichmentStatus: "pending",

    // Links - Use parsed.filingUrl if available, otherwise fallback to raw.filingLink
    filingLink: parsed.filingUrl || raw.filingLink,
    sourceUrl: parsed.filingUrl || raw.filingLink,
    scrapingId: raw._id,

    // Timestamps
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Add people to keyPeople array in the company signal
  if (parsed.people && parsed.people.length > 0) {
    primarySignal.keyPeople = parsed.people.map((person: any) => ({
      fullName: person.name,
      designation: person.designation,
      relationship: person.eventType || "mentioned",
      phoneNumber: parsed.issuerPhone, // Use company phone as default
      email: null,
      location: parsed.issuerAddress, // Use company address as default
      sourceOfInformation: "SEC Form 8-K Filing",
      dateAdded: new Date(),
      lastUpdated: new Date(),
      // Store additional person-specific metadata
      eventType: person.eventType,
      effectiveDate: person.effectiveDate,
      priorRole: person.priorRole,
      reason: person.reason,
    }));
  }

  signals.push(primarySignal);

  // Create separate Person signals ONLY for HIGH-VALUE personnel changes (Item 5.02)
  const hasPersonnelChange = eventItems.some((item: string) => item.includes("5.02"));

  if (hasPersonnelChange && parsed.people && parsed.people.length > 0) {
    for (const person of parsed.people) {
      // Only create Person signal if it's a significant event type
      const significantEvents = [
        "appointed",
        "resigned",
        "departed",
        "elected",
        "promoted",
        "retired",
      ];
      if (person.eventType && significantEvents.includes(person.eventType.toLowerCase())) {
        const personSignal: any = {
          // Signal Classification
          signalSource: "Person",
          signalType: signalTypeMap[parsed.formType] || "form-8k",

          // Core Entity Fields
          fullName: person.name,
          designation: person.designation,

          // Filing Information
          filingType: parsed.formType,
          accession: parsed.accessionNo,
          filingDate: parsed.filingDate ? new Date(parsed.filingDate) : undefined,
          dateOfEvent: parsed.dateOfEvent ? new Date(parsed.dateOfEvent) : undefined,
          periodOfReport: parsed.dateOfEvent ? new Date(parsed.dateOfEvent) : undefined,

          // Company Information (employer)
          companyName: parsed.issuerName,
          companyTicker: parsed.issuerTicker,
          companyCik: parsed.issuerCik,

          // Person Contact Information (defaults to company info)
          location: parsed.issuerAddress,
          phoneNumber: parsed.issuerPhone,

          // Company name variations for ContactOut API matching
          companyNameVariants: parsed.companyNameVariants || [],

          // Person-specific fields
          insiderName: person.name,
          insiderRole: person.designation,
          eventType: person.eventType,

          // Event details (stored as metadata)
          eventItems: parsed.eventItems || [],
          eventDescription: parsed.eventSummary,
          effectiveDate: person.effectiveDate,
          priorRole: person.priorRole,
          departureReason: person.reason,

          // Source metadata
          sourceOfInformation: `SEC EDGAR - Form 8-K (${person.eventType})`,
          aiModelUsed: "gpt-4o-mini",
          filerType: `Executive/Director - ${person.eventType}`,

          // Processing status
          processingStatus: "Processed",
          contactEnrichmentStatus: "pending",

          // Links
          filingLink: parsed.filingUrl || raw.filingLink,
          sourceUrl: parsed.filingUrl || raw.filingLink,
          scrapingId: raw._id,

          // Timestamps
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        signals.push(personSignal);
      }
    }
  }

  // Create Company signals for related companies (M&A, partnerships)
  if (parsed.relatedCompanies && parsed.relatedCompanies.length > 0) {
    for (const relatedCompany of parsed.relatedCompanies) {
      const relatedSignal: any = {
        // Signal Classification
        signalSource: "Company",
        signalType: "form-8k",

        // Core Entity Fields
        fullName: relatedCompany.name,

        // Filing Information
        filingType: parsed.formType,
        accession: parsed.accessionNo,
        filingDate: parsed.filingDate ? new Date(parsed.filingDate) : undefined,
        periodOfReport: parsed.dateOfEvent ? new Date(parsed.dateOfEvent) : undefined,

        // Related Company Info
        companyName: relatedCompany.name,
        companyNameVariants: generateCompanyNameVariants(relatedCompany.name),

        // Relationship to main company
        relatedCompanyName: parsed.issuerName,
        relatedCompanyCik: parsed.issuerCik,
        relationship: relatedCompany.relationship,
        transactionDetails: relatedCompany.dealValue
          ? {
              type: relatedCompany.relationship,
              amount: relatedCompany.dealValue,
              description: parsed.eventSummary,
            }
          : undefined,

        // Event details
        eventItems: parsed.eventItems || [],
        eventDescription: parsed.eventSummary,

        // Source metadata
        sourceOfInformation: `SEC EDGAR - Form 8-K (Related Company)`,
        aiModelUsed: "gpt-4o-mini",
        filerType: `Related Company - ${relatedCompany.relationship}`,

        // Processing status
        processingStatus: "Processed",
        contactEnrichmentStatus: "pending",

        // Links
        filingLink: parsed.filingUrl || raw.filingLink,
        sourceUrl: parsed.filingUrl || raw.filingLink,
        scrapingId: raw._id,

        // Timestamps
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      signals.push(relatedSignal);
    }
  }

  return signals;
}
