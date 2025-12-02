import FirecrawlApp from "@mendable/firecrawl-js";
import { z } from "zod";
import OpenAI from "openai";
import axios from "axios";
import TurndownService from "turndown";
import * as cheerio from "cheerio";

/**
 * =========================================
 * Philanthropy Sponsorship & Board Role Scraper
 * =========================================
 * Detects major philanthropy sponsorships and board roles at
 * cultural/medical/educational institutions.
 *
 * Signal Type: Major philanthropy sponsorships/board roles
 * Signal Description: Prominent sponsorships or board seats at cultural/medical/
 *   educational institutions; signals active giving and portfolio alignment needs.
 * Signal Sources: Event programs; museum/hospital board rosters; local/national press
 *
 *
 */

// =========================================
// Type Definitions
// =========================================

export const philanthropySignalSchema = z.object({
  fullName: z.string().describe("Full name of the individual"),
  companyName: z
    .string()
    .optional()
    .describe(
      "Company/employer/firm of the individual (e.g., Goldman Sachs, Blackstone, Microsoft, etc.)",
    ),
  role: z
    .string()
    .describe("Role at the institution (e.g., Board Member, Trustee, Major Donor, Sponsor)"),
  institutionName: z
    .string()
    .describe("Name of the institution (museum, hospital, university, etc.)"),
  institutionType: z
    .enum([
      "museum",
      "hospital",
      "medical-center",
      "university",
      "cultural-center",
      "arts-organization",
      "educational-institution",
      "foundation",
      "other",
    ])
    .describe("Type of institution"),
  institutionLocation: z.string().optional().describe("Location of the institution (city, state)"),
  sponsorshipLevel: z
    .string()
    .optional()
    .describe(
      "Level of involvement (e.g., board-member, trustee, chair, vice-chair, treasurer, secretary, major-donor, sponsor, patron, founder, emeritus)",
    ),
  appointmentDate: z
    .string()
    .optional()
    .describe("Date of appointment or recognition (if available)"),
  description: z.string().optional().describe("Brief description of the role or sponsorship"),
  sourceUrl: z.string().describe("URL where this information was found"),
  sourceTitle: z.string().optional().describe("Title of the source page"),
  wealthIndicators: z
    .array(z.string())
    .optional()
    .describe("Any wealth or prominence indicators mentioned"),
});

export type PhilanthropySignal = z.infer<typeof philanthropySignalSchema>;

export interface FirecrawlSearchResult {
  url: string;
  title: string;
}

// =========================================
// Firecrawl Client
// =========================================
let firecrawlClient: FirecrawlApp | null = null;

function getFirecrawlClient(): FirecrawlApp {
  if (!firecrawlClient) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY required");
    firecrawlClient = new FirecrawlApp({ apiKey });
  }
  return firecrawlClient;
}

// =========================================
// DYNAMIC DISCOVERY - NO HARDCODED INSTITUTIONS
// Uses keywords to automatically discover latest philanthropy data
// =========================================

/**
 * Dynamic search queries based on signal description and sources
 * Signal Description: Prominent sponsorships or board seats at cultural/medical/educational institutions
 * Sources: Event programs, museum/hospital board rosters, local/national press
 */

// Get current year and previous year dynamically
const currentYear = new Date().getFullYear();
const previousYear = currentYear - 1;
const yearRange = `${previousYear} ${currentYear}`;

export const MUSEUM_QUERIES = [
  `museum board of trustees ${yearRange} USA new appointments`,
  `museum board members appointed ${currentYear} philanthropy`,
  `art museum trustees ${yearRange} new board members USA`,
];

export const MEDICAL_QUERIES = [
  `hospital board of trustees ${yearRange} USA new members`,
  `medical center board appointments ${currentYear} philanthropy`,
  `healthcare board trustees ${yearRange} new appointments USA`,
];

export const EDUCATIONAL_QUERIES = [
  `university board of trustees ${yearRange} USA new appointments`,
  `college board members ${currentYear} philanthropy USA`,
  `university trustees ${yearRange} new members higher education`,
];

export const CULTURAL_QUERIES = [
  `cultural institution board ${yearRange} USA new trustees`,
  `arts organization board appointments ${currentYear} philanthropy`,
  `symphony orchestra trustees ${yearRange} new board members`,
];

// All queries combined - focused on latest current year data
export const ALL_PHILANTHROPY_QUERIES = [
  ...MUSEUM_QUERIES,
  ...MEDICAL_QUERIES,
  ...EDUCATIONAL_QUERIES,
  ...CULTURAL_QUERIES,
];

// =========================================
// Firecrawl Search & Scrape Functions
// =========================================

