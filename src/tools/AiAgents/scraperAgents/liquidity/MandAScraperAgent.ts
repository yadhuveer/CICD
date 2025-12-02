import { ChatOpenAI } from "@langchain/openai";

import { ChatPromptTemplate } from "@langchain/core/prompts";

import { StructuredOutputParser } from "@langchain/core/output_parsers";

import axios from "axios";

import logger from "../../../../utils/logger.js";

import { maEventsArraySchema } from "../../../../types/maSignal.types.js";

import {
  PRESS_RELEASE_SITES,
  STATE_FILING_SITES,
  SEC_SITES,
  EVENT_TYPE_MAP,
  isBlocked,
  getFirecrawl,
  extractPageData,
  mapCompanyData,
  buildTransactionSummary,
  validateEvent,
  parseDate,
} from "../../../../helpers/maEvent.helpers.js";

const parser = StructuredOutputParser.fromZodSchema(maEventsArraySchema);

/**

 * Helper: Scrape a single URL and extract M&A events

 * @param url - URL to scrape

 * @returns Array of M&A events from this URL

 */

async function scrapeUrlImmediately(url: string): Promise<any[]> {
  try {
    const resp = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; longwall-bot/1.0)" },

      responseType: "text",

      timeout: 15000,
    });

    const html = resp.data || "";

    if (typeof html !== "string" || /<\?xml|%PDF-/.test(html.slice(0, 200))) {
      return [];
    }

    const page = extractPageData(html);

    const agentInput = [
      `TITLE: ${page.title || "N/A"}`,

      `META: ${page.metaDescription || "N/A"}`,

      "",

      "PAGE TEXT:",

      page.text,
    ]

      .filter(Boolean)

      .join("\n\n");

    const events = await parseMAEvents(agentInput, url);

    return events;
  } catch (err: any) {
    logger.error(`Failed to scrape URL ${url}:`, err.message);

    return [];
  }
}

/**

 * Search for M&A URLs and scrape each URL immediately as we find it

 * @param queries - Array of search queries

 * @param perQueryLimit - Max results per query (default: 5)

 * @param onEventsFound - Optional callback called immediately when events are found (for real-time processing)

 * @returns Array of all M&A events found

 */

