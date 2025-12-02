import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { generateCompanyNameVariants } from "../../../../helpers/Form13XMLParser.js";

/**
 * =========================================
 * Form 13F Schema - Institutional Investment Manager Holdings
 * =========================================
 * Form 13F is filed quarterly by institutional investment managers with over $100M AUM
 * to disclose their equity holdings. This parser focuses on:
 * - Investment manager (filer) information and contact details
 * - Key holdings (positions) to identify investment patterns
 * - Contact information for lead generation
 */

const holdingSchema = z.object({
  issuerName: z.string().describe("Name of company held"),
  ticker: z.string().optional().describe("Stock ticker symbol (e.g., AAPL, MSFT, TSLA)"),
  cusip: z.string().optional().describe("CUSIP identifier"),
  value: z.string().optional().describe("Total value of holding in dollars"),
  shares: z.string().optional().describe("Number of shares held"),
  votingAuthority: z.string().optional().describe("Sole, Shared, or None"),
  investmentDiscretion: z.string().optional().describe("Sole, Shared, or None"),
});

const schema = z.object({
  // Filing Manager Information (the institutional investor)
  managerName: z.string().describe("Name of institutional investment manager filing the 13F"),
  managerCik: z.string().optional(),
  managerAddress: z.string().optional().describe("Full address as single string"),
  managerCity: z.string().optional(),
  managerState: z.string().optional(),
  managerZipCode: z.string().optional(),

  // Contact Information (HIGH VALUE for lead generation)
  reportContactName: z.string().optional().describe("Name of person to contact about this report"),
  reportContactTitle: z.string().optional(),
  reportContactPhone: z.string().optional(),
  reportContactEmail: z.string().optional(),

  // Document Metadata
  formType: z.string().describe("13F-HR or 13F-HR/A"),
  filingDate: z.string().describe("Date of filing (YYYY-MM-DD)"),
  periodOfReport: z.string().describe("Quarter end date (YYYY-MM-DD)"),
  accessionNo: z.string().optional(),
  amendmentNumber: z.string().optional().describe("Amendment number if 13F-HR/A"),
  amendmentType: z.string().optional().describe("NEW, RESTATEMENT, or blank"),

  // Portfolio Summary
  tableEntryTotal: z.string().optional().describe("Total number of holdings"),
  tableValueTotal: z.string().optional().describe("Total value of all holdings in dollars"),

  // Key Holdings (Top positions for investment strategy analysis)
  topHoldings: z.array(holdingSchema).optional().describe("Top 5-10 holdings by value"),

  // Other Managers (if multiple managers included)
  otherManagers: z
    .array(
      z.object({
        name: z.string(),
        cik: z.string().optional(),
      }),
    )
    .optional()
    .describe("Other included managers if filing is for multiple entities"),
});

const parser = StructuredOutputParser.fromZodSchema(schema);

/**
 * =========================================
 * Form 13F AI System Prompt
 * =========================================
 */
