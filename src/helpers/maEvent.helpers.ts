import * as cheerio from "cheerio";
import FirecrawlApp from "@mendable/firecrawl-js";
import { BLOCKED_DOMAINS, SCRAPING_LIMITS } from "../config/hiring.config.js";

export const PRESS_RELEASE_SITES =
  "site:businesswire.com OR site:prnewswire.com OR site:globenewswire.com";
export const STATE_FILING_SITES =
  "site:corp.delaware.gov OR site:sos.ca.gov OR site:sos.state.tx.us";
export const SEC_SITES = "site:sec.gov/Archives/edgar";

export const EVENT_TYPE_MAP: Record<string, string> = {
  acquisition: "acquisition",
  merger: "merger",
  exit: "acquisition",
  dissolution: "divestiture",
  articles_of_merger: "merger",
  asset_sale: "divestiture",
  majority_stake_sale: "acquisition",
  investment: "acquisition",
  growth_capital_investment: "acquisition",
  "joint-venture": "joint-venture",
};

export type ValidationResult = {
  valid: boolean;
  qualityScore?: number;
  reason?: string;
};

export function isBlocked(url: string): boolean {
  return BLOCKED_DOMAINS.some((d) => url.includes(d));
}

export function getFirecrawl(): FirecrawlApp {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY required");
  return new FirecrawlApp({ apiKey });
}

export function extractPageData(html: string) {
  const $ = cheerio.load(html);

  $("script, style, svg, path, iframe, noscript, canvas, video, audio").remove();
  $("header, footer, nav").remove();
  $('[class*="cookie"], [id*="cookie"]').remove();
  $('[class*="banner"], [id*="banner"]').remove();
  $('[class*="advert"], [id*="advert"]').remove();
  $('[class*="promo"], [id*="promo"]').remove();

  const blocks: string[] = [];

  const title = $("title").first().text().trim() || null;
  const metaDesc =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    null;

  $("h1,h2,h3,h4").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 3) blocks.push(t);
  });

  $("p").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 20) blocks.push(t);
  });

  $("li").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 5) blocks.push("• " + t);
  });

  $("a").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 5 && t.length < 200) blocks.push(t);
  });

  const cleanText = blocks.join("\n\n").replace(/\s+/g, " ").trim();

  return {
    text: cleanText.slice(0, SCRAPING_LIMITS.MARKDOWN_MAX_LENGTH),
    title,
    metaDescription: metaDesc,
  };
}

export const isValidName = (name: string | undefined): boolean => {
  if (!name) return false;
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.toLowerCase() !== "unknown";
};

export const mapCompanyData = (company: any) => {
  if (!company) return undefined;
  return {
    name: company.name,
    nameVariants: company.nameVariants,
    industry: company.industry,
    location: company.location,
    ticker: company.ticker,
    description: company.description,
    companyType: company.companyType,
    companySize: company.companySize,
    revenue: company.revenue,
    employees: company.employees,
    fundingStage: company.fundingStage,
    marketCap: company.marketCap,
  };
};

export const buildTransactionSummary = (
  targetName: string,
  acquirerName: string | undefined,
  dealValue: string | undefined,
  eventType: string,
): string => {
  if (acquirerName && dealValue && dealValue !== "undisclosed") {
    return `${acquirerName} acquired ${targetName} for ${dealValue}`;
  }
  if (acquirerName && dealValue === "undisclosed") {
    return `${acquirerName} acquired ${targetName} (undisclosed amount)`;
  }
  if (acquirerName) {
    return `${targetName} acquired by ${acquirerName}`;
  }
  if (dealValue && dealValue !== "undisclosed") {
    return `${targetName} transaction valued at ${dealValue}`;
  }
  return `${targetName} ${eventType}`;
};

export const parseDate = (dateStr: string | undefined | null): Date | null => {
  if (!dateStr || dateStr === "unknown" || dateStr === "null") return null;
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
};

export const validateEventLogic = (event: any): { valid: boolean; error?: string } => {
  if (event.acquiringCompany?.name && event.targetCompany?.name) {
    const target = event.targetCompany.name.toLowerCase().trim();
    const acquirer = event.acquiringCompany.name.toLowerCase().trim();
    if (target === acquirer) {
      return { valid: false, error: "Target and acquirer are the same company" };
    }
  }

  if (event.eventType === "acquisition" && !event.acquiringCompany?.name) {
    return { valid: false, error: "Acquisition event missing acquirer" };
  }

  const now = new Date();
  const announcementDate = parseDate(event.announcementDate);
  if (announcementDate && announcementDate > now) {
    const daysDiff = Math.floor(
      (announcementDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysDiff > 30) {
      return { valid: false, error: `Announcement date is ${daysDiff} days in the future` };
    }
  }

  return { valid: true };
};

export const calculateEventQualityScore = (event: any): number => {
  let score = 0;

  if (event.targetCompany?.name) score += 5;
  if (event.announcementDate) score += 5;
  if (event.eventType) score += 5;
  if (event.status) score += 5;

  if (event.targetCompany?.industry) score += 5;
  if (event.targetCompany?.location) score += 5;
  if (event.targetCompany?.description) score += 5;
  if (event.targetCompany?.companyType) score += 5;

  if (event.dealValue && event.dealValue !== "undisclosed") score += 10;
  if (event.financialDetails?.totalValue) score += 5;
  if (event.financialDetails?.valuationMultiple) score += 5;

  if (event.keyPeople && event.keyPeople.length > 0) {
    score += Math.min(event.keyPeople.length * 5, 15);
  }

  if (event.insights?.summary) score += 5;
  if (event.insights?.strategicRationale) score += 5;
  if (event.insights?.keyInsights && event.insights.keyInsights.length > 0) score += 5;

  if (event.sources && event.sources.length > 0) {
    score += Math.min(event.sources.length * 5, 10);
  }

  return Math.min(score, 100);
};

export const validateEvent = (event: any): ValidationResult => {
  if (!isValidName(event.targetCompany?.name)) {
    return { valid: false, reason: "invalid_name" };
  }

  const logicValidation = validateEventLogic(event);
  if (!logicValidation.valid) {
    return { valid: false, reason: "invalid_logic" };
  }

  const qualityScore = calculateEventQualityScore(event);
  if (qualityScore < 20) {
    return { valid: false, reason: "low_quality", qualityScore };
  }

  return { valid: true, qualityScore };
};
