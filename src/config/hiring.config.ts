/**
 * Family Office Hiring Pipeline Configuration
 * Centralized configuration for all hiring-related constants
 */

/**
 * Blocked domains - sites that don't work with Firecrawl or are not relevant
 */
export const BLOCKED_DOMAINS = [
  "reddit.com",
  "linkedin.com", // ToS violations for profile scraping
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
] as const;

/**
 * Recruitment agency keywords - filter out agencies, not actual Family Offices
 */
export const RECRUITMENT_AGENCY_KEYWORDS = [
  "recruitment",
  "recruiting",
  "headhunter",
  "staffing",
  "talent",
  "executive-search",
  "search-firm",
] as const;

/**
 * Career page URL patterns
 */
export const CAREER_URL_PATTERNS = [
  "/career",
  "/jobs",
  "/opportunities",
  "/join",
  "/work",
  "/hiring",
  "/positions",
  "/openings",
] as const;

/**
 * Common career page paths to try when mapping fails
 */
export const COMMON_CAREER_PATHS = ["/careers", "/jobs", "/opportunities", "/join-us"] as const;

/**
 * Open web search queries - NOT limited to specific sites
 */
export const SEARCH_QUERIES = [
  // General searches
  '"family office" hiring CFO 2024 2025',
  '"family office" hiring Controller',
  '"family office" hiring "Financial Analyst"',
  '"single family office" finance job',
  '"multi family office" CFO position',

  // Geographic searches
  '"family office" CFO job "New York"',
  '"family office" Controller "San Francisco"',
  '"family office" "Financial Analyst" Chicago',
  '"family office" finance Miami',
  '"family office" hiring Texas',

  // Specific role types
  '"family office" "Chief Financial Officer" 2025',
  '"family office" "Director of Finance" hiring',
  '"family office" "VP Finance" open position',
  '"private wealth office" CFO hiring',
  '"private wealth management" Controller job',

  // Company expansion signals
  '"family office" "expanding team" finance',
  '"family office" "new position" CFO Controller',
  '"family office" careers finance professional',
  '"family office" "we are hiring" finance',
] as const;

/**
 * Parallel.ai discovery queries
 */
export const PARALLEL_DISCOVERY_QUERIES = [
  "Find 50 Family Office companies hiring CFO, Controller, or Financial Analyst roles in 2024-2025",
  "Find Single Family Offices in USA hiring senior finance positions in 2025",
  "Find Multi-Family Offices hiring CFO or Controller in New York, San Francisco, Chicago, Miami",
  "Find private wealth management Family Offices with open finance roles",
  "Find tech billionaire Family Offices hiring financial professionals",
] as const;

/**
 * ATS platforms to search
 */
export const ATS_PLATFORMS = ["greenhouse", "lever", "workday", "bamboo"] as const;

/**
 * Finance-related job title keywords for filtering
 */
export const FINANCE_KEYWORDS = [
  "cfo",
  "chief financial",
  "controller",
  "finance",
  "financial",
  "analyst",
  "accounting",
  "investment",
  "treasurer",
  "director",
  "manager",
  "vp",
  "vice president",
] as const;

/**
 * Quality scoring thresholds
 */
export const QUALITY_THRESHOLDS = {
  MINIMUM_SCORE: 15, // Reject jobs below this score
  EXCELLENT_SCORE: 80, // Jobs above this are high-priority
} as const;

/**
 * Rate limiting configuration (milliseconds)
 */
export const RATE_LIMITS = {
  BETWEEN_COMPANIES: 2000, // 2 seconds between company scrapes
  BETWEEN_PAGES: 1000, // 1 second between page scrapes
  BETWEEN_JOBS: 500, // 0.5 seconds between job scrapes
} as const;

/**
 * Scraping limits
 */
export const SCRAPING_LIMITS = {
  CAREER_PAGES_PER_DOMAIN: 5, // Max career pages to scrape per domain
  MARKDOWN_MAX_LENGTH: 8000, // Max markdown length for GPT parsing
  MAX_RESULTS_PER_SEARCH: 10, // Max results from Firecrawl search
} as const;
