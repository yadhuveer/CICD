/**
 * Deduplication Utility
 * Multi-layer deduplication for M&A signals to prevent duplicates
 *
 * Layers:
 * 1. Exact URL match
 * 2. Accession number match (for SEC filings)
 * 3. Company name + date window fuzzy match
 * 4. Content hash similarity
 */

import crypto from "crypto";
import { SignalNew } from "../models/newSignal.model.js";

/**
 * Normalize company name for comparison
 * Removes common suffixes and standardizes format
 */
export function normalizeCompanyName(name: string): string {
  if (!name) return "";

  return name
    .trim()
    .toLowerCase()
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|company|co)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * Returns a score from 0 (completely different) to 1 (identical)
 */
export function calculateStringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Levenshtein distance algorithm
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Generate content hash for a signal
 * Used for detecting duplicate content even if some fields differ
 */
export function generateSignalHash(signal: any): string {
  const fingerprint = {
    companyName: normalizeCompanyName(signal.companyName || ""),
    signalType: signal.signalType || "",
    filingDate: signal.filingDate ? new Date(signal.filingDate).toISOString().split("T")[0] : "",
    dealValue: signal.maEventData?.dealValue || "",
  };

  const fingerprintString = JSON.stringify(fingerprint);
  return crypto.createHash("md5").update(fingerprintString).digest("hex");
}

/**
 * Check if signal exists by URL (exact match)
 */
export async function checkDuplicateByURL(url: string): Promise<boolean> {
  if (!url) return false;

  try {
    const existing = await SignalNew.findOne({
      $or: [{ filingLink: url }, { "maEventData.sources.url": url }],
    });

    return !!existing;
  } catch (error) {
    console.error("Error checking duplicate by URL:", error);
    return false;
  }
}

/**
 * Check if signal exists by accession number (for SEC filings)
 */
export async function checkDuplicateByAccession(
  accession: string,
  fullName?: string,
): Promise<boolean> {
  if (!accession) return false;

  try {
    const query: any = { accession };
    if (fullName) {
      query.fullName = fullName;
    }

    const existing = await SignalNew.findOne(query);
    return !!existing;
  } catch (error) {
    console.error("Error checking duplicate by accession:", error);
    return false;
  }
}

/**
 * Check if similar signal exists by company name + date window
 * Uses fuzzy matching to catch variations in company names
 */
