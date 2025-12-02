import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { generateCompanyNameVariants } from "../../../../helpers/Form13XMLParser.js";

/**
 * =========================================
 * Form D Schema - Core Data Only
 * =========================================
 */
const schema = z.object({
  issuerName: z.string(),
  issuerCIK: z.string().nullable().optional(),
  industryGroup: z.string().nullable().optional(),
  issuerAddress: z.string().nullable().optional(),
  issuerPhoneNumber: z.string().nullable().optional(),
  issuerWebsite: z.string().nullable().optional(),
  offeringType: z.string().nullable().optional(), // Rule 506(b), Rule 506(c), Rule 504, etc.
  totalOfferingAmount: z.string().nullable().optional(),
  totalAmountSold: z.string().nullable().optional(),
  dateOfFirstSale: z.string().nullable().optional(),
  filingDate: z.string().nullable().optional(),
  accessionNo: z.string().nullable().optional(),

  // Key people involved in the offering
  relatedPersons: z.array(
    z.object({
      name: z.string(),
      entityType: z.enum(["Individual", "Company"]),
      relationship: z.string(), // "Executive Officer", "Director", "Promoter", etc.
      address: z.string().nullable().optional(),
      phoneNumber: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
      keyPeople: z
        .array(
          z.object({
            name: z.string(),
            designation: z.string().nullable().optional(),
            phoneNumber: z.string().nullable().optional(),
            email: z.string().nullable().optional(),
          }),
        )
        .optional(),
    }),
  ),
});

const parser = StructuredOutputParser.fromZodSchema(schema);

/**
 * =========================================
 * Form D AI System Prompt - Optimized
 * =========================================
 */
