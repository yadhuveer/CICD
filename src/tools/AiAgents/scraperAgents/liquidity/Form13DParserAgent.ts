import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { generateCompanyNameVariants } from "../../../../helpers/Form13XMLParser.js";

/**
 * =========================================
 * Lightweight Schema - Core Data Only
 * =========================================
 */
const schema = z.object({
  issuerName: z.string(),
  issuerCIK: z.string().nullable().optional(),
  issuerCUSIP: z.string().nullable().optional(),
  issuerTickerSymbol: z.string().nullable().optional(),
  formType: z.string(), // SC 13D / SC 13G / SC 13D/A / SC 13G/A

  dateOfEvent: z.string(), // Date when 5% threshold was crossed
  filingDate: z.string().nullable().optional(),
  accessionNo: z.string().nullable().optional(),

  // Item 3: Source and Amount of Funds
  sourceOfFunds: z.string().nullable().optional(),
  purposeOfTransaction: z.string().nullable().optional(),

  // Item 4: Purpose of Transaction / Plans or Proposals
  plansOrProposals: z.string().nullable().optional(),

  // Joint filing information
  jointFilingGroup: z.array(z.string()).nullable().optional(),

  // Primary investor identification (for consolidation)
  primaryInvestor: z.string().nullable().optional(), // Main decision-maker name
  investmentFirm: z.string().nullable().optional(), // Firm/fund name making the investment
  controllingPerson: z.string().nullable().optional(), // Person who controls decisions
  isPrimaryInvestorPerson: z.boolean().nullable().optional(), // true if person, false if company

  reportingPersons: z.array(
    z.object({
      name: z.string(),
      entityType: z.string(), // Accept any string, normalize in post-processing
      cik: z.string().nullable().optional(),
      citizenship: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      phoneNumber: z.string().nullable().optional(),
      email: z.string().nullable().optional(),

      // Ownership details
      percent: z.string().nullable().optional(),
      previousPercent: z.string().nullable().optional(), // For amendments
      shares: z.string().nullable().optional(),
      previousShares: z.string().nullable().optional(), // For amendments

      // Voting and dispositive power
      votingPower: z.string().nullable().optional(),
      dispositivePower: z.string().nullable().optional(),
      soleVotingPower: z.string().nullable().optional(),
      sharedVotingPower: z.string().nullable().optional(),
      soleDispositivePower: z.string().nullable().optional(),
      sharedDispositivePower: z.string().nullable().optional(),

      // Company-specific information (ONLY for entityType="Company")
      // These represent the people working at/representing the reporting company
      keyPeople: z
        .array(
          z.object({
            name: z.string(),
            designation: z.string().nullable().optional(), // e.g., "Managing Member", "CEO", "CFO"
            relationship: z.string().nullable().optional(), // e.g., "Signer", "Authorized Representative", "Director"
            phoneNumber: z.string().nullable().optional(),
            email: z.string().nullable().optional(),
            address: z.string().nullable().optional(),
          }),
        )
        .nullable()
        .optional(),

      // Company profile (ONLY for entityType="Company")
      companyIndustry: z.string().nullable().optional(),
      companyWebsite: z.string().nullable().optional(),
      companyDescription: z.string().nullable().optional(),
    }),
  ),
});

const parser = StructuredOutputParser.fromZodSchema(schema);

/**
 * =========================================
 * Enhanced AI System Prompt - Tax Planning Focus
 * =========================================
 */
