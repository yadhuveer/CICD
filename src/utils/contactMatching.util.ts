import { Contact } from "../models/Contacts.model.js";
import { Company } from "../models/Company.model.js";
import { normalizeCompanyName } from "./deduplication.util.js";

/**
 * Match confidence levels
 */
export enum MatchConfidence {
  EXACT = "exact", // External ID or exact name+company match
  HIGH = "high", // Fuzzy name+company match (>0.8 similarity)
  LOW = "low", // Name-only match (requires review)
  NONE = "none", // No match found
}

/**
 * Match method types
 */
export enum MatchMethod {
  EXTERNAL_ID = "external_id", // LinkedIn URL or email match
  NAME_COMPANY_EXACT = "name_company_exact", // Exact name + company match
  NAME_COMPANY_FUZZY = "name_company_fuzzy", // Fuzzy name + company match
  NAME_ONLY = "name_only", // Name-only match (low confidence)
  NONE = "none", // No match found
}

/**
 * Match result interface
 */
export interface ContactMatchResult {
  contact: any | null;
  matchConfidence: MatchConfidence;
  matchMethod: MatchMethod;
  similarityScore?: number;
  potentialMatches?: any[]; // For name-only matches that need review
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        );
      }
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate similarity score between two strings (0-1 range)
 * 1 = identical, 0 = completely different
 */
function calculateSimilarity(str1: string, str2: string): number {
  const normalized1 = str1.toLowerCase().trim();
  const normalized2 = str2.toLowerCase().trim();

  if (normalized1 === normalized2) return 1;

  const distance = levenshteinDistance(normalized1, normalized2);
  const maxLength = Math.max(normalized1.length, normalized2.length);

  return 1 - distance / maxLength;
}

/**
 * Match contact by external unique identifiers (LinkedIn URL, email)
 * Highest confidence match
 */
export async function matchByExternalIds(
  linkedinUrl?: string,
  email?: string,
): Promise<ContactMatchResult> {
  // Try LinkedIn URL first (most reliable)
  if (linkedinUrl) {
    const contact = await Contact.findOne({ linkedinUrl: linkedinUrl.trim() });
    if (contact) {
      return {
        contact,
        matchConfidence: MatchConfidence.EXACT,
        matchMethod: MatchMethod.EXTERNAL_ID,
        similarityScore: 1.0,
      };
    }
  }

  // Try email match
  if (email) {
    const normalizedEmail = email.toLowerCase().trim();
    const contact = await Contact.findOne({
      $or: [
        { "emailAddress.personal": normalizedEmail },
        { "emailAddress.business": normalizedEmail },
      ],
    });
    if (contact) {
      return {
        contact,
        matchConfidence: MatchConfidence.EXACT,
        matchMethod: MatchMethod.EXTERNAL_ID,
        similarityScore: 1.0,
      };
    }
  }

  return {
    contact: null,
    matchConfidence: MatchConfidence.NONE,
    matchMethod: MatchMethod.NONE,
  };
}

/**
 * Match by exact name and company
 */
export async function matchByNameAndCompanyExact(
  fullName: string,
  companyName?: string,
): Promise<ContactMatchResult> {
  if (!companyName) {
    return {
      contact: null,
      matchConfidence: MatchConfidence.NONE,
      matchMethod: MatchMethod.NONE,
    };
  }

  // First find company by name (exact or fuzzy)
  const company = await Company.findOne({
    $or: [{ companyName: companyName.trim() }, { legalName: companyName.trim() }],
  });

  if (!company) {
    return {
      contact: null,
      matchConfidence: MatchConfidence.NONE,
      matchMethod: MatchMethod.NONE,
    };
  }

  // Find contact with exact name and this company
  const contact = await Contact.findOne({
    fullName: fullName.trim(),
    "companies.companyId": company._id,
  }).populate("companies.companyId");

  if (contact) {
    return {
      contact,
      matchConfidence: MatchConfidence.EXACT,
      matchMethod: MatchMethod.NAME_COMPANY_EXACT,
      similarityScore: 1.0,
    };
  }

  return {
    contact: null,
    matchConfidence: MatchConfidence.NONE,
    matchMethod: MatchMethod.NONE,
  };
}

