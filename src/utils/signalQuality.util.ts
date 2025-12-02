/**
 * Signal Quality Utility
 * Filters and scores M&A signals based on quality criteria
 * Helps identify high-value signals and filter out noise
 */

import { normalizeCompanyName } from "./deduplication.util.js";

/**
 * Quality score breakdown
 */
export interface QualityScore {
  total: number; // 0-100
  breakdown: {
    hasCompanyName: boolean; // 20 points
    hasValidDate: boolean; // 20 points
    hasLocation: boolean; // 10 points
    hasSource: boolean; // 15 points
    hasDealValue: boolean; // 10 points
    hasKeyPeople: boolean; // 10 points
    hasDetailedInsights: boolean; // 15 points
  };
  quality: "high" | "medium" | "low";
}

/**
 * Calculate quality score for a signal
 */
export function calculateQualityScore(signal: any): QualityScore {
  const breakdown = {
    hasCompanyName: false,
    hasValidDate: false,
    hasLocation: false,
    hasSource: false,
    hasDealValue: false,
    hasKeyPeople: false,
    hasDetailedInsights: false,
  };

  let total = 0;

  // 1. Company name (20 points) - CRITICAL
  const companyName = signal.companyName || signal.fullName || "";
  if (companyName && companyName.trim().length >= 3) {
    breakdown.hasCompanyName = true;
    total += 20;
  }

  // 2. Valid filing date (20 points) - CRITICAL
  if (signal.filingDate) {
    const date = new Date(signal.filingDate);
    if (!isNaN(date.getTime())) {
      breakdown.hasValidDate = true;
      total += 20;
    }
  }

  // 3. Location (10 points)
  if (signal.location && signal.location.trim().length > 0) {
    breakdown.hasLocation = true;
    total += 10;
  }

  // 4. Source URL (15 points)
  if (signal.filingLink || (signal.maEventData?.sources && signal.maEventData.sources.length > 0)) {
    breakdown.hasSource = true;
    total += 15;
  }

  // 5. Deal value (10 points)
  if (
    signal.maEventData?.dealValue &&
    signal.maEventData.dealValue !== "undisclosed" &&
    signal.maEventData.dealValue !== "unknown"
  ) {
    breakdown.hasDealValue = true;
    total += 10;
  }

  // 6. Key people (10 points)
  if (signal.keyPeople && signal.keyPeople.length > 0) {
    breakdown.hasKeyPeople = true;
    total += 10;
  }

  // 7. Detailed insights (15 points)
  if (signal.insights && signal.insights.trim().length >= 50) {
    breakdown.hasDetailedInsights = true;
    total += 15;
  }

  // Determine quality tier
  let quality: "high" | "medium" | "low";
  if (total >= 70) {
    quality = "high";
  } else if (total >= 40) {
    quality = "medium";
  } else {
    quality = "low";
  }

  return {
    total,
    breakdown,
    quality,
  };
}

/**
 * Check if signal meets minimum quality threshold
 */
export function meetsMinimumQuality(signal: any, minScore: number = 40): boolean {
  const score = calculateQualityScore(signal);
  return score.total >= minScore;
}

/**
 * Validate signal data for logical consistency
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSignalLogic(signal: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Company name validation
  if (!signal.companyName && !signal.fullName) {
    errors.push("Missing company name");
  } else {
    const name = signal.companyName || signal.fullName;
    const normalized = normalizeCompanyName(name);

    if (normalized.length < 2) {
      errors.push("Company name too short or invalid");
    }

    // Check for placeholder names
    const invalidNames = ["unknown", "n/a", "tbd", "test", "example"];
    if (invalidNames.includes(normalized)) {
      errors.push(`Invalid company name: ${name}`);
    }
  }

  // 2. Date validation
  if (!signal.filingDate) {
    errors.push("Missing filing date");
  } else {
    const date = new Date(signal.filingDate);
    if (isNaN(date.getTime())) {
      errors.push("Invalid filing date format");
    } else {
      // Check if date is in the future
      if (date > new Date()) {
        errors.push("Filing date is in the future");
      }

      // Check if date is too old (>10 years)
      const tenYearsAgo = new Date();
      tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
      if (date < tenYearsAgo) {
        warnings.push("Filing date is more than 10 years old");
      }
    }
  }

  // 3. M&A event validation
  if (signal.signalType === "ma-event" && signal.maEventData) {
    // Check for buyer/seller confusion
    if (signal.maEventData.eventType === "acquisition") {
      if (
        signal.targetCompany?.name &&
        signal.acquiringCompany?.name &&
        normalizeCompanyName(signal.targetCompany.name) ===
          normalizeCompanyName(signal.acquiringCompany.name)
      ) {
        errors.push("Target and acquirer are the same company");
      }

      // Acquisitions should have an acquirer
      if (!signal.maEventData.acquiringCompany && !signal.acquiringCompany?.name) {
        warnings.push("Acquisition event missing acquirer");
      }
    }

    // Check for reasonable deal values
    if (signal.maEventData.dealValue) {
      const value = signal.maEventData.dealValue.toLowerCase();
      // Extract number from strings like "$50M", "$2.5B"
      const match = value.match(/[\d.]+/);
      if (match) {
        const num = parseFloat(match[0]);
        if (num > 0 && num < 0.01) {
          warnings.push("Deal value seems unrealistically low");
        }
        if (value.includes("t") || num > 1000) {
          // Trillions
          warnings.push("Deal value seems unrealistically high");
        }
      }
    }
  }

  // 4. Source validation
  if (
    !signal.filingLink &&
    (!signal.maEventData?.sources || signal.maEventData.sources.length === 0)
  ) {
    warnings.push("No source URL provided");
  }

  // 5. Signal type validation
  const validSignalTypes = [
    "form-4",
    "form-13d",
    "form-13f",
    "form-13g",
    "def-14a",
    "form-10k",
    "form-10q",
    "form-8k",
    "form-d",
    "form-s3",
    "ma-event",
  ];

  if (!validSignalTypes.includes(signal.signalType)) {
    warnings.push(`Unknown signal type: ${signal.signalType}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Filter signals by quality threshold
 */