/**
 * Search for philanthropy-related URLs using Firecrawl
 * Optimized for speed - returns only top 3 most relevant results
 */
export async function searchPhilanthropyPages(
  query: string,
  limit: number = 3,
): Promise<FirecrawlSearchResult[]> {
  try {
    const firecrawl = getFirecrawlClient();

    const searchResult = (await firecrawl.search(query, {
      limit,
    })) as any;

    const webResults = searchResult?.web || [];
    console.log(`Web results count: ${webResults.length}`);

    if (!Array.isArray(webResults) || webResults.length === 0) {
      console.log(`No web results found`);

      return [];
    }

    const results = webResults
      .map((item: any) => ({
        url: item.url || "",
        title: item.title || "",
      }))
      .filter((item: FirecrawlSearchResult) => item.url)
      // Filter for likely institutional domains
      .filter((item: FirecrawlSearchResult) => {
        const url = item.url.toLowerCase();
        // Prefer .org, .edu, .gov, and established institutional sites
        return (
          url.includes(".org") ||
          url.includes(".edu") ||
          url.includes(".gov") ||
          url.includes("museum") ||
          url.includes("hospital") ||
          url.includes("university") ||
          url.includes("foundation") ||
          url.includes("medical") ||
          url.includes("health")
        );
      });

    console.log(`Found ${results.length} relevant result(s)`);
    return results;
  } catch (error: any) {
    console.error(`Search error:`, error.message);
    return [];
  }
}

/**
 * Scrape a philanthropy page using axios and convert HTML to markdown
 * More cost-effective than Firecrawl scraping
 * Includes HTML cleaning to remove scripts, styles, and navigation
 */
export async function scrapePhilanthropyPage(
  url: string,
  title: string,
): Promise<PhilanthropySignal[]> {
  try {
    console.log(`Scraping with axios: ${url.substring(0, 60)}...`);

    // Fetch HTML using axios
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    const html = response.data;

    if (!html || html.length < 200) {
      console.log(`No HTML content from ${url}`);
      return [];
    }

    console.log(`Fetched HTML: ${html.length} chars`);

    // Clean HTML using cheerio - remove scripts, styles, nav, footer, ads
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $("script").remove();
    $("style").remove();
    $("nav").remove();
    $("header").remove();
    $("footer").remove();
    $("iframe").remove();
    $("noscript").remove();
    $(".navigation").remove();
    $(".nav").remove();
    $(".menu").remove();
    $(".sidebar").remove();
    $(".cookie").remove();
    $(".advertisement").remove();
    $(".ad").remove();
    $("#cookie-notice").remove();
    $('[class*="cookie"]').remove();
    $('[class*="gdpr"]').remove();
    $('[id*="cookie"]').remove();

    let mainContent =
      $("main").html() ||
      $("article").html() ||
      $(".main-content").html() ||
      $(".content").html() ||
      $("#content").html() ||
      $('[role="main"]').html() ||
      $("body").html();

    if (!mainContent || mainContent.length < 200) {
      console.log(`No main content found from ${url}`);
      return [];
    }

    console.log(`Cleaned HTML: ${mainContent.length} chars`);

    // Convert cleaned HTML to markdown using turndown
    const turndownService = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
    });

    const markdown = turndownService.turndown(mainContent);

    if (!markdown || markdown.length < 200) {
      console.log(`Markdown too short: ${markdown.length} chars`);
      return [];
    }

    console.log(`Converted to markdown: ${markdown.length} chars`);
    console.log(`Markdown preview:`, markdown.substring(0, 200));

    const signals = await extractPhilanthropySignalsWithGPT(markdown, url, title);

    console.log(`Extracted ${signals.length} philanthropy signal(s)`);
    return signals;
  } catch (error: any) {
    console.error(`Error scraping ${url}:`, error.message);
    return [];
  }
}

// =========================================
// GPT-4 Extraction Function
// =========================================

/**
 * Use OpenAI GPT-4 to extract structured philanthropy signals from markdown content
 *
 */