/**
 * Match by fuzzy name and company matching
 * Uses Levenshtein distance with threshold of 0.8
 */
export async function matchByNameAndCompanyFuzzy(
  fullName: string,
  companyName?: string,
  threshold: number = 0.8,
): Promise<ContactMatchResult> {
  if (!companyName) {
    return {
      contact: null,
      matchConfidence: MatchConfidence.NONE,
      matchMethod: MatchMethod.NONE,
    };
  }

  // Normalize inputs
  const normalizedInputName = fullName.toLowerCase().trim();
  const normalizedInputCompany = normalizeCompanyName(companyName);

  // Find companies with similar names
  const allCompanies = await Company.find({});
  const similarCompanies = allCompanies
    .map((company) => ({
      company,
      similarity: calculateSimilarity(
        normalizedInputCompany,
        normalizeCompanyName(company.companyName || ""),
      ),
    }))
    .filter((item) => item.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);

  if (similarCompanies.length === 0) {
    return {
      contact: null,
      matchConfidence: MatchConfidence.NONE,
      matchMethod: MatchMethod.NONE,
    };
  }

  // Search for contacts in these companies
  const companyIds = similarCompanies.map((item) => item.company._id);
  const contacts = await Contact.find({
    "companies.companyId": { $in: companyIds },
  }).populate("companies.companyId");

  // Calculate similarity for each contact's name
  const matches = contacts
    .map((contact) => ({
      contact,
      nameSimilarity: calculateSimilarity(
        normalizedInputName,
        contact.fullName?.toLowerCase().trim() || "",
      ),
      companySimilarity:
        similarCompanies.find((sc) =>
          contact.companies?.some(
            (c: any) =>
              c.companyId?._id?.toString() === sc.company._id.toString() ||
              c.companyId?.toString() === sc.company._id.toString(),
          ),
        )?.similarity || 0,
    }))
    .filter((item) => item.nameSimilarity >= threshold);

  if (matches.length === 0) {
    return {
      contact: null,
      matchConfidence: MatchConfidence.NONE,
      matchMethod: MatchMethod.NONE,
    };
  }

  // Sort by combined similarity score (weighted: 60% name, 40% company)
  matches.sort((a, b) => {
    const scoreA = a.nameSimilarity * 0.6 + a.companySimilarity * 0.4;
    const scoreB = b.nameSimilarity * 0.6 + b.companySimilarity * 0.4;
    return scoreB - scoreA;
  });

  const bestMatch = matches[0];
  const combinedScore = bestMatch.nameSimilarity * 0.6 + bestMatch.companySimilarity * 0.4;

  return {
    contact: bestMatch.contact,
    matchConfidence: MatchConfidence.HIGH,
    matchMethod: MatchMethod.NAME_COMPANY_FUZZY,
    similarityScore: combinedScore,
  };
}

/**
 * Match by name only (last resort, low confidence)
 * Returns multiple potential matches for review
 */
