/**
 * Domain utility functions for hiring pipeline
 */

import { BLOCKED_DOMAINS, RECRUITMENT_AGENCY_KEYWORDS } from "../../config/hiring.config.js";

/**
 * Check if a domain is blocked
 */
export function isDomainBlocked(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return BLOCKED_DOMAINS.some((blocked) => normalized.includes(blocked));
}

/**
 * Check if a domain is a recruitment agency (not an actual Family Office)
 */
export function isRecruitmentAgency(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return RECRUITMENT_AGENCY_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/**
 * Normalize domain for comparison
 */
export function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace("www.", "");
  } catch {
    return null;
  }
}

/**
 * Check if domain should be processed
 */
export function shouldProcessDomain(domain: string): {
  shouldProcess: boolean;
  reason?: string;
} {
  if (isDomainBlocked(domain)) {
    return {
      shouldProcess: false,
      reason: "blocked domain",
    };
  }

  if (isRecruitmentAgency(domain)) {
    return {
      shouldProcess: false,
      reason: "recruitment agency, not a Family Office",
    };
  }

  return { shouldProcess: true };
}