export async function extractPhilanthropySignalsWithGPT(
  markdownContent: string,
  sourceUrl: string,
  sourceTitle: string,
): Promise<PhilanthropySignal[]> {
  try {
    console.log(`Extracting with GPT from ${sourceUrl.substring(0, 50)}...`);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY required");

    // Increase content size to 15000 chars for better extraction (now that HTML is cleaned)
    const truncatedContent = markdownContent.slice(0, 15000);

    // Skip if content is too short to be useful
    if (truncatedContent.length < 200) {
      console.log(`Content too short (${truncatedContent.length} chars), skipping GPT extraction`);
      return [];
    }

    console.log(`Content length: ${truncatedContent.length} chars`);

    // Initialize OpenAI client
    const openai = new OpenAI({ apiKey });

    // Get current year dynamically
    const currentYear = new Date().getFullYear();
    const previousYear = currentYear - 1;

    // Use direct OpenAI API with JSON mode for speed
    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are an expert financial analyst specializing in identifying high-net-worth individuals through board memberships and philanthropy signals at major USA institutions.

CRITICAL REQUIREMENTS - USA INSTITUTIONS ONLY:
- ONLY extract individuals where the institution is definitively located in the United States
- institutionLocation MUST include a US state (e.g., "New York, NY", "Boston, Massachusetts", "Los Angeles, CA")
- If no US state is clearly mentioned, DO NOT extract that person
- If institution is international or location is ambiguous, SKIP it entirely
- Return empty "signals" array if no USA-based matches are found

CRITICAL FILTERING - GOVERNANCE/PHILANTHROPY ROLES ONLY (NOT STAFF/EMPLOYEES):

✅ EXTRACT THESE (Philanthropy/Governance Signals):
- Board Members, Board of Trustees, Trustees
- Board Chair, Vice-Chair, Board President, Board Secretary, Board Treasurer
- Major Donors, Principal Donors, Lead Donors
- Sponsors, Patrons, Benefactors
- Foundation Board Members
- Advisory Board Members (if significant donor role mentioned)
- Emeritus Trustees (former board members)
- Capital Campaign Chairs/Leaders

❌ DO NOT EXTRACT THESE (Staff/Employee Positions):
- Curators (Academic Curator, Chief Curator, Curator of Decorative Arts, etc.)
- Museum Directors, Executive Directors
- Academic appointments (Professor, Lecturer, Research positions)
- Staff positions (Manager, Coordinator, Administrator)
- Hired employees or salaried positions
- Artistic Directors, Creative Directors
- Any operational/management role

KEY DISTINCTION:
- Board/Trustee roles = PHILANTHROPIC (they give money/time, signal wealth)
- Curator/Staff roles = EMPLOYMENT (they receive salary, signal career)

EXTRACTION CRITERIA:
Focus on ${previousYear}-${currentYear} appointments/recognitions only. Extract ONLY:
- Governance roles at major museums, teaching hospitals, R1 universities, large foundations, prominent cultural institutions
- Individuals demonstrating philanthropic giving and wealth indicators
- Roles that signal portfolio alignment needs and active charitable engagement

REQUIRED FIELDS:
- fullName: Individual's full name (REQUIRED)
- companyName: Current employer/firm if mentioned (e.g., "Goldman Sachs", "Blackstone")
- role: Exact board title (REQUIRED - e.g., "Board Chair", "Trustee", "Vice-Chair")
- institutionName: Full institution name (REQUIRED)
- institutionType: museum, hospital, medical-center, university, cultural-center, arts-organization, educational-institution, foundation, or other
- institutionLocation: City, State format (REQUIRED - MUST be USA state, e.g., "Chicago, IL", "San Francisco, California")
- sponsorshipLevel: chair, vice-chair, trustee, board-member, treasurer, secretary, major-donor, etc.
- appointmentDate: Year if mentioned (YYYY format)
- wealthIndicators: Array of wealth/prominence phrases found (e.g., ["major donor", "endowment committee", "capital campaign chair"])

DESCRIPTION FIELD (CRITICAL - Must be 80+ characters):
Create a detailed, context-rich description explaining WHY this signals major philanthropy. Use this template:

"{Role} at {Institution Name} ({City, State}) - {describe institution prestige/type}. {Explain why this board role signals significant wealth and philanthropic engagement}. {Include any wealth indicators mentioned}."

EXAMPLES OF QUALITY DESCRIPTIONS:
✓ "Board Chair at Metropolitan Museum of Art (New York, NY) - world-renowned art museum and major cultural institution. Chair position indicates $25M+ net worth and senior philanthropic leadership. Major donor and endowment committee member."
✓ "Trustee at Johns Hopkins University (Baltimore, MD) - top-tier research university and medical institution. University trustee role signals high net worth and commitment to educational philanthropy. Active in capital campaign leadership."
✓ "Board Member at Cleveland Clinic Foundation (Cleveland, OH) - leading medical research and teaching hospital. Healthcare board membership demonstrates significant wealth and interest in medical philanthropy."

✗ BAD: "Board Member" (too short, no context)
✗ BAD: "Trustee at museum" (missing location, prestige, significance)

WEALTH INDICATORS TO DETECT:
Look for phrases indicating wealth/prominence: "major donor", "principal donor", "lead donor", "endowment", "capital campaign", "investment committee", "founder", "benefactor", dollar amounts, "emeritus", "honorary"

OUTPUT FORMAT:
Return JSON object with "signals" array. Each signal must have USA state in institutionLocation and rich 80+ char description explaining significance.

If no USA-based institutions found, return: {"signals": []}`,
          },
          {
            role: "user",
            content: `Extract all philanthropy signals from this content:\n\nSource: ${sourceUrl}\n\n${truncatedContent}`,
          },
        ],
      },
      { timeout: 90000 }, // 90 second timeout for larger content
    );

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      console.log(`No response from GPT`);
      return [];
    }

    const parsed = JSON.parse(responseText);
    const signals = parsed.signals || [];

    console.log(` GPT returned ${signals.length} signals`);

    // Add source URL to all signals
    const signalsWithSource = signals.map((signal: any) => ({
      ...signal,
      sourceUrl,
      sourceTitle,
    }));

    return signalsWithSource;
  } catch (error: any) {
    console.error(`GPT extraction error:`, error.message);
    return [];
  }
}

// =========================================
// Main Discovery Functions
// =========================================

/**
 * Discover philanthropy signals using queries from a specific category
 */
export async function discoverPhilanthropyByCategory(
  queries: string[],
  maxPagesPerQuery: number = 3,
): Promise<PhilanthropySignal[]> {
  const allSignals: PhilanthropySignal[] = [];

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    console.log(`\n[${i + 1}/${queries.length}] Processing: ${query}`);

    try {
      // Search for relevant pages
      const searchResults = await searchPhilanthropyPages(query, maxPagesPerQuery);

      if (searchResults.length === 0) {
        console.log("No pages found");
        continue;
      }

      // Scrape each page and extract signals
      for (const result of searchResults) {
        const signals = await scrapePhilanthropyPage(result.url, result.title);
        allSignals.push(...signals);

        // Minimal delay for speed -
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Minimal delay between queries -
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error: any) {
      console.error(`Error processing query:`, error.message);
    }
  }

  return allSignals;
}

/**
 * Run comprehensive philanthropy discovery - FULLY AUTOMATED, NO USER INPUT
 */
export async function discoverAllPhilanthropySignals2(
  options: {
    maxQueriesPerCategory?: number;
    maxPagesPerQuery?: number;
    categories?: Array<"museum" | "medical" | "educational" | "cultural">;
  } = {},
): Promise<PhilanthropySignal[]> {
  const maxQueriesPerCategory = options.maxQueriesPerCategory || 5;
  const maxPagesPerQuery = options.maxPagesPerQuery || 3;
  const categories = options.categories || ["museum", "medical", "educational", "cultural"];

  const allSignals: PhilanthropySignal[] = [];

  // Process each category
  if (categories.includes("museum")) {
    console.log("MUSEUMS & ART INSTITUTIONS");

    const queries = MUSEUM_QUERIES.slice(0, maxQueriesPerCategory);
    const signals = await discoverPhilanthropyByCategory(queries, maxPagesPerQuery);
    allSignals.push(...signals);
    console.log(`Museums: Found ${signals.length} signals`);
  }

  if (categories.includes("medical")) {
    console.log("MEDICAL & HEALTHCARE INSTITUTIONS");

    const queries = MEDICAL_QUERIES.slice(0, maxQueriesPerCategory);
    const signals = await discoverPhilanthropyByCategory(queries, maxPagesPerQuery);
    allSignals.push(...signals);
    console.log(`Medical: Found ${signals.length} signals\n`);
  }

  if (categories.includes("educational")) {
    console.log("EDUCATIONAL INSTITUTIONS");

    const queries = EDUCATIONAL_QUERIES.slice(0, maxQueriesPerCategory);
    const signals = await discoverPhilanthropyByCategory(queries, maxPagesPerQuery);
    allSignals.push(...signals);
    console.log(`Educational: Found ${signals.length} signals\n`);
  }

  if (categories.includes("cultural")) {
    console.log("CULTURAL INSTITUTIONS");

    const queries = CULTURAL_QUERIES.slice(0, maxQueriesPerCategory);
    const signals = await discoverPhilanthropyByCategory(queries, maxPagesPerQuery);
    allSignals.push(...signals);
  }
  console.log("Starting with AHA");
  const ahaUrl = process.env.AHA_URL || "https://www.aha.org/about/leadership/board";
  const ahaSignals = await scrapePhilanthropyPage(ahaUrl, "aha");
  allSignals.push(...ahaSignals);

  // Deduplicate signals by fullName + institutionName
  const uniqueSignals = Array.from(
    new Map(
      allSignals.map((signal) => [`${signal.fullName}-${signal.institutionName}`, signal]),
    ).values(),
  );

  console.log(`Total signals found: ${allSignals.length}`);
  console.log(`Unique signals: ${uniqueSignals.length}`);

  return uniqueSignals;
}
