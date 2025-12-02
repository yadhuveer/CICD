import axios, { AxiosError } from "axios";
import { ContactOutCache } from "../models/LocalContactOutDb.model.js";
import { ContactOutPerson } from "../types/contacts.js";
import {
  normalizePersonName,
  generateCompanyVariations,
} from "../tools/AiAgents/contextAgent/nameNormalizer.agent.js";

/**
 * =====================================
 * CONTACTOUT API SERVICE
 * =====================================
 * Handles all interactions with the ContactOut API including:
 * - Searching for contacts with name/company variations
 * - Caching responses to reduce API calls
 * - Rate limiting and error handling
 * - Transforming ContactOut data to internal Contact schema
 */

// =====================================
// TYPES & INTERFACES
// =====================================

export interface ContactOutSearchParams {
  fullName: string;
  companyName?: string;
  linkedinUrl?: string;
}

export interface ContactOutSearchResult {
  found: boolean;
  data?: ContactOutPerson;
  source: "cache" | "api";
  searchAttempts: string[];
  error?: string;
}

// =====================================
// CONTACTOUT API CLIENT
// =====================================

class ContactOutService {
  private apiKey: string;
  private baseUrl: string = "https://api.contactout.com/v1/people/search";
  private rateLimitDelay: number = 100; // 100ms between requests (10 req/sec)
  private lastRequestTime: number = 0;

  constructor() {
    this.apiKey = process.env.CONTACTOUT_API_KEY || "";

    if (!this.apiKey) {
      console.warn("⚠️  CONTACTOUT_API_KEY not found in environment variables");
    }
  }

  /**
   * Rate limiting helper - ensures we don't exceed API rate limits
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * =====================================
   * CACHE OPERATIONS
   * =====================================
   */

  /**
   * Check cache for existing ContactOut data
   */
  private async checkCache(
    fullName: string,
    companyName?: string,
  ): Promise<ContactOutPerson | null> {
    try {
      // Generate search key
      const searchKey = companyName
        ? `${fullName.toLowerCase()}@${companyName.toLowerCase()}`
        : fullName.toLowerCase();

      // Look for cached result
      const cached = await ContactOutCache.findOne({
        searchKey,
        expiresAt: { $gt: new Date() }, // Not expired
      }).lean();

      if (cached) {
        console.log(`💾 Cache HIT for: "${fullName}" @ "${companyName}"`);
        return cached.rawResponse as ContactOutPerson;
      }

      console.log(`🔍 Cache MISS for: "${fullName}" @ "${companyName}"`);
      return null;
    } catch (error: any) {
      console.error("❌ Cache check error:", error.message);
      return null;
    }
  }

  /**
   * Save ContactOut response to cache
   */
  private async saveToCache(
    fullName: string,
    companyName: string | undefined,
    data: ContactOutPerson,
  ): Promise<void> {
    try {
      const searchKey = companyName
        ? `${fullName.toLowerCase()}@${companyName.toLowerCase()}`
        : fullName.toLowerCase();

      // Cache for 30 days
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await ContactOutCache.create({
        searchKey,
        fullName,
        companyName,
        rawResponse: data,
        expiresAt,
      });

      console.log(`💾 Cached ContactOut data for: "${fullName}" @ "${companyName}"`);
    } catch (error: any) {
      console.error("❌ Cache save error:", error.message);
      // Non-critical error - continue without caching
    }
  }

  /**
   * =====================================
   * CONTACTOUT API CALLS
   * =====================================
   */

  /**
   * Search ContactOut API for a person with company variations
   * IMPORTANT: Always requires company variations to avoid ambiguous matches
   */
  private async searchContactOutAPI(
    fullName: string,
    companyVariations: string[],
  ): Promise<ContactOutPerson | null> {
    try {
      await this.enforceRateLimit();

      const companyDisplay =
        companyVariations && companyVariations.length > 0
          ? `[${companyVariations.join(", ")}]`
          : "NONE";
      console.log(`🔎 Searching ContactOut API: "${fullName}" @ ${companyDisplay}`);

      // Official ContactOut API format (per documentation)
      const body: any = {
        name: fullName,
        reveal_info: true, // REQUIRED: Get actual contact details (emails, phones)
        page: 1,
        company: companyVariations, // ALWAYS include company variations array
      };

      // Log the request payload
      console.log("📤 ContactOut API Request Payload:");
      console.log(JSON.stringify(body, null, 2));

      const response = await axios.post(this.baseUrl, body, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          token: this.apiKey,
        },
        timeout: 30000, // 30 second timeout
      });