export async function checkDuplicateByCompanyAndDate(
  companyName: string,
  filingDate: Date,
  signalType: string,
  dateWindowDays: number = 7,
): Promise<boolean> {
  if (!companyName || !filingDate) return false;

  try {
    const normalizedName = normalizeCompanyName(companyName);
    if (!normalizedName) return false;

    // Calculate date window
    const dateWindow = dateWindowDays * 24 * 60 * 60 * 1000;
    const startDate = new Date(filingDate.getTime() - dateWindow);
    const endDate = new Date(filingDate.getTime() + dateWindow);

    // Find signals within date window and same type
    const candidates = await SignalNew.find({
      signalType,
      filingDate: {
        $gte: startDate,
        $lte: endDate,
      },
    }).select("companyName fullName");

    // Check each candidate for name similarity
    for (const candidate of candidates) {
      const candidateName = normalizeCompanyName(candidate.companyName || candidate.fullName || "");
      if (!candidateName) continue;

      // Calculate similarity
      const similarity = calculateStringSimilarity(normalizedName, candidateName);

      // If similarity is high (>80%), consider it a duplicate
      if (similarity > 0.8) {
        console.log(
          `   🔍 Found similar signal: "${companyName}" ≈ "${candidate.companyName}" (${(similarity * 100).toFixed(1)}%)`,
        );
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("Error checking duplicate by company and date:", error);
    return false;
  }
}

/**
 * Check if signal with similar content hash exists
 */
export async function checkDuplicateByContentHash(signal: any): Promise<boolean> {
  try {
    const signalHash = generateSignalHash(signal);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const recentSignals = await SignalNew.find({
      signalType: signal.signalType,
      createdAt: { $gte: thirtyDaysAgo },
    })
      .select("companyName signalType filingDate maEventData")
      .limit(100); // Limit for performance

    for (const existing of recentSignals) {
      const existingHash = generateSignalHash(existing);
      if (existingHash === signalHash) {
        console.log(`   🔍 Found duplicate by content hash`);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("Error checking duplicate by content hash:", error);
    return false;
  }
}

/**
 * Comprehensive duplicate check using all layers
 * Returns true if signal is a duplicate
 */
export async function isDuplicateSignal(signal: any): Promise<boolean> {
  try {
    // Layer 1: Check by URL (fastest)
    if (signal.filingLink) {
      const urlDuplicate = await checkDuplicateByURL(signal.filingLink);
      if (urlDuplicate) {
        console.log(`   ⏭️  Duplicate detected (URL match): ${signal.companyName}`);
        return true;
      }
    }

    // Check sources URLs if available
    if (signal.maEventData?.sources && Array.isArray(signal.maEventData.sources)) {
      for (const source of signal.maEventData.sources) {
        if (source.url) {
          const sourceDuplicate = await checkDuplicateByURL(source.url);
          if (sourceDuplicate) {
            console.log(`   ⏭️  Duplicate detected (source URL match): ${signal.companyName}`);
            return true;
          }
        }
      }
    }

    // Layer 2: Check by accession (for SEC filings)
    if (signal.accession) {
      const accessionDuplicate = await checkDuplicateByAccession(signal.accession, signal.fullName);
      if (accessionDuplicate) {
        console.log(`   ⏭️  Duplicate detected (accession match): ${signal.companyName}`);
        return true;
      }
    }

    // Layer 3: Check by company name + date window (fuzzy match)
    if (signal.companyName && signal.filingDate) {
      const nameDateDuplicate = await checkDuplicateByCompanyAndDate(
        signal.companyName,
        signal.filingDate,
        signal.signalType,
      );
      if (nameDateDuplicate) {
        console.log(`   ⏭️  Duplicate detected (name + date match): ${signal.companyName}`);
        return true;
      }
    }

    if (signal.signalType === "ma-event") {
      const hashDuplicate = await checkDuplicateByContentHash(signal);
      if (hashDuplicate) {
        console.log(`   ⏭️  Duplicate detected (content hash match): ${signal.companyName}`);
        return true;
      }
    }

    return false;
  } catch (error: any) {
    console.error("Error in duplicate check:", error.message);
    return false;
  }
}

/**
 * Batch check for duplicates
 * More efficient than checking one by one
 */
export async function filterDuplicateSignals(signals: any[]): Promise<any[]> {
  console.log(`\n🔍 Checking ${signals.length} signals for duplicates...`);

  const uniqueSignals: any[] = [];
  let duplicateCount = 0;

  for (const signal of signals) {
    const isDuplicate = await isDuplicateSignal(signal);

    if (!isDuplicate) {
      uniqueSignals.push(signal);
    } else {
      duplicateCount++;
    }
  }

  console.log(`   ✅ Filtered out ${duplicateCount} duplicates`);
  console.log(`   ✅ ${uniqueSignals.length} unique signals remain`);

  return uniqueSignals;
}

/**
 * Get duplicate statistics for monitoring
 */
export async function getDuplicateStats(timeframeDays: number = 7): Promise<any> {
  try {
    const startDate = new Date(Date.now() - timeframeDays * 24 * 60 * 60 * 1000);

    const allSignals = await SignalNew.countDocuments({
      createdAt: { $gte: startDate },
    });

    const companyGroups = await SignalNew.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: "$companyName",
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
    ]);

    const companiesWithMultipleSignals = companyGroups.length;
    const totalDuplicateSignals = companyGroups.reduce((sum, g) => sum + (g.count - 1), 0);

    return {
      timeframeDays,
      totalSignals: allSignals,
      companiesWithMultipleSignals,
      estimatedDuplicates: totalDuplicateSignals,
      deduplicationRate:
        allSignals > 0 ? ((totalDuplicateSignals / allSignals) * 100).toFixed(2) + "%" : "0%",
    };
  } catch (error: any) {
    console.error("Error getting duplicate stats:", error.message);
    return {
      error: error.message,
    };
  }
}
