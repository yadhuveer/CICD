import axios, { AxiosError } from "axios";

export interface contactsProfessionalProfile {
  name: string;
  location: string | null;
  role: string | null;
  company: string | null;
  linkedinUrl: string | null;
  emails?: {
    personal: string[];
    business: string[];
  };
  phoneNumbers?: string[];
  keyInsights: string | null;
  rawResponse: any;
}

export interface TaxProfessionalSearchResult {
  success: boolean;
  totalFound: number;
  profiles: contactsProfessionalProfile[];
  error?: string;
}

function transformToContactProfile(profile: any): contactsProfessionalProfile {
  // Extract emails

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
    keyInsights: insights.length > 0 ? insights.join(" | ") : null,
    rawResponse: profile,
  };
}

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

export async function scrapeContactsWrapper(
  pages: number = 1,
  designation: string | string[],
  location: string | string[],
  company: string | string[],
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

  const allProfiles: contactsProfessionalProfile[] = [];
  const errors: string[] = [];

  // Fetch all pages from 1 to the specified page number....

  try {
    // Build request body dynamically based on provided parameters
    const requestBody: any = {
      page: pages,
    };

    // Add job_title - handle both string and array
    if (designation) {
      if (Array.isArray(designation) && designation.length > 0) {
        requestBody.job_title = designation;
      } else if (typeof designation === "string" && designation.trim() !== "") {
        requestBody.job_title = [designation];
      }
    }

    // Add location - handle both string and array
    if (location) {
      if (Array.isArray(location) && location.length > 0) {
        requestBody.location = location;
      } else if (typeof location === "string" && location.trim() !== "") {
        requestBody.location = [location];
      }
    }

    // Add company - handle both string and array
    if (company) {
      if (Array.isArray(company) && company.length > 0) {
        requestBody.company = company;
      } else if (typeof company === "string" && company.trim() !== "") {
        requestBody.company = [company];
      }
    }

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
    console.log(`Found ${profiles.length}`);

    // Transform and add to results
    for (const profile of profiles) {
      const transformed = transformToContactProfile(profile);
      allProfiles.push(transformed);
    }

    // Rate limiting - wait 100ms between requests
    /*if (currentPage < pages) {
      await new Promise((resolve) => setTimeout(resolve, 100));....
    }*/
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const errorMsg = `Failed to fetch page : ${axiosError.response?.status} - ${axiosError.message}`;
      console.error(`${errorMsg}`);
      errors.push(errorMsg);

      if (axiosError.response?.status === 429) {
        console.log("Rate limit hit - waiting 60s before continuing...");
        await new Promise((resolve) => setTimeout(resolve, 60000));
      }
    } else {
      const errorMsg = `Failed to fetch page  ${(error as Error).message}`;
      console.error(` ${errorMsg}`);
      errors.push(errorMsg);
    }
  }

  console.log(`\n Tax Professional Scrape Complete`);
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

/**
 * Search ContactOut API for a specific person WITHOUT revealing email (doesn't use email credits)
 * Used when we want to get profile data but not waste email credits
 */
export async function searchContactOutWithoutEmail(params: {
  fullName: string;
  companyName: string;
}): Promise<{ found: boolean; data?: any; error?: string }> {
  const apiKey = process.env.CONTACTOUT_API_KEY || "";
  const baseUrl = "https://api.contactout.com/v1/people/search";

  if (!apiKey) {
    console.error("CONTACTOUT_API_KEY not found in environment variables");
    return {
      found: false,
      error: "CONTACTOUT_API_KEY not configured",
    };
  }

  try {
    const requestBody: any = {
      name: params.fullName, // Use 'name' NOT 'full_name'
      company: [params.companyName],
      reveal_info: false, // Don't reveal contact info (saves credits)
      page: 1,
    };

    console.log(
      `🔍 Searching ContactOut WITHOUT email for: ${params.fullName} @ ${params.companyName}`,
    );
    console.log("📤 Request body:", JSON.stringify(requestBody, null, 2));

    const response = await axios.post(baseUrl, requestBody, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        token: apiKey,
      },
      timeout: 30000,
    });

    console.log(`✅ ContactOut API Response status: ${response.status}`);
    console.log("📥 Response data:", JSON.stringify(response.data, null, 2));

    const profiles = parseContactOutResponse(response.data);

    if (!profiles || profiles.length === 0) {
      console.log("❌ No profiles found on ContactOut");
      return { found: false };
    }

    console.log(`📊 ContactOut returned ${profiles.length} result(s)`);

    // Validate: Single result = high confidence
    if (profiles.length === 1) {
      const profile = profiles[0];
      console.log(
        `✅ Found single match on ContactOut: ${profile.full_name || profile.name} @ ${profile.company?.name || profile.current_company}`,
      );
      console.log("   Profile sample:", JSON.stringify(profile, null, 2));
      return {
        found: true,
        data: profile,
      };
    }

    // Multiple results - check if all from same company
    console.log(`⚠️  Multiple results found - validating match confidence...`);
    const companies = profiles
      .map((r) => (r.company?.name || r.current_company || "").toLowerCase().trim())
      .filter((c) => c.length > 0);

    const uniqueCompanies = [...new Set(companies)];

    if (uniqueCompanies.length > 1) {
      console.log(`❌ DISCARDING: Multiple results from different companies:`);
      uniqueCompanies.forEach((company, idx) => {
        console.log(`   ${idx + 1}. ${company}`);
      });
      console.log(
        `   Cannot confidently determine which person is correct - discarding all results`,
      );
      return { found: false };
    }

    // All from same company - use first match
    const profile = profiles[0];
    console.log(
      `✅ Multiple results but all from same context - using first match: ${profile.full_name || profile.name} @ ${profile.company?.name || profile.current_company}`,
    );
    console.log("   Profile sample:", JSON.stringify(profile, null, 2));

    return {
      found: true,
      data: profile,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const errorMsg = `ContactOut API error: ${axiosError.response?.status} - ${axiosError.message}`;
      console.error(errorMsg);
      return {
        found: false,
        error: errorMsg,
      };
    } else {
      const errorMsg = `ContactOut search error: ${(error as Error).message}`;
      console.error(errorMsg);
      return {
        found: false,
        error: errorMsg,
      };
    }
  }
}