      // Log the response
      console.log("📥 ContactOut API Response:");
      console.log(JSON.stringify(response.data, null, 2));

      // Parse response - ContactOut returns { status_code, metadata, profiles }
      let results: any[] = [];

      // New format: { profiles: { "linkedin_url": {profile}, ... } } - OBJECT not array!
      if (response.data.profiles && typeof response.data.profiles === "object") {
        // Convert object to array of profile values
        results = Object.values(response.data.profiles);
        console.log(`   Found ${results.length} profiles (object format)`);
      }
      // Array format
      else if (response.data.profiles && Array.isArray(response.data.profiles)) {
        results = response.data.profiles;
        console.log(`   Found ${results.length} profiles (array format)`);
      }
      // Legacy format fallbacks
      else if (response.data.results && Array.isArray(response.data.results)) {
        results = response.data.results;
        console.log(`   Found ${results.length} results (legacy format)`);
      } else if (response.data.data) {
        results = Array.isArray(response.data.data) ? response.data.data : [response.data.data];
        console.log(`   Found ${results.length} data (legacy format)`);
      } else if (Array.isArray(response.data)) {
        results = response.data;
        console.log(`   Found ${results.length} items (direct array format)`);
      }

      // Validate results to avoid ambiguous matches
      if (results.length > 0) {
        console.log(`📊 ContactOut returned ${results.length} result(s)`);

        // CASE 1: Single result - high confidence match
        if (results.length === 1) {
          const person = results[0];
          console.log(
            `✅ Found single match on ContactOut: ${person.full_name || person.name} @ ${person.company?.name || person.current_company}`,
          );
          console.log("   Profile sample:", JSON.stringify(person, null, 2));
          return person as ContactOutPerson;
        }

        // CASE 2: Multiple results - validate if we can confidently choose one
        console.log(`⚠️  Multiple results found - validating match confidence...`);

        // Check if all results are for the same company
        const companies = results
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
          return null;
        }

