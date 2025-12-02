import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import FirecrawlApp from "@mendable/firecrawl-js";
import { z } from "zod";
import { jobPostingSchema } from "../../../../types/jobPosting.types.js";
import type {
  JobPosting,
  FamilyOfficeCompany,
  FirecrawlSearchResult,
} from "../../../../types/jobPosting.types.js";
import {
  BLOCKED_DOMAINS,
  RECRUITMENT_AGENCY_KEYWORDS,
  CAREER_URL_PATTERNS,
  COMMON_CAREER_PATHS,
  FINANCE_KEYWORDS,
} from "../../../../config/hiring.config.js";

let firecrawlClient: FirecrawlApp | null = null;

function getFirecrawlClient(): FirecrawlApp {
  if (!firecrawlClient) {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY required");
    firecrawlClient = new FirecrawlApp({ apiKey });
  }
  return firecrawlClient;
}

function isDomainBlocked(domain: string): boolean {
  const normalized = domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
  return BLOCKED_DOMAINS.some((blocked) => normalized.includes(blocked));
}

function isRecruitmentAgency(domain: string): boolean {
  const normalized = domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
  return RECRUITMENT_AGENCY_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export async function mapCareerPages(domain: string): Promise<string[]> {
  try {
    console.log(`🗺️  Mapping career pages for: ${domain}`);
    const firecrawl = getFirecrawlClient();
    const mapResult = (await firecrawl.map(domain)) as any;

    if (!mapResult || !mapResult.links) {
      console.log(`   ⚠️  No links found for ${domain}`);
      return [];
    }

    const links = Array.isArray(mapResult.links)
      ? mapResult.links.map((link: any) => (typeof link === "string" ? link : link.url || ""))
      : [];

    const careerUrls = links.filter((url: string) => {
      if (!url) return false;
      const lowerUrl = url.toLowerCase();
      return CAREER_URL_PATTERNS.some((keyword) => lowerUrl.includes(keyword));
    });

    console.log(`   ✅ Found ${careerUrls.length} career page(s)`);
    return careerUrls;
  } catch (error: any) {
    console.error(`   ❌ Error mapping ${domain}:`, error.message);
    return [];
  }
}

export async function searchFamilyOfficeCompanies(
  query: string,
  limit: number = 10,
): Promise<FirecrawlSearchResult[]> {
  try {
    console.log(`🔍 Searching: ${query.substring(0, 80)}...`);
    const firecrawl = getFirecrawlClient();
    const searchResult = (await firecrawl.search(query, { limit })) as any;

    // Firecrawl returns results directly in 'web' array or in 'data.web'
    const webResults = searchResult.web || searchResult.data?.web || [];

    if (!Array.isArray(webResults) || webResults.length === 0) {
      console.log(`   ⚠️  No results found`);
      return [];
    }

    const results = webResults
      .map((item: any) => ({ url: item.url || "", title: item.title || "" }))
      .filter((item: FirecrawlSearchResult) => item.url);

    console.log(`   ✅ Found ${results.length} search result(s)`);
    return results;
  } catch (error: any) {
    console.error(`   ❌ Search error:`, error.message);
    console.error(`   Stack:`, error.stack);
    return [];
  }
}

export async function scrapeJobPostings(careerUrl: string): Promise<JobPosting[]> {
  try {
    console.log(`   🌐 Scraping: ${careerUrl.substring(0, 60)}...`);
    const firecrawl = getFirecrawlClient();
    const scrapeResult = (await firecrawl.scrape(careerUrl, { formats: ["markdown"] })) as any;

    if (!scrapeResult || !scrapeResult.markdown) {
      console.log(`   ⚠️  No data extracted from ${careerUrl}`);
      return [];
    }

    const jobs = await parseJobPostingsWithGPT(scrapeResult.markdown, careerUrl);
    console.log(`   ✅ Extracted ${jobs.length} job posting(s)`);
    return jobs;
  } catch (error: any) {
    console.error(`   ❌ Error scraping ${careerUrl}:`, error.message);
    return [];
  }
}

export async function scrapeJobPostingsFallback(careerUrl: string): Promise<JobPosting[]> {
  console.log(`   🔄 Trying fallback scraping for: ${careerUrl.substring(0, 60)}...`);
  return scrapeJobPostings(careerUrl);
}

async function parseJobPostingsWithGPT(markdown: string, sourceUrl: string): Promise<JobPosting[]> {
  try {
    const model = new ChatOpenAI({ modelName: "gpt-4o-mini", temperature: 0 });
    const jobPostingsArraySchema = z.array(jobPostingSchema);
    const jobParser = StructuredOutputParser.fromZodSchema(jobPostingsArraySchema);

    const prompt = ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are an expert at extracting structured job posting data from career pages. Extract ALL job postings focusing on finance roles. Return empty array if no jobs found.`,
      ],
      [
        "user",
        `Extract job postings from this career page:\nURL: {url}\n\nContent:\n{content}\n\n{format_instructions}`,
      ],
    ]);

    const chain = prompt.pipe(model);
    const result = await chain.invoke({
      url: sourceUrl,
      content: markdown.substring(0, 8000),
      format_instructions: jobParser.getFormatInstructions(),
    });

    const parsed = await jobParser.parse(result.content as string);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error: any) {
    console.error(`   ❌ GPT parsing error:`, error.message);
    return [];
  }
}

export function filterFamilyOfficeJobs(jobs: JobPosting[]): JobPosting[] {
  return jobs.filter((job) => {
    const titleLower = job.jobTitle.toLowerCase();
    const hasFinanceKeyword = FINANCE_KEYWORDS.some((keyword) => titleLower.includes(keyword));

    if (!hasFinanceKeyword) {
      console.log(`   ⏭️  Skipping non-finance role: ${job.jobTitle}`);
      return false;
    }

    if (job.familyOfficeIndicators && job.familyOfficeIndicators.length > 0) {
      console.log(`   🎯 High-value FO job: ${job.companyName} - ${job.jobTitle}`);
    }

    return true;
  });
}

export function calculateJobQualityScore(job: JobPosting): number {
  let score = 0;
  if (job.companyName) score += 10;
  if (job.jobTitle) score += 10;
  if (job.jobUrl) score += 10;
  if (job.companyDomain) score += 5;
  if (job.companyLocation) score += 5;
  if (job.companyDescription) score += 5;
  if (job.jobLevel && job.jobLevel !== "Other") score += 15;
  if (job.description && job.description.length > 100) score += 10;
  if (job.responsibilities && job.responsibilities.length > 0) score += 5;
  if (job.requirements && job.requirements.length > 0) score += 5;
  if (job.postingDate) score += 5;
  if (job.salaryRange) score += 5;
  if (job.familyOfficeIndicators && job.familyOfficeIndicators.length > 0) score += 10;
  return Math.min(score, 100);
}

export function mapJobPostingsToSignals(jobs: JobPosting[]): any[] {
  const signals: any[] = [];
  const seen = new Set<string>();
  let skippedLowQuality = 0;

  for (const job of jobs) {
    const qualityScore = calculateJobQualityScore(job);
    console.log(`📊 Quality score for ${job.companyName} - ${job.jobTitle}: ${qualityScore}/100`);

    if (qualityScore < 15) {
      console.warn(`⚠️  Skipping low quality job: ${job.companyName} (score: ${qualityScore})`);
      skippedLowQuality++;
      continue;
    }

    const jobKey = `${job.companyName.toLowerCase()}-${job.jobTitle.toLowerCase()}-${job.postingDate || "unknown"}`;
    if (seen.has(jobKey)) continue;
    seen.add(jobKey);

    const insightParts: string[] = [];
    if (job.familyOfficeIndicators && job.familyOfficeIndicators.length > 0) {
      insightParts.push(
        `${job.companyName}, a Family Office, is hiring a ${job.jobTitle}${job.companyLocation ? ` in ${job.companyLocation}` : ""}`,
      );
    } else {
      insightParts.push(
        `${job.companyName} is hiring a ${job.jobTitle}${job.companyLocation ? ` in ${job.companyLocation}` : ""}`,
      );
    }

    if (job.isNewRole) {
      insightParts.push("This is a new position, indicating organizational expansion");
    } else if (job.hiringUrgency === "urgent" || job.hiringUrgency === "high") {
      insightParts.push(`Hiring urgency is ${job.hiringUrgency}`);
    }

    if (job.salaryRange) insightParts.push(`Salary range: ${job.salaryRange}`);

    signals.push({
      signalSource: "Company",
      signalType: "hiring-event",
      filingType: "hiring-event" as const,
      fullName: job.companyName,
      companyName: job.companyName,
      insights: insightParts.join(". "),
      firstDetected: new Date(),
      lastUpdated: new Date(),
      jobPostingData: {
        companyDomain: job.companyDomain,
        companyLocation: job.companyLocation,
        jobTitle: job.jobTitle,
        jobLevel: job.jobLevel,
        salaryRange: job.salaryRange,
        postingDate: job.postingDate,
        jobUrl: job.jobUrl,
        familyOfficeIndicators: job.familyOfficeIndicators,
        hiringUrgency: job.hiringUrgency,
        isNewRole: job.isNewRole,
        qualityScore,
      },
    });
  }

  console.log(`\n✅ Signal mapping complete:`);
  console.log(`   Total jobs processed: ${jobs.length}`);
  console.log(`   Signals created: ${signals.length}`);
  console.log(`   Low quality jobs skipped: ${skippedLowQuality}`);
  console.log(
    `   Average quality score: ${jobs.length > 0 ? (jobs.reduce((sum, j) => sum + calculateJobQualityScore(j), 0) / jobs.length).toFixed(1) : 0}/100`,
  );

  return signals;
}

export async function discoverFamilyOfficesWithParallel(
  query: string,
): Promise<FamilyOfficeCompany[]> {
  try {
    console.log(`🔍 Using Firecrawl search to discover Family Offices...`);

    // Simple, direct search queries that work with Firecrawl
    const searchQueries = [
      "family office jobs",
      "family office CFO",
      "family office Controller",
      "single family office",
      "wealth management family office",
    ];

    const allResults: FirecrawlSearchResult[] = [];

    for (const searchQuery of searchQueries) {
      const results = await searchFamilyOfficeCompanies(searchQuery, 10);
      allResults.push(...results);

      // Add delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(`   ✅ Found ${allResults.length} total search results`);

    // Extract unique domains from search results
    const companies: FamilyOfficeCompany[] = [];
    const seenDomains = new Set<string>();

    for (const result of allResults) {
      // Skip blocked domains
      let domain = "";
      try {
        const urlObj = new URL(result.url);
        domain = urlObj.hostname.replace("www.", "");

        if (isDomainBlocked(domain) || isRecruitmentAgency(domain)) {
          continue;
        }

        if (!seenDomains.has(domain)) {
          seenDomains.add(domain);
          companies.push({
            company: result.title || domain,
            domain,
            source: result.url,
          });
        }
      } catch {
        // Skip invalid URLs
      }
    }

    console.log(`   ✅ Discovered ${companies.length} unique Family Office candidate(s)`);
    return companies;
  } catch (error: any) {
    console.error("❌ Firecrawl discovery error:", error.message);
    return [];
  }
}

// =========================================
// Domain Scraping Pipeline
// =========================================
export async function scrapeFamilyOfficeHiring(domain: string): Promise<JobPosting[]> {
  const allJobs: JobPosting[] = [];

  // Map career pages
  const careerUrls = await mapCareerPages(domain);
  const urlsToScrape =
    careerUrls.length > 0
      ? careerUrls.slice(0, 5)
      : COMMON_CAREER_PATHS.map((path) => `https://${domain}${path}`);

  if (careerUrls.length === 0) {
    console.log(`   ⚠️  No career pages found for ${domain}, trying common paths...`);
  }

  // Scrape each URL
  for (const careerUrl of urlsToScrape) {
    let jobs = await scrapeJobPostings(careerUrl);
    if (jobs.length === 0) jobs = await scrapeJobPostingsFallback(careerUrl);
    allJobs.push(...jobs);
  }

  // Filter for finance roles
  const filteredJobs = filterFamilyOfficeJobs(allJobs);

  console.log(`\n📊 Scraping summary for ${domain}:`);
  console.log(`   Total jobs found: ${allJobs.length}`);
  console.log(`   Relevant jobs: ${filteredJobs.length}`);

  return filteredJobs;
}

// =========================================
// Main Discovery & Scraping Function
// =========================================
export async function discoverAndScrapeFamilyOffices(
  searchQuery: string,
  limit: number = 10,
): Promise<JobPosting[]> {
  const allJobs: JobPosting[] = [];

  // Discover companies using Firecrawl
  const companies = await discoverFamilyOfficesWithParallel(searchQuery);
  console.log(`\n🏢 Processing ${Math.min(companies.length, limit)} Family Office companies...`);

  // Scrape each company
  for (const company of companies.slice(0, limit)) {
    if (!company.domain) {
      console.log(`   ⚠️  Skipping ${company.company}: no domain`);
      continue;
    }

    // Skip blocked domains
    if (isDomainBlocked(company.domain)) {
      console.log(`   🚫 Skipping ${company.company} (${company.domain}): blocked domain`);
      continue;
    }

    // Skip recruitment agencies
    if (isRecruitmentAgency(company.domain)) {
      console.log(
        `   🚫 Skipping ${company.company} (${company.domain}): recruitment agency, not a Family Office`,
      );
      continue;
    }

    console.log(`\n🔍 Processing: ${company.company} (${company.domain})`);

    const jobs = await scrapeFamilyOfficeHiring(company.domain);
    allJobs.push(...jobs);

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log(`\n✅ Discovery complete:`);
  console.log(`   Companies processed: ${Math.min(companies.length, limit)}`);
  console.log(`   Total relevant jobs: ${allJobs.length}`);

  return allJobs;
}
