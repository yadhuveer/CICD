import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { generateCompanyNameVariants } from "../../../../helpers/Form13XMLParser.js";

/**
 * =========================================
 * S-3 Schema - Registration Statement Data
 * =========================================
 */
const schema = z.object({
  issuerName: z.string(),
  issuerCIK: z.string().nullable().optional(),
  formType: z.string(), // S-3, S-3/A
  filingDate: z.string(), // Date of filing
  effectiveDate: z.string().nullable().optional(),
  accessionNo: z.string().nullable().optional(),

  // Issuer Information
  issuerAddress: z.string().nullable().optional(),
  issuerPhone: z.string().nullable().optional(),
  issuerEmail: z.string().nullable().optional(),
  stateOfIncorporation: z.string().nullable().optional(),
  irsEmployerIdNumber: z.string().nullable().optional(),

  // Securities Registration
  securitiesType: z.string().nullable().optional(), // Common Stock, Preferred Stock, Debt Securities, etc.
  securitiesAmount: z.string().nullable().optional(),
  proposedMaxAggregateOffering: z.string().nullable().optional(),

  // Key People and Contacts
  keyPeople: z
    .array(
      z.object({
        name: z.string(),
        designation: z.string().nullable().optional(), // CEO, CFO, Director, etc.
        relationship: z.string().nullable().optional(), // Authorized Representative, Signer, etc.
        phoneNumber: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
      }),
    )
    .optional(),

  // Underwriters/Selling Agents
  underwriters: z
    .array(
      z.object({
        name: z.string(),
        cik: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        phoneNumber: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

const parser = StructuredOutputParser.fromZodSchema(schema);

/**
 * =========================================
 * S-3 AI System Prompt
 * =========================================
 */
const systemPrompt = `Extract S-3 Registration Statement data from XML including contact information.

Return JSON:
{{
  "issuerName": "<company name>",
  "issuerCIK": "<CIK>",
  "formType": "S-3|S-3/A",
  "filingDate": "<YYYY-MM-DD>",
  "effectiveDate": "<YYYY-MM-DD>",
  "accessionNo": "<accession>",
  "issuerAddress": "<full address>",
  "issuerPhone": "<phone>",
  "issuerEmail": "<email>",
  "stateOfIncorporation": "<state>",
  "irsEmployerIdNumber": "<EIN>",
  "securitiesType": "<type of securities>",
  "securitiesAmount": "<number of shares/amount>",
  "proposedMaxAggregateOffering": "<dollar amount>",
  "keyPeople": [
    {{
      "name": "<name>",
      "designation": "<title/position>",
      "relationship": "<role in filing>",
      "phoneNumber": "<phone>",
      "email": "<email>",
      "address": "<address>"
    }}
  ],
  "underwriters": [
    {{
      "name": "<underwriter name>",
      "cik": "<CIK>",
      "address": "<address>",
      "phoneNumber": "<phone>"
    }}
  ]
}}

Rules:
- issuerName: <filerName> or <companyName> or <registrantName>
- issuerCIK: <cik> or <companyData><cik>
- formType: <submissionType> or <type>
- filingDate: <filingDate> or <dateOfFiling> (convert MM/DD/YYYY to YYYY-MM-DD)
- effectiveDate: <effectiveDate> (convert MM/DD/YYYY to YYYY-MM-DD)
- issuerAddress: Extract from <businessAddress> or <mailingAddress>, format as single string
- issuerPhone: Extract from <businessPhone> or <phoneNumber>
- stateOfIncorporation: <stateOfIncorporation> or <jurisdictionOfIncorporation>
- irsEmployerIdNumber: <irsNumber> or <employerIdNumber>
- securitiesType: Extract from <securitiesType> or infer from prospectus text
- securitiesAmount: Extract from <sharesRegistered> or <amountRegistered>
- proposedMaxAggregateOffering: Extract from <proposedMaximumAggregateOffering>
- keyPeople: Extract from <signerInfo>, <authorizedRepresentative>, <contactInfo>
  * name: <personName> or <signerName>
  * designation: <title> or <position>
  * relationship: "Signer" | "Authorized Representative" | "Contact Person"
  * phoneNumber: <phone> or <contactPhone>
  * email: <email> or <contactEmail>
  * address: <address> or <contactAddress>
- underwriters: Extract from <underwriterInfo> or <sellingAgent> sections

IMPORTANT:
- Always check all contact-related sections for phone numbers, emails, and addresses
- Match key people from signature sections and contact information sections
- Extract all authorized representatives and signers

Keep it minimal but include all contact information. Return only JSON.

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
 * Extract S-3 data from raw XML string
 */
export async function extractS3DataFromParsed(xmlString: string) {
  try {
    console.log("AI🤖 Processing S-3 Registration Statement (lightweight XML parsing)...");
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

    console.log(`✅ Extracted S-3 data for ${result.issuerName}`);
    console.log(`   Key People: ${result.keyPeople?.length || 0}`);
    console.log(`   Underwriters: ${result.underwriters?.length || 0}`);

    return enrichedResult;
  } catch (err) {
    console.error("Error processing S-3 data:", err);
    throw err;
  }
}

/**
 * =========================================
 * Map to Signal schema
 * =========================================
 */
export function mapS3ToSignals(parsed: any, raw: any) {
  const signals: any[] = [];

  // Map formType to signal type enum
  const signalTypeMap: Record<string, string> = {
    "S-3": "form-s3",
    "S-3/A": "form-s3a",
  };

  // Create primary signal for the issuer/company
  const primarySignal: any = {
    // Signal Classification
    signalSource: "Company",
    signalType: signalTypeMap[parsed.formType] || "form-s3",

    // Core Entity Fields
    fullName: parsed.issuerName, // For Company signals, fullName is the company name

    // Filing Information
    filingType: parsed.formType,
    accession: parsed.accessionNo,
    filingDate: parsed.filingDate ? new Date(parsed.filingDate) : undefined,
    effectiveDate: parsed.effectiveDate ? new Date(parsed.effectiveDate) : undefined,
    periodOfReport: parsed.filingDate ? new Date(parsed.filingDate) : undefined,

    // Issuer (Company filing the S-3)
    companyName: parsed.issuerName,
    companyCik: parsed.issuerCIK,
    cik: parsed.issuerCIK, // Add cik field for consistency
    location: parsed.issuerAddress,
    phoneNumber: parsed.issuerPhone,
    email: parsed.issuerEmail,
    stateOfIncorporation: parsed.stateOfIncorporation,
    irsEmployerIdNumber: parsed.irsEmployerIdNumber,

    // Company name variations for ContactOut API matching
    companyNameVariants: parsed.companyNameVariants || [],

    // Securities Details (S-3 specific)
    securitiesType: parsed.securitiesType,
    securitiesAmount: parsed.securitiesAmount,
    proposedMaxAggregateOffering: parsed.proposedMaxAggregateOffering,

    // Source metadata
    sourceOfInformation: "SEC EDGAR - Form S-3",
    aiModelUsed: "gpt-4o-mini",
    filerType: "Public Company - Securities Registration",

    // Processing status
    processingStatus: "Processed",
    contactEnrichmentStatus: "pending",

    // Links
    filingLink: raw.filingLink,
    sourceUrl: raw.filingLink,
    scrapingId: raw._id,

    // Timestamps
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Add key people to company signal
  if (parsed.keyPeople && parsed.keyPeople.length > 0) {
    primarySignal.keyPeople = parsed.keyPeople.map((person: any) => ({
      fullName: person.name,
      designation: person.designation,
      relationship: person.relationship,
      phoneNumber: person.phoneNumber,
      email: person.email,
      location: person.address,
      sourceOfInformation: "SEC S-3 Filing",
      dateAdded: new Date(),
      lastUpdated: new Date(),
    }));
  }

  signals.push(primarySignal);

  // Create separate signals for underwriters (as Company signals)
  if (parsed.underwriters && parsed.underwriters.length > 0) {
    for (const underwriter of parsed.underwriters) {
      const underwriterSignal: any = {
        // Signal Classification
        signalSource: "Company",
        signalType: "form-s3-underwriter",

        // Core Entity Fields
        fullName: underwriter.name, // For Company signals, fullName is the company name

        // Filing Information
        filingType: parsed.formType,
        accession: parsed.accessionNo,
        filingDate: parsed.filingDate ? new Date(parsed.filingDate) : undefined,
        periodOfReport: parsed.filingDate ? new Date(parsed.filingDate) : undefined,

        // Underwriter Company Info
        companyName: underwriter.name,
        companyCik: underwriter.cik,
        cik: underwriter.cik, // Add cik field for consistency
        location: underwriter.address,
        phoneNumber: underwriter.phoneNumber,

        // Reference to issuer
        relatedCompanyName: parsed.issuerName,
        relatedCompanyCik: parsed.issuerCIK,

        // Company name variations for ContactOut API matching
        companyNameVariants: generateCompanyNameVariants(underwriter.name),

        // Source metadata
        sourceOfInformation: "SEC EDGAR - Form S-3 (Underwriter)",
        aiModelUsed: "gpt-4o-mini",
        filerType: "Underwriter/Investment Bank",

        // Processing status
        processingStatus: "Processed",
        contactEnrichmentStatus: "pending",

        // Links
        filingLink: raw.filingLink,
        sourceUrl: raw.filingLink,
        scrapingId: raw._id,

        // Timestamps
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      signals.push(underwriterSignal);
    }
  }

  return signals;
}