const systemPrompt = `Extract Schedule 13D/G data from XML with focus on identifying LIQUIDITY EVENTS and TAX PLANNING TARGETS.

CRITICAL: For joint filings, identify the PRIMARY INVESTOR (main decision-maker) to avoid duplicate signals.

BUSINESS CONTEXT: We provide tax planning services. Our ideal clients are people/entities GETTING MONEY from selling or reducing their stakes.

Return JSON:
{{
  "issuerName": "<company being invested IN - the target>",
  "issuerCIK": "<CIK>",
  "issuerCUSIP": "<CUSIP>",
  "issuerTickerSymbol": "<ticker>",
  "formType": "SC 13D|SC 13G|SC 13D/A|SC 13G/A",
  "amendmentNo": "<amendment number if /A>",
  "dateOfEvent": "<YYYY-MM-DD>",
  "filingDate": "<YYYY-MM-DD>",
  "accessionNo": "<accession>",
  "prevAccessionNo": "<previous accession if amendment>",

  "sourceOfFunds": "<Item 3>",
  "purposeOfTransaction": "<Item 3>",
  "plansOrProposals": "<Item 4>",
  "jointFilingGroup": ["<all joint filer names>"],

  "primaryInvestor": "<MAIN decision-maker name>",
  "investmentFirm": "<Fund/firm name making investment>",
  "controllingPerson": "<Person who controls if applicable>",
  "isPrimaryInvestorPerson": true/false,

  "reportingPersons": [
    {{
      "name": "<name>",
      "entityType": "Individual|Company",
      "cik": "<CIK>",
      "citizenship": "<state/country>",
      "address": "<address>",
      "phoneNumber": "<phone>",
      "email": "<email>",
      "percent": "<%>",
      "previousPercent": "<%>",
      "shares": "<number>",
      "previousShares": "<number>",
      "votingPower": "Sole|Shared|None",
      "dispositivePower": "Sole|Shared|None",
      "soleVotingPower": "<number>",
      "sharedVotingPower": "<number>",
      "soleDispositivePower": "<number>",
      "sharedDispositivePower": "<number>",

      // ONLY for entityType="Company":
      "keyPeople": [
        {{
          "name": "<individual person name>",
          "designation": "<Managing Member|CEO|CFO|Partner|etc>",
          "relationship": "<Signer|Authorized Representative|Director|Officer>",
          "phoneNumber": "<phone>",
          "email": "<email>",
          "address": "<address if available>"
        }}
      ],
      "companyIndustry": "<Private Equity|Venture Capital|Hedge Fund|Investment Management|Asset Management>",
      "companyWebsite": "<website if available>",
      "companyDescription": "<brief description>"
    }}
  ]
}}

EXTRACTION RULES:

1. ISSUER INFORMATION (Company being invested in):
   - issuerName: <issuerName> or <issuerInfo><issuerName>
   - issuerCIK: <issuerCIK> or <issuerInfo><issuerCIK>
   - issuerCUSIP: <issuerCUSIP> or <issuerInfo><issuerCUSIP>
   - issuerTickerSymbol: <issuerTickerSymbol> or any ticker symbol mentioned

2. FILING TYPE & DATES:
   - formType: <submissionType> (SC 13D, SC 13G, SC 13D/A, SC 13G/A)
   - amendmentNo: <amendmentNo> if present
   - dateOfEvent: <dateOfEvent> (convert MM/DD/YYYY to YYYY-MM-DD)
   - filingDate: Latest <signatureDetails><date> (convert MM/DD/YYYY to YYYY-MM-DD)
   - accessionNo: <accessionNumber> or extract from XML header
   - prevAccessionNo: <previousFilingAccessionNo> if amendment

3. ITEM 3 - SOURCE & PURPOSE (CRITICAL FOR LIQUIDITY DETECTION):
   - sourceOfFunds: Look for "Item 3" or <sourceOfFunds> - where money came from (personal funds, loan, sale of assets, etc.)
   - purposeOfTransaction: Look for "Item 3" or <purposeOfTransaction> - investment, control, etc.
   - If amendment and ownership DECREASED: likely selling/liquidating (HIGH PRIORITY TARGET)

4. ITEM 4 - PLANS OR PROPOSALS (For activist 13D):
   - plansOrProposals: Look for "Item 4" or <plansOrProposals>
   - Extract: plans for M&A, board representation, asset sales, strategic changes
   - This indicates potential FUTURE liquidity events

5. ITEM 5 - JOINT FILING:
   - jointFilingGroup: All members of group if filing jointly
   - Look for <jointFiling> or "Item 5" section

5.5. PRIMARY INVESTOR IDENTIFICATION (CRITICAL - Avoid Duplicate Signals):
   ANALYZE ALL REPORTING PERSONS TO FIND THE MAIN DECISION-MAKER:


   If JOINT FILING (multiple reporting persons with SAME % ownership):
   a) Look for Item 2 describing relationships between reporting persons
   b) Identify hierarchy:
      - Who is the general partner/managing member?
      - Who controls voting/dispositive decisions?
      - Find the ULTIMATE CONTROLLING PERSON

   EXAMPLE PATTERNS:
   - "Fund LP" → controlled by → "Fund GP LLC" → controlled by → "John Doe" (managing member)
     * primaryInvestor: "John Doe" OR "Fund LP" (whichever makes investment decisions)
     * investmentFirm: "Fund LP" (the fund name)
     * controllingPerson: "John Doe" (the person)
     * isPrimaryInvestorPerson: true if creating signal for John Doe, false if for Fund LP

   - Multiple funds + GP entities filing together:
     * Look for the PERSON who is managing member of all GPs
     * OR identify the LARGEST FUND making the primary investment
     * primaryInvestor: The fund or person making decisions
     * investmentFirm: Main fund name
     * controllingPerson: Managing member name

   DECISION LOGIC:
   - If one PERSON controls multiple entities → use PERSON as primaryInvestor
   - If one FUND is making direct investment → use FUND as primaryInvestor
   - investmentFirm = the fund/firm name (NOT the issuer!)
   - controllingPerson = the individual who controls (if applicable)

6. REPORTING PERSONS (Investors):
   For each <reportingPersonInfo> or reporting person section:

   a) Entity Classification:
      - entityType: "Company" if name contains: LP, LLC, L.L.C., INC, CORP, FUND, CAPITAL, PARTNERS, HOLDINGS, LIMITED, LTD, MANAGEMENT, INVESTMENTS, GROUP
      - Otherwise "Individual"

   b) Ownership Details:
      - percent: <percentOfClass>
      - previousPercent: <previousPercentOfClass> or from previous filing text
      - shares: <aggregateAmountOwned> or <sharesOwned>
      - previousShares: <previousSharesOwned> or from previous filing reference
      - CRITICAL: If previousPercent > percent = SELLING (tax planning target!)

   c) Voting & Dispositive Power:
      - votingPower: "Sole" if sole>shared, "Shared" if shared>sole, "None" if both 0
      - dispositivePower: "Sole" if sole>shared, "Shared" if shared>sole, "None" if both 0
      - soleVotingPower: <soleVotingPower>
      - sharedVotingPower: <sharedVotingPower>
      - soleDispositivePower: <soleDispositivePower>
      - sharedDispositivePower: <sharedDispositivePower>

   d) Contact Information:
      - phoneNumber: Match name in <authorizedPersons><notificationInfo><personName> → <personPhoneNum>
      - email: Match name in <authorizedPersons><notificationInfo><personName> → <personEmail>
      - address: Combine street, city, state, zip from <personAddress> or <reportingPersonAddress>
      - ALSO check <signatureBlock> for contact info

   e) Key People (ONLY for entityType="Company"):
      CRITICAL: When the reporting person is a COMPANY, extract ALL people associated with it:

      SOURCES to check:
      - <signatureDetails> / <signaturePerson>: Extract name, title/designation
      - <authorizedPersons> / <notificationInfo>: Extract personName, personPhoneNum, personEmail
      - <reportingOwnerSignature>: Look for individual signers
      - Any sections mentioning "Managing Member", "General Partner", "CEO", "CFO", "Director", "Authorized Representative"

      For EACH person found, capture:
      - name: Full name of the individual
      - designation: Their title/role (e.g., "Managing Member", "CEO", "CFO", "Director", "Partner")
      - relationship: How they relate to the filing (e.g., "Signer", "Authorized Representative", "Director", "Officer")
      - phoneNumber: From <personPhoneNum> or contact sections
      - email: From <personEmail> or contact sections
      - address: If individual address is provided separately

      IMPORTANT: These are the PEOPLE who work at or represent the REPORTING COMPANY (the investor).
      They are NOT the issuer company's people!

   f) Company Profile (ONLY for entityType="Company"):
      - companyIndustry: Infer from company name, description, or filing context (e.g., "Private Equity", "Venture Capital", "Hedge Fund", "Investment Management", "Asset Management")
      - companyWebsite: If mentioned in XML or can be inferred
      - companyDescription: Brief description of the investment firm/company

CRITICAL FOR TAX PLANNING:
- If this is an AMENDMENT (/A) and previousPercent > percent → SELLING/LIQUIDATING → HIGH PRIORITY
- Extract previous ownership % from any reference to prior filings
- Look for language like "disposed of", "sold", "distributed", "reduced position"

Return ONLY valid JSON matching the schema. No additional text.

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
 * Extract Form 13D/G data from raw XML string (lightweight approach)
 */
export async function extractForm13DataFromParsed(xmlString: string) {
  try {
    console.log("AI🤖 Processing Schedule 13D/G (lightweight XML parsing)...");
    console.log(`📊 XML size: ${xmlString.length} characters`);

    // Send raw XML to AI agent for extraction (much smaller than JSON)
    const result = await chain.invoke({
      xml: xmlString,
      format_instructions: parser.getFormatInstructions(),
    });

    // Post-process: Normalize entity types and generate company name variants
    // IMPORTANT: For Form 13D/G, companyNameVariants should be variations of the ISSUER company
    // (the company being invested in), NOT the investor/reporting person's name
    result.reportingPersons = result.reportingPersons.map((person: any) => {
      // Normalize entityType: LP, LLC, INC, CORP, etc. → "Company", otherwise → "Individual"
      const entityType = person.entityType || "";
      const companyKeywords = [
        "LP",
        "L.P.",
        "LLC",
        "L.L.C.",
        "INC",
        "CORP",
        "CORPORATION",
        "FUND",
        "CAPITAL",
        "PARTNERS",
        "HOLDINGS",
        "LIMITED",
        "LTD",
        "MANAGEMENT",
        "INVESTMENTS",
        "GROUP",
        "TRUST",
        "COMPANY",
      ];
      const isCompany =
        entityType === "Company" ||
        companyKeywords.some((keyword) => entityType.toUpperCase().includes(keyword.toUpperCase()));

      person.entityType = isCompany ? "Company" : "Individual";
      person.companyNameVariants = generateCompanyNameVariants(result.issuerName);
      return person;
    });

    console.log(`✅ Extracted ${result.reportingPersons.length} reporting persons`);
    return result;
  } catch (err) {
    console.error("Error processing Form 13 data:", err);
    throw err;
  }
}

/**
 * =========================================
 * Map to NEW Signal schema (SignalNew model)
 * =========================================
 * CREATES ONE SIGNAL PER FILING (not per reporting person)
 */
export function mapForm13ToNewSignals(parsed: any, raw: any) {
  // STRICT CLASSIFICATION: Determine if this should be a Person or Company signal
  // Rule: ONLY create Person signal if we have a real person name, otherwise always create Company signal

  const investmentFirm = parsed.investmentFirm || parsed.reportingPersons[0]?.name || "";
  const controllingPerson = parsed.controllingPerson || "";

  // Check if we should create a Person signal
  // Requirements: Must have controlling person AND AI explicitly marked as person
  const hasValidPerson = controllingPerson.trim() !== "" && parsed.isPrimaryInvestorPerson === true;

  const signalSource: "Person" | "Company" = hasValidPerson ? "Person" : "Company";

  // Set entity name and find corresponding data
  let fullName: string;
  let primaryReportingPerson: any;

  if (signalSource === "Person") {
    // Person signal: fullName = person's name
    fullName = controllingPerson;
    // Try to find this person in reporting persons (unlikely, usually companies file)
    primaryReportingPerson = parsed.reportingPersons.find((r: any) => r.name === fullName);

    // If person not in reporting persons, use first company's data for ownership info
    if (!primaryReportingPerson) {
      primaryReportingPerson = parsed.reportingPersons[0];
      console.log(
        `ℹ️  Person signal for ${fullName}, using ${primaryReportingPerson?.name} for ownership data`,
      );
    }
  } else {
    // Company signal: fullName = company/fund name
    fullName = investmentFirm;
    // Find this company in reporting persons
    primaryReportingPerson =
      parsed.reportingPersons.find((r: any) => r.name === fullName) || parsed.reportingPersons[0];
  }

  // Validate we have data
  if (!primaryReportingPerson || !fullName) {
    console.warn("⚠️  No valid entity data found, skipping signal creation");
    return [];
  }

  const r = primaryReportingPerson;

  // Map formType to new signal type enum
  const signalTypeMap: Record<string, string> = {
    "SCHEDULE 13D": "form-13d",
    "SCHEDULE 13D/A": "form-13da",
    "SCHEDULE 13G": "form-13g",
    "SCHEDULE 13G/A": "form-13ga",
    "SC 13D": "form-13d",
    "SC 13D/A": "form-13da",
    "SC 13G": "form-13g",
    "SC 13G/A": "form-13ga",
  };

  const filingType = signalTypeMap[parsed.formType] || "form-13d";
  const isAmendment = parsed.formType.includes("/A");
  const is13D = parsed.formType.includes("13D");

  // ===================================
  // TRANSACTION ANALYSIS - Identify Liquidity Events
  // ===================================
  let transactionType: string = "unknown";
  let ownershipChange = "";
  let isLiquidityEvent = false;
  let potentialTaxPlanningTarget = false;

  if (isAmendment && r.previousPercent && r.percent) {
    const prevPct = parseFloat(r.previousPercent.replace("%", ""));
    const currPct = parseFloat(r.percent.replace("%", ""));

    if (!isNaN(prevPct) && !isNaN(currPct)) {
      const change = currPct - prevPct;
      ownershipChange = change > 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;

      if (currPct < 1) {
        transactionType = "full-liquidation";
        isLiquidityEvent = true;
        potentialTaxPlanningTarget = true; // HIGH PRIORITY
      } else if (change < -1) {
        transactionType = "decreased-stake";
        isLiquidityEvent = true;
        potentialTaxPlanningTarget = true; // HIGH PRIORITY
      } else if (change > 1) {
        transactionType = "increased-stake";
      } else if (change < 0) {
        transactionType = "decreased-stake";
        isLiquidityEvent = true;
        potentialTaxPlanningTarget = true;
      } else {
        transactionType = "increased-stake";
      }
    }
  } else if (!isAmendment) {
    transactionType = "initial-purchase";
  }

  // Calculate approximate transaction value if shares available
  let shareValueEstimate = "";
  if (r.shares && r.previousShares && isLiquidityEvent) {
    const sharesSold =
      parseInt(r.previousShares.replace(/,/g, "")) - parseInt(r.shares.replace(/,/g, ""));
    if (sharesSold > 0) {
      shareValueEstimate = `~${(sharesSold / 1000000).toFixed(1)}M shares liquidated`;
    }
  }

  // ===================================
  // DESIGNATION & SIGNAL INDICATOR
  // ===================================
  let designation = "";
  let signalIndicator = "";

  if (isLiquidityEvent) {
    designation = signalSource === "Person" ? "Liquidating Investor" : "Liquidating Institution";
    signalIndicator =
      transactionType === "full-liquidation"
        ? "Full Liquidation Event - HIGH PRIORITY Tax Planning Target"
        : "Partial Liquidation Event - Tax Planning Target";
  } else if (is13D && !isAmendment) {
    designation = signalSource === "Person" ? "Activist Investor" : "Activist Fund";
    signalIndicator = "Activist Investment - Monitor for Future M&A/Liquidity";
  } else if (is13D) {
    designation = signalSource === "Person" ? "Activist Investor" : "Activist Fund";
    signalIndicator = "Activist Position Change";
  } else {
    designation = signalSource === "Person" ? "Institutional Investor" : "Institutional Fund";
    signalIndicator = "Passive Investment Position";
  }

  // ===================================
  // GENERATE TARGETED INSIGHTS
  // ===================================
  let insights = "";

  if (isLiquidityEvent && transactionType === "full-liquidation") {
    insights = `🎯 HIGH PRIORITY TAX PLANNING TARGET: ${r.name} has FULLY LIQUIDATED their position in ${parsed.issuerName}, reducing from ${r.previousPercent || "N/A"} to ${r.percent || "N/A"} ownership. ${shareValueEstimate ? `Estimated ${shareValueEstimate}. ` : ""}This represents a significant liquidity event requiring immediate tax planning consultation for potential capital gains optimization.`;
  } else if (isLiquidityEvent && transactionType === "decreased-stake") {
    insights = `🎯 TAX PLANNING TARGET: ${r.name} is LIQUIDATING part of their stake in ${parsed.issuerName}, reducing from ${r.previousPercent || "N/A"} to ${r.percent || "N/A"} (${ownershipChange}). ${shareValueEstimate ? `${shareValueEstimate}. ` : ""}This partial liquidation suggests capital gains realization - excellent opportunity for tax planning services.`;
  } else if (is13D && !isAmendment && parsed.plansOrProposals) {
    insights = `📊 ACTIVIST POSITION: ${r.name} filed Schedule 13D acquiring ${r.percent || "N/A"} of ${parsed.issuerName} (${r.shares || "N/A"} shares). Plans: ${parsed.plansOrProposals}. ${parsed.purposeOfTransaction ? `Purpose: ${parsed.purposeOfTransaction}. ` : ""}Monitor for potential M&A or corporate action that may trigger future liquidity events for existing shareholders.`;
  } else if (is13D && !isAmendment) {
    insights = `📊 ACTIVIST POSITION: ${r.name} filed Schedule 13D acquiring ${r.percent || "N/A"} of ${parsed.issuerName} (${r.shares || "N/A"} shares) with ${r.votingPower || "unknown"} voting power. ${parsed.purposeOfTransaction ? `Purpose: ${parsed.purposeOfTransaction}. ` : ""}This activist filing signals potential corporate action - monitor for future liquidity opportunities.`;
  } else if (is13D && isAmendment && transactionType === "increased-stake") {
    insights = `📈 ACTIVIST INCREASING STAKE: ${r.name} increased position in ${parsed.issuerName} from ${r.previousPercent || "N/A"} to ${r.percent || "N/A"} (${ownershipChange}). ${parsed.plansOrProposals ? `Plans: ${parsed.plansOrProposals}. ` : ""}Continued accumulation may signal upcoming M&A or strategic changes.`;
  } else if (!isAmendment) {
    insights = `${r.name} (${r.entityType}) filed ${parsed.formType} for ${parsed.issuerName}, disclosing ${r.percent || "N/A"} ownership (${r.shares || "N/A"} shares) with ${r.votingPower || "unknown"} voting power. ${is13D ? "This activist filing may signal potential corporate action or strategic involvement." : "This institutional filing indicates significant passive investment position."}`;
  } else {
    insights = `${r.name} amended their ${is13D ? "activist" : "passive"} position in ${parsed.issuerName}: ${r.percent || "N/A"} ownership (${r.shares || "N/A"} shares). ${ownershipChange ? `Change: ${ownershipChange}. ` : ""}${parsed.purposeOfTransaction ? `Purpose: ${parsed.purposeOfTransaction}.` : ""}`;
  }

  // Base signal object matching newSignal interface
  const newSignal: any = {
    // Required fields
    signalSource, // "Person" | "Company"
    signalType: filingType,
    filingType: filingType as any, // matches filingTypeEnum
    fullName: r.name,

    // Filing information
    filingLink: raw.filingLink,
    filingDate: parsed.filingDate ? new Date(parsed.filingDate) : new Date(),

    // AI insights
    insights: insights,
    signalIndicator: signalIndicator,
    aiModelUsed: "gpt-4o-mini",

    // Person/Entity information
    designation: designation,
    location: r.address || "",

    // Company information - INVESTOR's firm (NOT the target company!)
    companyName: investmentFirm || "", // Investor's firm/fund
    companyNameVariants: generateCompanyNameVariants(investmentFirm || fullName),
    companyTicker: "", // Investment firms are typically not public
    companyAddress: signalSource === "Company" ? r.address || "" : "",

    // Processing status
    processingStatus: "Processed",
    contactEnrichmentStatus: "pending",

    // Form 13 specific data - ENHANCED
    form13Data: {
      // Core ownership
      percentOfClass: r.percent || "",
      aggregateSharesOwned: r.shares || "",
      votingPower: (r.votingPower || "") as any,
      dispositivePower: (r.dispositivePower || "") as any,
      citizenshipOrOrganization: r.citizenship || "",
      dateOfEvent: parsed.dateOfEvent ? new Date(parsed.dateOfEvent) : new Date(),
      reportingGroup: parsed.jointFilingGroup || [r.name],

      // Target company information (NEW)
      issuerCompany: parsed.issuerName || "",
      issuerTicker: parsed.issuerTickerSymbol || "",
      issuerCIK: parsed.issuerCIK || "",

      // Investor information (NEW)
      primaryInvestor: fullName,
      investmentFirm: investmentFirm,
      controllingPerson: controllingPerson,

      // Transaction analysis
      transactionType: transactionType as any,
      previousOwnership: r.previousPercent || "",
      ownershipChange: ownershipChange,
      shareValueEstimate: shareValueEstimate,

      // Item 3, 4, 5
      purposeOfTransaction: parsed.purposeOfTransaction || "",
      sourceOfFunds: parsed.sourceOfFunds || "",
      plansOrProposals: parsed.plansOrProposals || "",
      jointFilers: parsed.jointFilingGroup || [],

      // Tax planning flags
      isLiquidityEvent: isLiquidityEvent,
      potentialTaxPlanningTarget: potentialTaxPlanningTarget,
      estimatedTaxableGain: potentialTaxPlanningTarget ? "Contact for assessment" : "",
    },
  };

  // For Company signals - add key people if available
  if (signalSource === "Company" && r.keyPeople && r.keyPeople.length > 0) {
    newSignal.keyPeople = r.keyPeople.map((person: any) => ({
      fullName: person.name,
      designation: person.designation || "",
      location: "", // Could be derived from address if needed
      relationship: person.relationship || "",
      phoneNumber: person.phoneNumber || "",
      email: person.email || "",
      address: person.address || "", // Now capturing individual's address if provided
      sourceOfInformation: "SEC Schedule 13D/G Filing",
      dateAdded: new Date(),
      lastUpdated: new Date(),
    }));
  }

  // For Company signals - add company profile information if available
  if (signalSource === "Company" && r.entityType === "Company") {
    // Add industry, website, description to form13Data if needed in the future
    // For now, these are captured in the parsed data but not stored in separate fields
    console.log(`   Company Industry: ${r.companyIndustry || "N/A"}`);
    console.log(`   Company Website: ${r.companyWebsite || "N/A"}`);
  }

  // Return array with ONE signal (not multiple)
  console.log(`✅ Creating 1 ${signalSource} signal: ${fullName} (firm: ${investmentFirm})`);
  return [newSignal];
}