export async function matchByNameOnly(
  fullName: string,
  maxResults: number = 5,
): Promise<ContactMatchResult> {
  const normalizedName = fullName.toLowerCase().trim();

  // Find exact matches first
  const exactMatches = await Contact.find({
    fullName: fullName.trim(),
  })
    .populate("companies.companyId")
    .limit(maxResults);

  if (exactMatches.length === 1) {
    // Only one exact match - relatively safe
    return {
      contact: exactMatches[0],
      matchConfidence: MatchConfidence.LOW,
      matchMethod: MatchMethod.NAME_ONLY,
      similarityScore: 1.0,
      potentialMatches: exactMatches,
    };
  }

  if (exactMatches.length > 1) {
    // Multiple exact matches - needs review
    return {
      contact: null,
      matchConfidence: MatchConfidence.LOW,
      matchMethod: MatchMethod.NAME_ONLY,
      potentialMatches: exactMatches,
    };
  }

  // Try fuzzy name match
  const allContacts = await Contact.find({}).populate("companies.companyId").limit(100); // Limit search space

  const fuzzyMatches = allContacts
    .map((contact) => ({
      contact,
      similarity: calculateSimilarity(normalizedName, contact.fullName?.toLowerCase().trim() || ""),
    }))
    .filter((item) => item.similarity >= 0.8)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults);

  if (fuzzyMatches.length === 0) {
    return {
      contact: null,
      matchConfidence: MatchConfidence.NONE,
      matchMethod: MatchMethod.NONE,
    };
  }

  return {
    contact: fuzzyMatches.length === 1 ? fuzzyMatches[0].contact : null,
    matchConfidence: MatchConfidence.LOW,
    matchMethod: MatchMethod.NAME_ONLY,
    similarityScore: fuzzyMatches[0]?.similarity,
    potentialMatches: fuzzyMatches.map((m) => m.contact),
  };
}

/**
 * Compare if signal's company matches any of contact's companies
 * Returns true if they match (exact or fuzzy)
 */
export async function compareContactCompanies(
  contact: any,
  signalCompanyName?: string,
  threshold: number = 0.8,
): Promise<boolean> {
  if (!signalCompanyName || !contact.companies?.length) {
    return false;
  }

  const normalizedSignalCompany = normalizeCompanyName(signalCompanyName);

  // Populate companies if needed
  let companies = contact.companies;
  if (companies[0] && !companies[0].companyId?.companyName) {
    const populatedContact = await Contact.findById(contact._id).populate("companies.companyId");
    companies = populatedContact?.companies || [];
  }

  // Check each company
  for (const companyObj of companies) {
    const company = companyObj.companyId;
    if (!company) continue;

    const normalizedContactCompany = normalizeCompanyName(company.companyName || "");

    // Exact match
    if (normalizedSignalCompany === normalizedContactCompany) {
      return true;
    }

    // Fuzzy match
    const similarity = calculateSimilarity(normalizedSignalCompany, normalizedContactCompany);
    if (similarity >= threshold) {
      return true;
    }

    // Check legal name too
    if (company.legalName) {
      const legalNameSimilarity = calculateSimilarity(
        normalizedSignalCompany,
        normalizeCompanyName(company.legalName),
      );
      if (legalNameSimilarity >= threshold) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Main cascade matching function
 * Tries all matching strategies in order of confidence
 */
export async function findMatchingContact(signalData: {
  fullName: string;
  companyName?: string;
  linkedinUrl?: string;
  emailAddress?: string;
}): Promise<ContactMatchResult> {
  // Level 1: External IDs (highest confidence)
  const externalMatch = await matchByExternalIds(signalData.linkedinUrl, signalData.emailAddress);
  if (externalMatch.contact) {
    return externalMatch;
  }

  // Level 2: Exact name + company
  const exactMatch = await matchByNameAndCompanyExact(signalData.fullName, signalData.companyName);
  if (exactMatch.contact) {
    return exactMatch;
  }

  // Level 3: Fuzzy name + company
  const fuzzyMatch = await matchByNameAndCompanyFuzzy(signalData.fullName, signalData.companyName);
  if (fuzzyMatch.contact) {
    return fuzzyMatch;
  }

  // Level 4: Name only (low confidence)
  const nameOnlyMatch = await matchByNameOnly(signalData.fullName);
  if (nameOnlyMatch.contact) {
    return nameOnlyMatch;
  }

  // No match found
  return {
    contact: null,
    matchConfidence: MatchConfidence.NONE,
    matchMethod: MatchMethod.NONE,
  };
}