        // All results are from same company (or no company info) - take first result
        const person = results[0];
        console.log(
          `✅ Multiple results but all from same context - using first match: ${person.full_name || person.name} @ ${person.company?.name || person.current_company}`,
        );
        console.log("   Profile sample:", JSON.stringify(person, null, 2));
        return person as ContactOutPerson;
      }

      console.log(`❌ No results from ContactOut for: "${fullName}" @ ${companyDisplay}`);

      // OPTIMIZATION: Never search without company name to avoid burning credits on wrong matches
      // Always require company context for accurate matching
      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        if (axiosError.response?.status === 404) {
          console.log(`❌ ContactOut: No match found (404)`);
          return null;
        }

        if (axiosError.response?.status === 429) {
          console.error("⚠️  ContactOut rate limit exceeded - waiting 60s");
          await new Promise((resolve) => setTimeout(resolve, 60000));
          return null;
        }

        console.error(
          `❌ ContactOut API error (${axiosError.response?.status}):`,
          axiosError.message,
        );
        if (axiosError.response?.data) {
          console.error("   Error details:", JSON.stringify(axiosError.response.data, null, 2));
        }
      } else {
        console.error("❌ ContactOut API error:", error);
      }

      return null;
    }
  }

  /**
   * =====================================
   * MAIN SEARCH FUNCTION WITH VARIATIONS
   * =====================================
   */

  /**
   * Search for a contact with automatic name normalization and company variations
   *
   * Strategy:
   * 1. Check cache first
   * 2. Try original name with ALL company variations (sent as array in single API call)
   * 3. If not found → generate name variants using nameNormalizer agent
   * 4. Try each name variant with the SAME company variations array
   * 5. Cache result if found
   */
  async searchContact(params: ContactOutSearchParams): Promise<ContactOutSearchResult> {
    const { fullName, companyName, linkedinUrl } = params;
    const searchAttempts: string[] = [];

    console.log(`\n🔍 Starting ContactOut search for: "${fullName}" @ "${companyName || "N/A"}"`);

    try {
      // ==========================================
      // STEP 0: Require company name to avoid naked searches
      // ==========================================
      if (!companyName || companyName.trim().length === 0) {
        console.log(`❌ SKIPPED: Company name is required for ContactOut search`);
        console.log(
          `   Reason: Searching without company context burns credits on ambiguous matches`,
        );
        return {
          found: false,
          source: "api",
          searchAttempts: ["skipped-no-company-name"],
          error: "Company name is required - cannot search ContactOut without company context",
        };
      }

      // ==========================================
      // STEP 1: Check cache first (exact match)
      // ==========================================
      const cachedResult = await this.checkCache(fullName, companyName);
      if (cachedResult) {
        return {
          found: true,
          data: cachedResult,
          source: "cache",
          searchAttempts: ["cache-hit"],
        };
      }

      // ==========================================
      // STEP 2: Generate company variations ONCE
      // ==========================================
      let companyVariations: string[] = [];

      if (companyName) {
        console.log(`📝 Generating company name variations for: "${companyName}"`);
        const variationsResult = await generateCompanyVariations(companyName);
        companyVariations = variationsResult.variations;
        console.log(`   ✅ Generated ${companyVariations.length} variations:`, companyVariations);
      }

      // ==========================================
      // STEP 3: Try ORIGINAL name with company variations
      // ==========================================
      console.log(`\n🔎 Phase 1: Trying original name with company variations...`);

      const attemptKey1 = `${fullName} @ [${companyVariations.join(", ")}]`;
      searchAttempts.push(attemptKey1);

      const result1 = await this.searchContactOutAPI(fullName, companyVariations);

      if (result1) {
        // Found! Save to cache and return
        await this.saveToCache(fullName, companyName, result1);
        return {
          found: true,
          data: result1,
          source: "api",
          searchAttempts,
        };
      }

      // ==========================================
      // STEP 4: Generate name variants using AI agent
      // ==========================================
      console.log(`\n🔎 Phase 2: Generating name variants using AI agent...`);

      const normalizedResult = await normalizePersonName(fullName);

      console.log(`   📝 Normalization result:`);
      console.log(`      Original: "${normalizedResult.originalName}"`);
      console.log(`      Normalized: "${normalizedResult.normalizedName}"`);
      console.log(`      First Name: "${normalizedResult.firstName || "N/A"}"`);
      console.log(`      Last Name: "${normalizedResult.lastName || "N/A"}"`);
      console.log(`      Removed: [${normalizedResult.removedElements.join(", ")}]`);

      // Generate array of realistic name variants (max 1-2)
      const nameVariants: string[] = [];

      // ONLY add normalized name if it's different from original
      // The normalized name should be the primary LinkedIn-style variation
      if (normalizedResult.normalizedName.toLowerCase() !== fullName.toLowerCase()) {
        nameVariants.push(normalizedResult.normalizedName);
        console.log(`   ✅ Will try normalized variant: "${normalizedResult.normalizedName}"`);
      } else {
        console.log(`   ℹ️  Normalized name same as original - no additional variants to try`);
      }

      console.log(`   ✅ Generated ${nameVariants.length} name variants to try:`, nameVariants);

      if (nameVariants.length === 0) {
        console.log(`   ⚠️  No new name variants generated - ending search`);
        return {
          found: false,
          source: "api",
          searchAttempts,
          error: "No results found after trying all variations",
        };
      }

      // ==========================================
      // STEP 5: Try ONLY 1-2 name variants to avoid burning credits
      // ==========================================
      const MAX_NAME_VARIANTS = 2; // Limit to 2 attempts to save ContactOut credits
      const variantsToTry = nameVariants.slice(0, MAX_NAME_VARIANTS);

      console.log(
        `\n🔎 Phase 3: Trying ${variantsToTry.length} name variants (limited to ${MAX_NAME_VARIANTS}) with company variations...`,
      );

      if (nameVariants.length > MAX_NAME_VARIANTS) {
        console.log(
          `   💡 Skipping ${nameVariants.length - MAX_NAME_VARIANTS} additional variants to save API credits`,
        );
      }

      for (const nameVariant of variantsToTry) {
        const attemptKey = `${nameVariant} @ [${companyVariations.join(", ")}]`;
        searchAttempts.push(attemptKey);

        console.log(`\n   Trying variant: "${nameVariant}"`);

        const result = await this.searchContactOutAPI(nameVariant, companyVariations);

        if (result) {
          // Found! Save to cache and return
          await this.saveToCache(fullName, companyName, result);
          return {
            found: true,
            data: result,
            source: "api",
            searchAttempts,
          };
        }
      }

      // ==========================================
      // STEP 6: No results found
      // ==========================================
      console.log(`\n❌ No results found after ${searchAttempts.length} search attempts`);

      return {
        found: false,
        source: "api",
        searchAttempts,
        error: "No results found after trying all variations",
      };
    } catch (error: any) {
      console.error("❌ ContactOut search error:", error.message);
      return {
        found: false,
        source: "api",
        searchAttempts,
        error: error.message,
      };
    }
  }

  /**
   * =====================================
   * DATA TRANSFORMATION HELPERS
   * =====================================
   */

  /**
   * Extract emails from ContactOut person data
   */
  extractEmails(person: ContactOutPerson): { personal: string[]; business: string[] } {
    const personal: string[] = [];
    const business: string[] = [];

    if (person.contact_info) {
      // Work emails
      if (person.contact_info.work_emails) {
        business.push(...person.contact_info.work_emails);
      }

      // Personal emails
      if (person.contact_info.personal_emails) {
        personal.push(...person.contact_info.personal_emails);
      }

      // Generic emails array (categorize based on domain)
      if (person.contact_info.emails) {
        person.contact_info.emails.forEach((email) => {
          const domain = email.split("@")[1]?.toLowerCase();
          const personalDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"];

          if (personalDomains.some((pd) => domain?.includes(pd))) {
            if (!personal.includes(email)) personal.push(email);
          } else {
            if (!business.includes(email)) business.push(email);
          }
        });
      }
    }

    return { personal, business };
  }

  /**
   * Extract phone numbers from ContactOut person data
   */
  extractPhoneNumbers(person: ContactOutPerson): { personal: string[]; business: string[] } {
    const personal: string[] = [];
    const business: string[] = [];

    if (person.contact_info?.phones) {
      // ContactOut doesn't distinguish personal vs business phones
      // We'll put them all in business for now
      business.push(...person.contact_info.phones);
    }

    return { personal, business };
  }

  /**
   * Extract LinkedIn URL from ContactOut person data
   */
  extractLinkedInUrl(person: ContactOutPerson): string | undefined {
    // ContactOut provides li_vanity field
    if (person.li_vanity) {
      return `https://www.linkedin.com/in/${person.li_vanity}`;
    }

    return undefined;
  }

  /**
   * Extract company name from ContactOut person data
   */
  extractCompanyName(person: ContactOutPerson): string | undefined {
    return person.company?.name || person.title || undefined;
  }

  /**
   * Extract location from ContactOut person data
   */
  extractLocation(person: ContactOutPerson): string | undefined {
    if (person.location) {
      return person.location;
    }

    if (person.country) {
      return person.country;
    }

    return undefined;
  }

  /**
   * =====================================
   * EXECUTIVE SEARCH BY COMPANY + SENIORITY
   * =====================================
   */

  /**
   * Search ContactOut for executives by company name and seniority level
   * Used for auto-discovering key people when signal has no keyPeople array
   *
   * @param companyName - Company name to search for
   * @returns Executive search result with found profiles
   */
  async searchExecutivesByCompanyAndSeniority(companyName: string): Promise<ExecutiveSearchResult> {
    try {
      console.log(`\n🔍 Searching ContactOut for executives at "${companyName}"...`);

      // STEP 1: Generate company name variations using AI agent
      const { variations } = await generateCompanyVariations(companyName);
      console.log(`   Generated ${variations.length} company variations`);

      // STEP 2: Search for C-Suite executives
      console.log(`   Searching for C-Suite executives...`);
      const cSuiteProfiles = await this.searchContactOutBySeniority(
        variations,
        ["CXO"],
        2, // Limit to 2 results
      );

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));

      // STEP 3: Search for Vice President level
      console.log(`   Searching for Vice Presidents...`);
      const vpProfiles = await this.searchContactOutBySeniority(
        variations,
        ["VP"],
        2, // Limit to 2 results
      );

      // STEP 4: Combine results
      const allExecutives = [...cSuiteProfiles, ...vpProfiles];

      console.log(
        `   ✅ Found ${allExecutives.length} executives (C-Suite: ${cSuiteProfiles.length}, VP: ${vpProfiles.length})`,
      );

      return {
        found: allExecutives.length > 0,
        executives: allExecutives,
        totalFound: allExecutives.length,
        cSuiteCount: cSuiteProfiles.length,
        vpCount: vpProfiles.length,
        companyVariations: variations,
      };
    } catch (error: any) {
      console.error(`❌ Executive search failed:`, error.message);
      return {
        found: false,
        executives: [],
        totalFound: 0,
        cSuiteCount: 0,
        vpCount: 0,
        companyVariations: [],
        error: error.message,
      };
    }
  }

  /**
   * Helper function to search ContactOut by company variations + seniority level
   * Makes a single API call with BOTH company and seniority filters
   *
   * @param companyVariations - Array of company name variations
   * @param seniorityLevels - Array of seniority levels (e.g., ["CXO"], ["VP"])
   * @param limit - Maximum number of results to return
   * @returns Array of ContactOutPerson profiles
   */
  private async searchContactOutBySeniority(
    companyVariations: string[],
    seniorityLevels: string[],
    limit: number,
  ): Promise<ContactOutPerson[]> {
    try {
      if (!this.apiKey) {
        throw new Error("ContactOut API key not configured");
      }

      // Enforce rate limiting
      await this.enforceRateLimit();
      console.log("Hirring API");

      console.log("company variation is " + companyVariations);
      console.log("Senerioty level is " + seniorityLevels);
      console.log("base url is " + this.baseUrl);
      console.log("API key is " + this.apiKey);

      // Make API request with BOTH company AND seniority filters together
      const requestBody = {
        company: companyVariations, // Array of company name variations
        seniority: seniorityLevels, // Array with seniority level
        reveal_info: true, // Get contact details
        page: 1,
      };
      console.log("📤 Request body:", JSON.stringify(requestBody, null, 2));

      const response = await axios.post(this.baseUrl, requestBody, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          token: this.apiKey, // ContactOut uses 'token' header, not 'Authorization'
        },
        timeout: 30000, // 30 seconds timeout for ContactOut API (increased from 10s)
      });

      console.log(`      API Response status: ${response.status}`);

      // Parse response - ContactOut returns { status_code, metadata, profiles }
      let results: any[] = [];

      // New format: { profiles: { "linkedin_url": {profile}, ... } } - OBJECT not array!
      if (response.data.profiles && typeof response.data.profiles === "object") {
        // Convert object to array of profile values
        results = Object.values(response.data.profiles);
      }
      // Array format
      else if (response.data.profiles && Array.isArray(response.data.profiles)) {
        results = response.data.profiles;
      }
      // Legacy format fallbacks
      else if (response.data.results && Array.isArray(response.data.results)) {
        results = response.data.results;
      } else if (response.data.data) {
        results = Array.isArray(response.data.data) ? response.data.data : [response.data.data];
      } else if (Array.isArray(response.data)) {
        results = response.data;
      }

      // Return limited number of results
      const limitedProfiles = results.slice(0, limit) as ContactOutPerson[];
      console.log(`      Found ${limitedProfiles.length} profiles`);

      return limitedProfiles;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        console.error(
          `      ❌ ContactOut API error: ${axiosError.response?.status} - ${axiosError.message}`,
        );
        if (axiosError.response?.data) {
          console.error(
            "      📋 Error details from ContactOut:",
            JSON.stringify(axiosError.response.data, null, 2),
          );
        }
      } else {
        console.error(`      ❌ Error:`, error.message);
      }
      return [];
    }
  }
}

// =====================================
// ADDITIONAL TYPE EXPORT
// =====================================

export interface ExecutiveSearchResult {
  found: boolean;
  executives: ContactOutPerson[];
  totalFound: number;
  cSuiteCount: number;
  vpCount: number;
  companyVariations: string[];
  error?: string;
}

// =====================================
// SINGLETON EXPORT
// =====================================

export const contactOutService = new ContactOutService();