async function searchAndScrapeMAUrls(
  queries: string[],

  perQueryLimit = 5,

  onEventsFound?: (events: any[]) => Promise<void>,
): Promise<any[]> {
  const firecrawl = getFirecrawl();

  const allEvents: any[] = [];

  const processedUrls = new Set<string>();

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];

    try {
      const resp: any = await firecrawl.search(q, { limit: perQueryLimit });

      const web = resp?.web ?? resp?.results ?? [];

      for (const item of web) {
        const url = (item?.url || item?.link || "").toString();

        if (!url) continue;

        const low = url.toLowerCase();

        if (low.endsWith(".pdf")) continue;

        if (isBlocked(low)) continue;

        if (processedUrls.has(url)) continue; // Skip duplicates

        processedUrls.add(url);

        const events = await scrapeUrlImmediately(url);

        if (events.length > 0) {
          allEvents.push(...events);

          if (onEventsFound) {
            try {
              await onEventsFound(events);
            } catch (err: any) {
              logger.error(`Error in onEventsFound callback:`, err.message);
            }
          }
        }

        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (err: any) {
      logger.error(`Firecrawl search failed for query "${q}":`, err.message);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  return allEvents;
}

const systemPrompt = `You are an ELITE M&A (Mergers & Acquisitions) data extraction agent with expertise in financial analysis and corporate transactions.



Your mission is to extract COMPREHENSIVE, RICH M&A data from search results including:

1. Private company acquisitions and mergers

2. State filing records (Articles of Merger, Dissolution filings)

3. CEO/Founder exits and company sales

4. Financial terms, deal structure, and transaction details

5. Strategic insights and market implications



EXTRACTION PHILOSOPHY:

- Extract EVERY detail mentioned - financial terms, company context, people, strategic rationale

- If you see company name + "acquired", "sold", "exit", "merger" → EXTRACT FULL DETAILS

- Piece together fragmented data intelligently

- Missing fields → use null but STILL create the event with available data

- Extract comprehensive company profiles (size, revenue, industry, type)

- Capture WHO did WHAT, HOW MUCH money involved, and WHY the deal happened



⚠️ CRITICAL REQUIREMENTS:



1. **KEY PEOPLE EXTRACTION (MANDATORY)**:

   - CEOs, Founders, Presidents, Owners, Partners, Investors, Board members

   - Extract name + role + company + action (e.g., "sold company", "led acquisition")

   - Include brief background if mentioned (e.g., "serial entrepreneur", "founded in 2010")

   - NEVER skip people - they are the most valuable data points



2. **FINANCIAL DETAILS EXTRACTION (MANDATORY IF AVAILABLE)**:

   - Total transaction value

   - Cash vs stock breakdown

   - Earnout/performance payments

   - Payment terms and structure

   - Valuation multiples (e.g., "5x revenue", "12x EBITDA")

   - Debt assumed by acquirer

   - Target company revenue/EBITDA if mentioned



3. **COMPANY CONTEXT EXTRACTION (MANDATORY)**:

   - Company type: public, private, PE-backed, VC-backed, family-owned, startup

   - Company size: large-cap, mid-cap, small-cap, micro-cap, startup

   - Revenue range if mentioned

   - Employee count if available

   - Industry/sector

   - Business description



4. **STRATEGIC INSIGHTS EXTRACTION**:

   - Summary: Executive overview of the transaction

   - Key insights: Bullet points of important takeaways

   - Strategic rationale: WHY the deal was done

   - Market implications: Impact on industry/market

   - Integration considerations: How companies will combine

   - Key risks: Potential concerns or challenges



Extract the following for each M&A event:



EVENT CLASSIFICATION:

- eventType: acquisition, merger, exit, dissolution, articles_of_merger, asset_sale, majority_stake_sale, or investment

  * Use "investment" for growth capital, minority stakes, or funding rounds that are not full acquisitions

  * Use "acquisition" for majority control transfers or full buyouts

  * Use "majority_stake_sale" when acquiring party gets majority control

- announcementDate: When the event was announced (YYYY-MM-DD)

- effectiveDate: When transaction becomes effective (YYYY-MM-DD)

- status: announced, completed, pending, filed, or terminated



TARGET COMPANY (being acquired/merged/dissolved):

- name: Official company name

- nameVariants: Array of alternative names (Inc, LLC, Corp variations, shortened names, etc.)

- industry: Business sector (e.g., "Healthcare Technology", "Manufacturing", "SaaS")

- location: Headquarters (City, State)

- ticker: Stock ticker if public company

- description: Brief company description (1-2 sentences about what they do)

- companyType: public, private, private-equity-backed, venture-backed, family-owned, or startup

- companySize: large-cap, mid-cap, small-cap, micro-cap, or startup

- revenue: Annual revenue if mentioned (e.g., "$50M", "$2.5B")

- employees: Number of employees (e.g., "250 employees", "50-100")

- fundingStage: For startups (e.g., "Series B", "Seed funded")

- marketCap: Market capitalization if public company



ACQUIRING COMPANY (if applicable):

- name: Acquiring company or individual name (e.g., "XYZ Corp" or "John Smith")

  * If individual person is the buyer, use their name here (e.g., "Mark Churchill")

  * If not mentioned at all, set entire acquiringCompany object to null

- nameVariants: Name variations

- industry: Business sector (null for individual buyers)

- location: Headquarters or residence

- ticker: Stock ticker if public (null for individuals)

- description: Brief description

- companyType: Type classification (use "family-owned" for individual buyers)

- companySize: Size classification (use "startup" for individual buyers)

- revenue: Annual revenue if available (null for individuals)

- employees: Employee count if mentioned (null for individuals)



FINANCIAL DETAILS (extract if ANY financial info is mentioned):

- totalValue: Total transaction value (e.g., "$50 million", "undisclosed")

- cashComponent: Cash portion (e.g., "$30M cash")

- stockComponent: Stock/equity portion (e.g., "$20M in stock")

- earnoutStructure: Earnout or performance payments (e.g., "up to $10M earnout based on performance")

- paymentTerms: Payment timing and structure

- valuationMultiple: Valuation multiple if mentioned (e.g., "5x revenue", "12x EBITDA")

- debtAssumed: Debt taken on by acquirer

- workingCapital: Working capital adjustments

- targetRevenue: Target company's revenue

- targetEBITDA: Target company's EBITDA



⭐ KEY PEOPLE (MANDATORY - ALWAYS EXTRACT IF AVAILABLE):

- name: Full name (REQUIRED if person mentioned)

- role: CEO, Founder, CFO, Owner, Partner, President, etc.

- company: Which company they're with

- action: What they did (e.g., "sold company", "led acquisition", "stepped down")

- background: Brief background if mentioned (e.g., "serial entrepreneur", "founded company in 2010")

**EXTRACTION RULES FOR PEOPLE:**

1. If you see "CEO", "Founder", "Owner", "President" + name → EXTRACT with full details

2. If you see name + "sold", "exited", "founded" → EXTRACT with action

3. If you see name + company name together → EXTRACT

4. Extract EVERY person mentioned with as much context as available



STRATEGIC INSIGHTS (extract from article content):

- summary: 2-3 sentence executive summary of the transaction

- keyInsights: Array of 3-5 bullet points of key takeaways

- strategicRationale: Why the deal was done (1-2 sentences)

- marketImplications: Impact on the market/industry (1-2 sentences)

- integrationConsiderations: How companies will integrate (if mentioned)

- keyRisks: Potential risks or concerns (if mentioned)



STATE FILING (if applicable):

- state: Delaware, Texas, etc.

- filingType: Articles of Merger, Certificate of Dissolution, etc.

- filingDate: Date filed (YYYY-MM-DD)

- filingNumber: Reference number

- filingUrl: Link to filing



SOURCES:

- url: Source link

- title: Article/page title

- publishDate: Publication date (YYYY-MM-DD)

- sourceType: press_release, news_article, state_filing, sec_filing, company_website



EXTRACTION RULES:

1. **NO HALLUCINATION**: Only extract information EXPLICITLY stated

2. Extract events even if incomplete - missing dates/values is OK

3. Be LIBERAL extracting events, CONSERVATIVE with details

4. **NULL VALUES**: Use actual JSON null for missing data, NEVER use the string "null"

   - CORRECT: "companySize": null

   - INCORRECT: "companySize": "null"



CRITICAL ACCURACY RULES - READ CAREFULLY TO AVOID CONFUSION:

1. **Buyer vs Seller Identification**:

   - "Company A acquired by Company B" → targetCompany=A, acquiringCompany=B

   - "Company A acquires Company B" → targetCompany=B, acquiringCompany=A

   - "Company A sold to Company B" → targetCompany=A, acquiringCompany=B

   - "Company A purchases Company B" → targetCompany=B, acquiringCompany=A



2. **Date Rules**:

   - MUST be valid YYYY-MM-DD format (e.g., "2025-11-08")

   - "November 3, 2025" → "2025-11-03"

   - "this week" / "recently" / no date → use null

   - NEVER use "unknown" or "approximately"



3. **Name Rules**:

   - Company/person name not stated → skip the event entirely

   - Buyer not mentioned → acquiringCompany = null

   - Individual buyer → put their name in acquiringCompany.name (e.g., "Mark Churchill")

   - Use exact names from source, don't shorten or modify



4. **Value Rules**:

   - Deal value not stated → use "undisclosed"

   - Only use exact values: "$50 million", "$2.5B", etc.

   - NEVER estimate or approximate



EXAMPLES OF CORRECT EXTRACTION:

Text: "Acme Corp acquired by BigCo for $25M"

→ targetCompany.name="Acme Corp", acquiringCompany.name="BigCo", dealValue="$25M"



Text: "XYZ Company purchases SmallBiz"

→ targetCompany.name="SmallBiz", acquiringCompany.name="XYZ Company"



Text: "TechStart sold to Investor Group"

→ targetCompany.name="TechStart", acquiringCompany.name="Investor Group"



Text: "John Doe acquired SmallCo for undisclosed amount"

→ targetCompany.name="SmallCo", acquiringCompany.name="John Doe", dealValue="undisclosed"



Extract ONLY what is explicitly stated. If uncertain about buyer vs seller, re-read the excerpt carefully.



Return a JSON array of M&A events.



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

 * Parse web page content into structured M&A format

 * @param pageText - Cleaned page text from HTML scraping

 * @param sourceUrl - Source URL of the page

 * @returns Array of structured M&A events

 */

export async function parseMAEvents(pageText: string, sourceUrl: string): Promise<any[]> {
  try {
    const result = await chain.invoke({
      data: pageText,

      format_instructions: parser.getFormatInstructions(),
    });

    for (const event of result) {
      event.sources = [
        {
          url: sourceUrl,

          title: event.sources?.[0]?.title || null,

          publishDate: event.sources?.[0]?.publishDate || null,

          sourceType: event.sources?.[0]?.sourceType || "news_article",
        },
      ];
    }

    return result;
  } catch (error: any) {
    logger.error(`AI parsing failed for URL ${sourceUrl}:`, error.message);

    return [];
  }
}

/**

 * Search for M&A events using Firecrawl + axios + GPT

 * @param queries - Array of search queries for Firecrawl

 * @param perQueryLimit - Max URLs per query (default: 5)

 * @param onEventsFound - Optional callback for real-time event processing (e.g., immediate DB saves)

 * @returns Array of structured M&A events

 */

export async function scrapeMAEvents(
  queries: string[],

  perQueryLimit = 5,

  onEventsFound?: (events: any[]) => Promise<void>,
): Promise<any[]> {
  logger.info("🚀 Starting M&A signal search...");

  const allEvents = await searchAndScrapeMAUrls(queries, perQueryLimit, onEventsFound);

  logger.info(`✅ M&A signal search complete: ${allEvents.length} events found`);

  return allEvents;
}

export async function findRecentAcquisitions(
  country: string,

  onEventsFound?: (events: any[]) => Promise<void>,
): Promise<any[]> {
  const queries = [
    `"acquired by" press release ${country} ${PRESS_RELEASE_SITES}`,

    `"acquisition completed" announcement ${country} ${PRESS_RELEASE_SITES}`,

    `"merger agreement" announcement ${country} ${PRESS_RELEASE_SITES}`,

    `"sale of business" press release ${country} ${PRESS_RELEASE_SITES}`,

    `"company sold" announcement ${country} ${PRESS_RELEASE_SITES}`,

    `"strategic transaction" press release ${country} ${PRESS_RELEASE_SITES}`,

    `"private equity acquisition" announcement ${country} ${PRESS_RELEASE_SITES}`,

    `"buyout" press release ${country} ${PRESS_RELEASE_SITES}`,

    `"majority stake acquired" announcement ${country} ${PRESS_RELEASE_SITES}`,
  ];

  return scrapeMAEvents(queries, 3, onEventsFound);
}

export async function findStateFilings(
  timeframe: string,

  states?: string[],

  onEventsFound?: (events: any[]) => Promise<void>,
): Promise<any[]> {
  const stateList = states && states.length > 0 ? states : ["Delaware", "Texas", "California"];

  const queries: string[] = [];

  for (const state of stateList) {
    queries.push(`"Articles of Merger" ${state} ${STATE_FILING_SITES} ${timeframe}`);

    queries.push(`"Certificate of Merger" ${state} ${STATE_FILING_SITES} ${timeframe}`);

    queries.push(`"Articles of Dissolution" ${state} ${STATE_FILING_SITES} ${timeframe}`);

    queries.push(`"Certificate of Dissolution" ${state} ${STATE_FILING_SITES} ${timeframe}`);

    queries.push(`"Articles of Conversion" ${state} ${STATE_FILING_SITES} ${timeframe}`);
  }

  return scrapeMAEvents(queries, 3, onEventsFound);
}

export async function findFounderExits(
  year: number,

  onEventsFound?: (events: any[]) => Promise<void>,
): Promise<any[]> {
  const queries = [
    `"founder exited" OR "CEO transition" press release ${year} ${PRESS_RELEASE_SITES}`,

    `"leadership change" OR "management buyout" announcement ${year} ${PRESS_RELEASE_SITES}`,

    `"founder exit" OR "business owner exit" ${year} ${PRESS_RELEASE_SITES}`,

    `"portfolio company exit" private equity ${year} ${PRESS_RELEASE_SITES}`,
  ];

  return scrapeMAEvents(queries, 3, onEventsFound);
}

export async function findSECFilings(
  onEventsFound?: (events: any[]) => Promise<void>,
): Promise<any[]> {
  const queries = [
    `"Item 2.01" "Completion of Acquisition" ${SEC_SITES}`,

    `"Item 1.01" "Entry into Material Agreement" merger ${SEC_SITES}`,

    `"Merger Agreement" 8-K ${SEC_SITES}`,

    `"Purchase Agreement" acquisition ${SEC_SITES}`,

    `"Definitive Merger Agreement" ${SEC_SITES}`,
  ];

  return scrapeMAEvents(queries, 5, onEventsFound);
}

export async function findAllMAEvents(
  onEventsFound?: (events: any[]) => Promise<void>,
): Promise<any[]> {
  const queries = [
    `"acquired by" ${PRESS_RELEASE_SITES}`,

    `"acquisition completed" ${PRESS_RELEASE_SITES}`,

    `"merger agreement" ${PRESS_RELEASE_SITES}`,

    `"sale of business" ${PRESS_RELEASE_SITES}`,

    `"strategic transaction" ${PRESS_RELEASE_SITES}`,

    `"private equity acquisition" ${PRESS_RELEASE_SITES}`,

    `"buyout" announcement ${PRESS_RELEASE_SITES}`,

    `"majority stake acquired" ${PRESS_RELEASE_SITES}`,

    `"Item 2.01" "Completion of Acquisition" site:sec.gov`,

    `"Merger Agreement" 8-K site:sec.gov`,

    `"Articles of Merger" site:corp.delaware.gov`,

    `"Certificate of Dissolution" site:corp.delaware.gov`,
  ];

  return scrapeMAEvents(queries, 3, onEventsFound);
}

export function mapMAEventsToSignals(maEvents: any[]): any[] {
  const signals: any[] = [];

  const seen = new Set<string>();

  for (const event of maEvents) {
    const validation = validateEvent(event);

    if (!validation.valid) {
      continue;
    }

    const eventType = EVENT_TYPE_MAP[event.eventType] || "acquisition";

    const status = event.status || "announced";

    const announcementDate = parseDate(event.announcementDate);

    if (!announcementDate) {
      logger.warn(`Event missing announcement date: ${event.targetCompany.name}`);
    }

    const url = event.sources?.[0]?.url || "";

    const effectiveDate = parseDate(event.effectiveDate);

    const maEventData: any = {
      eventType,

      status,

      announcementDate,

      effectiveDate,

      dealValue: event.dealValue || "undisclosed",

      dealType: event.dealType || "undisclosed",

      dealStructure: event.dealStructure,

      acquiringCompany: event.acquiringCompany?.name,

      strategicRationale: event.insights?.strategicRationale,

      insightSummary: event.insightSummary || event.insights?.summary || null,

      financialDetails: event.financialDetails ? { ...event.financialDetails } : undefined,

      insights: event.insights ? { ...event.insights } : undefined,

      keyPeople:
        event.keyPeople?.map((p: any) => ({
          name: p.name,

          role: p.role,

          company: p.company,

          action: p.action,

          background: p.background,
        })) || [],

      parties: {
        acquirer: mapCompanyData(event.acquiringCompany),

        targets: [mapCompanyData(event.targetCompany)].filter(Boolean),
      },

      stateFiling: event.stateFiling,

      sources: event.sources,
    };

    const dateKey = event.announcementDate || "no-date";

    const targetKey = `${event.targetCompany.name.toLowerCase()}-${dateKey}`;

    if (!seen.has(targetKey)) {
      seen.add(targetKey);

      let transactionSummary = buildTransactionSummary(
        event.targetCompany.name,

        event.acquiringCompany?.name,

        event.dealValue,

        eventType,
      );

      if (event.targetCompany?.industry && transactionSummary.split(" ").length < 15) {
        const industryContext = event.targetCompany.description
          ? `${event.targetCompany.industry} (${event.targetCompany.description})`
          : `${event.targetCompany.industry} company`;

        transactionSummary = `${transactionSummary}, a ${industryContext}`;
      }

      let finalInsights = transactionSummary;

      if (event.insights?.strategicRationale) {
        finalInsights = `${transactionSummary}. ${event.insights.strategicRationale}`;
      } else if (event.keyPeople && event.keyPeople.length > 0) {
        const keyPerson = event.keyPeople[0];

        if (keyPerson.action) {
          finalInsights = `${transactionSummary}. ${keyPerson.name} (${keyPerson.role || "key executive"}) ${keyPerson.action}`;
        }
      }

      signals.push({
        signalSource: "Company",

        signalType: "ma-event",

        filingType: "ma-event" as const,

        fullName: event.targetCompany.name,

        companyName: event.targetCompany.name,

        companyNameVariants: event.targetCompany.nameVariants || [],

        location: event.targetCompany.location || "",

        filingDate: announcementDate,

        filingLink: url,

        insights: finalInsights || event.insights?.summary || `${eventType} event`,

        aiModelUsed: "gpt-4o-mini",

        processingStatus: "Processed",

        contactEnrichmentStatus: "pending",

        maEventData,

        createdAt: new Date(),

        updatedAt: new Date(),
      });
    }
  }

  if (signals.length > 0) {
    logger.info(`💾 ${signals.length} M&A signals ready to save`);
  }

  return signals;
}
