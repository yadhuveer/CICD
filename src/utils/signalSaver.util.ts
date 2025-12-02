/**
 * Signal Saver Utility
 * Shared utility for saving M&A signals to database with deduplication
 * Consolidates duplicate signal saving logic across monitoring services
 */

import { SignalNew } from "../models/newSignal.model.js";
import { isDuplicateSignal } from "./deduplication.util.js";

export interface SignalSaveResult {
  savedCount: number;
  duplicateCount: number;
  errorCount: number;
  errors: Array<{ signal: string; error: string }>;
}

/**
 * Check if a signal with the given URL already exists in database
 */
async function signalExists(url: string): Promise<boolean> {
  if (!url) return false;
  const existing = await SignalNew.findOne({
    "maEventData.sources.url": url,
  });
  return !!existing;
}

/**
 * Save M&A signals to database with comprehensive deduplication
 *
 * @param signals - Array of signals to save
 * @param options - Save options
 * @returns Save results with counts
 */
export async function saveMaSignals(
  signals: any[],
  options: {
    verbose?: boolean;
    skipDuplicateCheck?: boolean;
  } = {},
): Promise<SignalSaveResult> {
  const { verbose = true, skipDuplicateCheck = false } = options;

  const result: SignalSaveResult = {
    savedCount: 0,
    duplicateCount: 0,
    errorCount: 0,
    errors: [],
  };

  for (const signal of signals) {
    try {
      // Quick URL-based duplicate check (faster than full deduplication)
      const url = signal.filingLink || signal.maEventData?.sources?.[0]?.url || "";
      if (url && (await signalExists(url))) {
        if (verbose) {
          console.log(`   ⏭️  Skipping duplicate signal: ${signal.companyName}`);
        }
        result.duplicateCount++;
        continue;
      }

      // Comprehensive duplicate check (unless explicitly skipped)
      if (!skipDuplicateCheck) {
        const isDuplicate = await isDuplicateSignal(signal);
        if (isDuplicate) {
          if (verbose) {
            console.log(`   ⏭️  Duplicate detected: ${signal.companyName}`);
          }
          result.duplicateCount++;
          continue;
        }
      }

      // Save to database
      await SignalNew.create(signal);
      if (verbose) {
        console.log(`   💾 Saved signal: ${signal.companyName} - ${signal.signalType}`);
      }
      result.savedCount++;
    } catch (error: any) {
      // Handle MongoDB duplicate key errors (11000)
      if (error.code === 11000) {
        if (verbose) {
          console.log(`   ⏭️  Duplicate signal skipped: ${signal.companyName}`);
        }
        result.duplicateCount++;
      } else {
        if (verbose) {
          console.error(`   ❌ Error saving signal:`, error.message);
        }
        result.errorCount++;
        result.errors.push({
          signal: signal.companyName || "unknown",
          error: error.message || String(error),
        });
      }
    }
  }

  return result;
}

/**
 * Save a single M&A signal to database
 *
 * @param signal - Signal to save
 * @param verbose - Whether to log verbose output
 * @returns True if saved, false if duplicate or error
 */
export async function saveMaSignal(signal: any, verbose: boolean = true): Promise<boolean> {
  const result = await saveMaSignals([signal], { verbose });
  return result.savedCount > 0;
}
