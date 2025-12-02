import axios, { AxiosError } from "axios";

/**
 * =====================================
 * TAX PROFESSIONAL SCRAPER HELPER
 * =====================================
 * Scrapes ContactOut API for tax professionals including:
 * - Tax Consultants
 * - Tax Attorneys
 * - Tax Advisors
 * - Wealth Managers
 * - Financial Advisors
 * Location: United States
 */

// =====================================
// TYPES & INTERFACES
// =====================================

export interface TaxProfessionalProfile {
  name: string;
  location: string | null;
  role: string | null;
  company: string | null;
  linkedinUrl: string | null;
  emails: {
    personal: string[];
    business: string[];
  };
  phoneNumbers: string[];
  keyInsights: string | null;
  rawResponse: any;
}

export interface TaxProfessionalSearchResult {
  success: boolean;
  totalFound: number;
  profiles: TaxProfessionalProfile[];
  error?: string;
}

// =====================================
// CONSTANTS
// =====================================

const TAX_JOB_TITLES = [
  "Tax Consultant",
  "Tax Attorney",
  "Tax advisor",
  "Wealth Managers",
  "FINANCIAL ADVISOR",
];

const LOCATION = "United States";

// =====================================
// HELPER FUNCTIONS
// =====================================

/**
 * Transform ContactOut API response to TaxProfessionalProfile format
 */
function transformToTaxProfessionalProfile(profile: any): TaxProfessionalProfile {
  const personalEmails: string[] = [];
  const businessEmails: string[] = [];

  // Extract emails
  if (profile.contact_info) {
    if (profile.contact_info.personal_emails) {
      personalEmails.push(...profile.contact_info.personal_emails);
    }
    if (profile.contact_info.work_emails) {
      businessEmails.push(...profile.contact_info.work_emails);
    }
    if (profile.contact_info.emails) {
      profile.contact_info.emails.forEach((email: string) => {
        const domain = email.split("@")[1]?.toLowerCase();
        const personalDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com"];
        if (personalDomains.some((pd) => domain?.includes(pd))) {
          if (!personalEmails.includes(email)) personalEmails.push(email);
        } else {
          if (!businessEmails.includes(email)) businessEmails.push(email);
        }
      });
    }
  }

  // Extract phone numbers
  const phoneNumbers: string[] = profile.contact_info?.phones || [];

  // Build LinkedIn URL
  let linkedinUrl: string | null = null;
  if (profile.li_vanity) {
    linkedinUrl = `https://www.linkedin.com/in/${profile.li_vanity}`;
  } else if (profile.linkedin_url) {
    linkedinUrl = profile.linkedin_url;
  }

  // Build key insights from available data
  const insights: string[] = [];
  if (profile.headline) insights.push(profile.headline);
  if (profile.summary) insights.push(profile.summary);
  if (profile.industry) insights.push(`Industry: ${profile.industry}`);

  return {
    name: profile.full_name || profile.name || "Unknown",
    location: profile.location || profile.country || null,
    role: profile.title || profile.headline || null,
    company: profile.company?.name || profile.current_company || null,
    linkedinUrl,
    emails: {
      personal: personalEmails,
      business: businessEmails,
    },
    phoneNumbers,
    keyInsights: insights.length > 0 ? insights.join(" | ") : null,
    rawResponse: profile,
  };
}

/**
 * Parse ContactOut API response and extract profiles
 */
function parseContactOutResponse(responseData: any): any[] {
  let results: any[] = [];

  // New format: { profiles: { "linkedin_url": {profile}, ... } } - OBJECT not array
  if (responseData.profiles && typeof responseData.profiles === "object") {
    results = Object.values(responseData.profiles);
  }
  // Array format
  else if (responseData.profiles && Array.isArray(responseData.profiles)) {
    results = responseData.profiles;
  }
  // Legacy format fallbacks
  else if (responseData.results && Array.isArray(responseData.results)) {
    results = responseData.results;
  } else if (responseData.data) {
    results = Array.isArray(responseData.data) ? responseData.data : [responseData.data];
  } else if (Array.isArray(responseData)) {
    results = responseData;
  }

  return results;
}

// =====================================
// MAIN SCRAPER FUNCTION
// =====================================

/**
 * Scrape ContactOut API for tax professionals in the United States
 *
 * Searches for all job titles together:
 * - Tax Consultants
 * - Tax Attorneys
 * - Tax Advisors
 * - Wealth Managers
 * - Financial Advisors
 *
 * @param pages - Number of pages to fetch (default: 1). If pages=5, fetches pages 1-5
 * @returns TaxProfessionalSearchResult with all found profiles
 */