const systemPrompt = `You are a precise Form 13F parser focused on extracting institutional investment manager data for B2B lead generation.

Form 13F is filed quarterly by institutional investment managers (hedge funds, mutual funds, pension funds) with over $100M in assets under management (AUM). Your job is to extract:
1. Investment manager information (filer) and contact details
2. Portfolio summary statistics
3. Top holdings to understand investment strategy
4. Contact information for potential outreach

Return JSON:
{{
  "managerName": "<name of investment manager/firm>",
  "managerCik": "<CIK>",
  "managerAddress": "<full street address>",
  "managerCity": "<city>",
  "managerState": "<state>",
  "managerZipCode": "<zip>",
  "reportContactName": "<contact person name>",
  "reportContactTitle": "<contact title/position>",
  "reportContactPhone": "<phone>",
  "reportContactEmail": "<email>",
  "formType": "13F-HR|13F-HR/A",
  "filingDate": "<YYYY-MM-DD>",
  "periodOfReport": "<YYYY-MM-DD>",
  "accessionNo": "<accession number>",
  "amendmentNumber": "<amendment number if applicable>",
  "amendmentType": "NEW|RESTATEMENT|blank",
  "tableEntryTotal": "<number of holdings>",
  "tableValueTotal": "<total portfolio value in dollars>",
  "topHoldings": [
    {{
      "issuerName": "<company name>",
      "ticker": "<stock ticker symbol>",
      "cusip": "<CUSIP>",
      "value": "<holding value>",
      "shares": "<number of shares>",
      "votingAuthority": "Sole|Shared|None",
      "investmentDiscretion": "Sole|Shared|None"
    }}
  ],
  "otherManagers": [
    {{
      "name": "<other manager name>",
      "cik": "<CIK>"
    }}
  ]
}}

EXTRACTION RULES:

1. MANAGER INFORMATION (Filer):
   - managerName: Extract from <name> in <filerInfo> or <filingManager><name>
   - managerCik: Extract from <cik> in filerInfo or header
   - Address fields: Extract from <address> tags in filerInfo
     * managerAddress: <street1> (and <street2> if exists)
     * managerCity: <city>
     * managerState: <stateOrCountry>
     * managerZipCode: <zipCode>

2. CONTACT INFORMATION (HIGH PRIORITY):
   - reportContactName: Extract from <reportingManager><name> or <contactPerson>
   - reportContactTitle: Extract from <title> in reportingManager section
   - reportContactPhone: Extract from <phone> or <phoneNumber> in reportingManager/contactInfo
   - reportContactEmail: Extract from <email> or <emailAddress> in reportingManager/contactInfo
   - IMPORTANT: Look in signature sections and notificationInfo sections for additional contacts

3. DOCUMENT METADATA:
   - formType: Extract from <submissionType> or <formType> (13F-HR, 13F-HR/A)
   - filingDate: Extract from <filingDate> or <acceptanceDatetime> (convert MM/DD/YYYY to YYYY-MM-DD)
   - periodOfReport: Extract from <periodOfReport> (convert MM/DD/YYYY to YYYY-MM-DD)
   - accessionNo: Extract from <accessionNumber>
   - amendmentNumber: Extract from <amendmentNumber> if form is 13F-HR/A
   - amendmentType: Extract from <amendmentType>

4. PORTFOLIO SUMMARY:
   - tableEntryTotal: Extract from <tableEntryTotal> (total number of holdings)
   - tableValueTotal: Extract from <tableValueTotal> (total portfolio value)

5. TOP HOLDINGS (Extract top 5-10 by value):
   - Look for <infoTable> entries or <informationTable><infoTable>
   - For each holding extract:
     * issuerName: <nameOfIssuer>
     * ticker: Leave blank (ticker mapping handled separately via OpenFIGI API)
     * cusip: <cusip>
     * value: <value> (in dollars x 1000)
     * shares: <sshPrnamt> or <shrsOrPrnAmt><sshPrnamt>
     * votingAuthority: Check <votingAuthority><Sole>, <Shared>, <None>
     * investmentDiscretion: <investmentDiscretion>

6. OTHER MANAGERS:
   - Extract from <otherManagers> or <otherIncludedManagers> sections
   - Get name and CIK for each

IMPORTANT NOTES:
- Focus on extracting contact information - this is the highest value data
- Form 13F uses XML format with specific namespaces
- Portfolio values are often in thousands (multiply by 1000)
- The reportContactName is critical for B2B outreach
- Amendment forms (13F-HR/A) indicate changes to previous filings
- Common filers: BlackRock, Vanguard, Berkshire Hathaway, hedge funds, pension funds
- TICKER SYMBOLS: Do NOT attempt to guess or populate ticker fields
  * Ticker mapping is handled separately via OpenFIGI API for accuracy
  * CUSIPs are unique 9-character identifiers used for ticker lookup
  * Leave ticker field blank - it will be populated by the API-based lookup

Return only valid JSON matching the schema.

{format_instructions}`;

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
 * Extract Form 13F data from raw XML string
 */
export async function extract13FDataFromParsed(xmlString: string) {
  try {
    console.log("AI🤖 Processing Form 13F Holdings Report...");
    console.log(`📊 XML size: ${xmlString.length} characters`);

    // Send raw XML to AI agent for extraction
    const result = await chain.invoke({
      xml: xmlString,
      format_instructions: parser.getFormatInstructions(),
    });

    // Post-process: Generate company name variants for the investment manager
    const enrichedResult = {
      ...result,
      companyNameVariants: generateCompanyNameVariants(result.managerName),
    };

    console.log(`✅ Extracted Form 13F data for ${result.managerName}`);
    console.log(`   Period: ${result.periodOfReport}`);
    console.log(`   Total Holdings: ${result.tableEntryTotal || "N/A"}`);
    console.log(`   Portfolio Value: ${result.tableValueTotal || "N/A"}`);
    console.log(`   Top Holdings: ${result.topHoldings?.length || 0}`);
    if (result.reportContactName) {
      console.log(
        `   Contact: ${result.reportContactName} (${result.reportContactPhone || "no phone"})`,
      );
    }

    return enrichedResult;
  } catch (err) {
    console.error("Error processing Form 13F data:", err);
    throw err;
  }
}