const systemPrompt = `Extract Form D (Notice of Exempt Offering) data from XML.

Return JSON (use null for missing values):
{{
  "issuerName": "<company name>",
  "issuerCIK": "<CIK or null>",
  "industryGroup": "<industry or null>",
  "issuerAddress": "<full address or null>",
  "issuerPhoneNumber": "<phone or null>",
  "issuerWebsite": null,
  "offeringType": "<Rule 506(b)|Rule 506(c) or null>",
  "totalOfferingAmount": "<amount or null>",
  "totalAmountSold": "<amount or null>",
  "dateOfFirstSale": "<YYYY-MM-DD or null>",
  "filingDate": "<YYYY-MM-DD or null>",
  "accessionNo": null,
  "relatedPersons": [
    {{
      "name": "<full name>",
      "entityType": "Individual|Company",
      "relationship": "<Executive Officer|Director|Promoter>",
      "address": "<full address or null>",
      "phoneNumber": null,
      "email": null,
      "title": "<job title or null>",
      "keyPeople": []
    }}
  ]
}}

XML Structure Guide:
<offeringData>
  <issuer>
    <issuerName> → issuerName
    <cik> → issuerCIK
    <industryGroupType> → industryGroup
    <issuerAddress>
      <street1>, <street2>, <city>, <stateOrCountry>, <zipCode> → issuerAddress (combine as: "street1, street2, city, state zipCode")
    <issuerPhoneNumber> → issuerPhoneNumber
  </issuer>
  <offeringSalesAmounts>
    <totalOfferingAmount> → totalOfferingAmount (if "Indefinite", keep as "Indefinite")
    <totalAmountSold> → totalAmountSold (convert to "$X")
  </offeringSalesAmounts>
  <federalExemptionsExclusions>
    <item> → offeringType (if "06b" = "Rule 506(b)", if "06c" = "Rule 506(c)")
  </federalExemptionsExclusions>
  <dateOfFirstSale> → dateOfFirstSale (convert MM/DD/YYYY to YYYY-MM-DD)
  <signatureBlock><signature><signatureDate> → filingDate (convert MM/DD/YYYY to YYYY-MM-DD)
  <relatedPersonsList>
    <relatedPersonInfo>
      <relatedPersonName> (firstName, middleName, lastName) → name (combine)
      <relatedPersonRelationshipList><relationship> → relationship (check for "Executive Officer", "Director", "Promoter")
      <relatedPersonAddress> → address (combine street1, city, stateOrCountry, zipCode)
    </relatedPersonInfo>
  </relatedPersonsList>
</offeringData>

Entity Type Rules:
- If name contains LP/LLC/Inc/Ltd/Corp/Fund/Capital/Partners/Holdings/Ventures/GP → "Company"
- Otherwise → "Individual"

Address Format:
- If street1 only: "street1, city, state zipCode"
- If street1 + street2: "street1, street2, city, state zipCode"
- Skip empty fields, use null if no address

Relationship Mapping:
- Look for "Executive Officer", "Director", "Promoter" in <relationship> tags
- Title: Use relatedPersonTitle if Individual (e.g., "Chief Executive Officer")

CRITICAL:
1. Extract ALL persons from <relatedPersonsList>
2. Use null (not empty string) for missing values
3. Don't try to guess/infer data - extract only what's in XML
4. Keep keyPeople empty [] unless you find actual associated people
5. For offering amounts, preserve "Indefinite" or "$0" exactly as shown

Return ONLY valid JSON.

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
 * Extract Form D data from raw XML string
 */
export async function extractFormDDataFromParsed(xmlString: string) {
  try {
    console.log("AI🤖 Processing Form D (XML parsing)...");
    console.log(`📊 XML size: ${xmlString.length} characters`);

    // Send raw XML to AI agent for extraction
    const result = await chain.invoke({
      xml: xmlString,
      format_instructions: parser.getFormatInstructions(),
    });

    // Post-process: Generate company name variants for the ISSUER company
    // (the company raising capital, not the related persons)
    result.relatedPersons = result.relatedPersons.map((person: any) => {
      person.companyNameVariants = generateCompanyNameVariants(result.issuerName);
      return person;
    });

    console.log(`✅ Extracted ${result.relatedPersons.length} related persons`);
    return result;
  } catch (err) {
    console.error("Error processing Form D data:", err);
    throw err;
  }
}

/**
 * =========================================
 * Map to Signal schema
 * =========================================
 */
export function mapFormDToSignals(parsed: any, raw: any) {
  return parsed.relatedPersons.map((r: any) => {
    const signalSource = r.entityType === "Individual" ? "Person" : "Company";

    // Base signal object
    const signal: any = {
      // Signal Classification
      signalSource,
      signalType: "form-d",

      // Filing Information
      filingType: "Form D",
      accession: parsed.accessionNo || raw.accession,
      filingDate: parsed.filingDate ? new Date(parsed.filingDate) : raw.filingDate,
      periodOfReport: parsed.dateOfFirstSale ? new Date(parsed.dateOfFirstSale) : undefined,
      dateOfEvent: parsed.dateOfFirstSale ? new Date(parsed.dateOfFirstSale) : undefined,

      // Issuer (Company raising capital)
      companyName: parsed.issuerName,
      companyCik: parsed.issuerCIK || undefined,

      // Related Person (Executive/Director/Promoter)
      fullName: r.name,
      designation: r.title || r.relationship,
      location: r.address || parsed.issuerAddress || undefined,
      phoneNumber: r.phoneNumber || parsed.issuerPhoneNumber || undefined,
      email: r.email || undefined,

      // Company name variations for ContactOut API matching
      companyNameVariants: r.companyNameVariants || [],

      // Form D specific fields (only include if not null)
      ...(parsed.offeringType && { offeringType: parsed.offeringType }),
      ...(parsed.totalOfferingAmount && { totalOfferingAmount: parsed.totalOfferingAmount }),
      ...(parsed.totalAmountSold && { totalAmountSold: parsed.totalAmountSold }),
      ...(parsed.industryGroup && { industryGroup: parsed.industryGroup }),

      // Source metadata
      sourceOfInformation: "SEC EDGAR - Form D",
      aiModelUsed: "gpt-4o-mini",
      filerType:
        r.entityType === "Individual"
          ? `${r.relationship}${r.title ? ` - ${r.title}` : ""}`
          : "Corporate Entity - Promoter/Related Company",

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

    // For Company signals - add key people if available
    if (signalSource === "Company" && r.keyPeople && r.keyPeople.length > 0) {
      signal.keyPeople = r.keyPeople.map((person: any) => ({
        fullName: person.name,
        designation: person.designation || undefined,
        phoneNumber: person.phoneNumber || undefined,
        email: person.email || undefined,
        sourceOfInformation: "SEC Form D Filing",
        dateAdded: new Date(),
        lastUpdated: new Date(),
      }));
    }

    // For Individual signals - set relationship info
    if (signalSource === "Person") {
      signal.insiderName = r.name;
      signal.insiderRole = r.title || r.relationship;

      // Parse relationship to set flags
      const relationship = r.relationship?.toLowerCase() || "";
      const title = r.title?.toLowerCase() || "";
      signal.insiderRelationship = {
        isDirector: relationship.includes("director"),
        isOfficer:
          relationship.includes("officer") ||
          relationship.includes("executive") ||
          title.includes("chief") ||
          title.includes("officer") ||
          title.includes("president") ||
          title.includes("ceo") ||
          title.includes("cfo"),
        isTenPercentOwner: false,
        officerTitle: r.title || r.relationship,
      };
    }

    return signal;
  });
}