export async function scrapeTaxProfessionals(
  pages: number = 1,
): Promise<TaxProfessionalSearchResult> {
  const apiKey = process.env.CONTACTOUT_API_KEY || "";
  const baseUrl = "https://api.contactout.com/v1/people/search";

  if (!apiKey) {
    console.error("CONTACTOUT_API_KEY not found in environment variables");
    return {
      success: false,
      totalFound: 0,
      profiles: [],
      error: "CONTACTOUT_API_KEY not configured",
    };
  }

  const allProfiles: TaxProfessionalProfile[] = [];
  const errors: string[] = [];

  console.log(`\n🔍 Starting Tax Professional Scrape...`);
  console.log(`   Job Titles: ${TAX_JOB_TITLES.join(", ")}`);
  console.log(`   Location: ${LOCATION}`);
  console.log(`   Pages to fetch: ${pages}`);

  // Fetch all pages from 1 to the specified page number
  for (let currentPage = 1; currentPage <= pages; currentPage++) {
    try {
      console.log(`Fetching page ${currentPage} of ${pages}...`);

      const requestBody = {
        job_title: TAX_JOB_TITLES, // All job titles together
        location: [LOCATION],
        reveal_info: true,
        page: currentPage,
      };

      console.log("Request:", JSON.stringify(requestBody, null, 2));

      const response = await axios.post(baseUrl, requestBody, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          token: apiKey,
        },
        timeout: 30000,
      });

      console.log(`API Response status: ${response.status}`);

      const profiles = parseContactOutResponse(response.data);
      console.log(`Found ${profiles.length} profiles on page ${currentPage}`);

      // Transform and add to results
      for (const profile of profiles) {
        const transformed = transformToTaxProfessionalProfile(profile);
        allProfiles.push(transformed);
      }

      // Rate limiting - wait 100ms between requests
      if (currentPage < pages) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const errorMsg = `Failed to fetch page ${currentPage}: ${axiosError.response?.status} - ${axiosError.message}`;
        console.error(`${errorMsg}`);
        errors.push(errorMsg);

        if (axiosError.response?.status === 429) {
          console.log("Rate limit hit - waiting 60s before continuing...");
          await new Promise((resolve) => setTimeout(resolve, 60000));
        }
      } else {
        const errorMsg = `Failed to fetch page ${currentPage}: ${(error as Error).message}`;
        console.error(`${errorMsg}`);
        errors.push(errorMsg);
      }
    }
  }

  console.log(`\nTax Professional Scrape Complete`);
  console.log(`   Total profiles found: ${allProfiles.length}`);
  if (errors.length > 0) {
    console.log(`   Errors encountered: ${errors.length}`);
  }

  return {
    success: errors.length === 0,
    totalFound: allProfiles.length,
    profiles: allProfiles,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}

export async function scrapeTaxProfessionalsIndividual(
  pages: number = 1,
  designation: string,
): Promise<TaxProfessionalSearchResult> {
  const apiKey = process.env.CONTACTOUT_API_KEY || "";
  const baseUrl = "https://api.contactout.com/v1/people/search";

  if (!apiKey) {
    console.error("❌ CONTACTOUT_API_KEY not found in environment variables");
    return {
      success: false,
      totalFound: 0,
      profiles: [],
      error: "CONTACTOUT_API_KEY not configured",
    };
  }

  const allProfiles: TaxProfessionalProfile[] = [];
  const errors: string[] = [];

  console.log(`\n🔍 Starting Tax Professional Scrape...`);
  console.log(`   Job Titles: ${TAX_JOB_TITLES.join(", ")}`);
  console.log(`   Location: ${LOCATION}`);
  console.log(`   Pages to fetch: ${pages}`);

  // Fetch all pages from 1 to the specified page number
  for (let currentPage = 1; currentPage <= pages; currentPage++) {
    try {
      console.log(`\n📋 Fetching page ${currentPage} of ${pages}...`);

      const requestBody = {
        job_title: [designation], // All job titles together
        location: [LOCATION],
        reveal_info: true,
        page: currentPage,
      };

      console.log("📤 Request:", JSON.stringify(requestBody, null, 2));

      const response = await axios.post(baseUrl, requestBody, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          token: apiKey,
        },
        timeout: 30000,
      });

      console.log(`   ✅ API Response status: ${response.status}`);

      const profiles = parseContactOutResponse(response.data);
      console.log(`   📊 Found ${profiles.length} profiles on page ${currentPage}`);

      // Transform and add to results
      for (const profile of profiles) {
        const transformed = transformToTaxProfessionalProfile(profile);
        allProfiles.push(transformed);
      }

      // Rate limiting - wait 100ms between requests
      if (currentPage < pages) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const errorMsg = `Failed to fetch page ${currentPage}: ${axiosError.response?.status} - ${axiosError.message}`;
        console.error(`   ❌ ${errorMsg}`);
        errors.push(errorMsg);

        if (axiosError.response?.status === 429) {
          console.log("   ⚠️ Rate limit hit - waiting 60s before continuing...");
          await new Promise((resolve) => setTimeout(resolve, 60000));
        }
      } else {
        const errorMsg = `Failed to fetch page ${currentPage}: ${(error as Error).message}`;
        console.error(`   ❌ ${errorMsg}`);
        errors.push(errorMsg);
      }
    }
  }

  console.log(`\n✅ Tax Professional Scrape Complete`);
  console.log(`   Total profiles found: ${allProfiles.length}`);
  if (errors.length > 0) {
    console.log(`   Errors encountered: ${errors.length}`);
  }

  return {
    success: errors.length === 0,
    totalFound: allProfiles.length,
    profiles: allProfiles,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}