export function filterByQuality(
  signals: any[],
  minScore: number = 40,
): { passed: any[]; filtered: any[] } {
  const passed: any[] = [];
  const filtered: any[] = [];

  for (const signal of signals) {
    if (meetsMinimumQuality(signal, minScore)) {
      passed.push(signal);
    } else {
      filtered.push(signal);
    }
  }

  console.log(`\n📊 Quality filtering results:`);
  console.log(`   ✅ Passed: ${passed.length} signals`);
  console.log(`   ❌ Filtered: ${filtered.length} signals`);

  return { passed, filtered };
}

/**
 * Filter signals by validation
 */
export function filterByValidation(signals: any[]): { valid: any[]; invalid: any[] } {
  const valid: any[] = [];
  const invalid: any[] = [];

  for (const signal of signals) {
    const validation = validateSignalLogic(signal);

    if (validation.isValid) {
      valid.push(signal);

      // Log warnings for valid signals
      if (validation.warnings.length > 0) {
        console.log(`   ⚠️  ${signal.companyName}: ${validation.warnings.join(", ")}`);
      }
    } else {
      invalid.push(signal);
      console.log(`   ❌ ${signal.companyName}: ${validation.errors.join(", ")}`);
    }
  }

  console.log(`\n✅ Validation results:`);
  console.log(`   Valid: ${valid.length} signals`);
  console.log(`   Invalid: ${invalid.length} signals`);

  return { valid, invalid };
}

/**
 * Comprehensive signal filtering
 * Combines quality and validation checks
 */
export function filterSignals(
  signals: any[],
  options: {
    minQualityScore?: number;
    validateLogic?: boolean;
  } = {},
): any[] {
  const { minQualityScore = 40, validateLogic = true } = options;

  console.log(`\n🔬 Filtering ${signals.length} signals...`);
  console.log(`   Min quality score: ${minQualityScore}`);
  console.log(`   Validate logic: ${validateLogic}`);

  let filtered = [...signals];

  // Step 1: Quality filtering
  const qualityResult = filterByQuality(filtered, minQualityScore);
  filtered = qualityResult.passed;

  // Step 2: Validation filtering (if enabled)
  if (validateLogic) {
    const validationResult = filterByValidation(filtered);
    filtered = validationResult.valid;
  }

  console.log(`\n✅ Final result: ${filtered.length} high-quality signals`);
  return filtered;
}

/**
 * Get quality statistics for a batch of signals
 */
export function getQualityStats(signals: any[]): any {
  const scores = signals.map((s) => calculateQualityScore(s));

  const highQuality = scores.filter((s) => s.quality === "high").length;
  const mediumQuality = scores.filter((s) => s.quality === "medium").length;
  const lowQuality = scores.filter((s) => s.quality === "low").length;

  const totalScore = scores.reduce((sum, s) => sum + s.total, 0);
  const avgScore = signals.length > 0 ? (totalScore / signals.length).toFixed(2) : "0";

  return {
    total: signals.length,
    highQuality,
    mediumQuality,
    lowQuality,
    avgScore,
    distribution: {
      high: ((highQuality / signals.length) * 100).toFixed(1) + "%",
      medium: ((mediumQuality / signals.length) * 100).toFixed(1) + "%",
      low: ((lowQuality / signals.length) * 100).toFixed(1) + "%",
    },
  };
}

/**
 * Identify high-value signals (quality score >= 70)
 */
export function identifyHighValueSignals(signals: any[]): any[] {
  return signals.filter((signal) => {
    const score = calculateQualityScore(signal);
    return score.total >= 70;
  });
}
