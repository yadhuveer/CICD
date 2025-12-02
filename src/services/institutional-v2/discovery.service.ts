import axios from "axios";
import type { CompanyFiler } from "../../types/institutional.types.js";
import pLimit from "p-limit";

// Rate limiting for SEC API (reduced to 1 to avoid 403 bloc
const limit = pLimit(1);

let discoveryOffset = 0;
let allCompanies: Array<{ cik_str: number; ticker: string; title: string }> | null = null;
const globalSeenCIKs = new Set<string>();

/**
 * Reset discovery state (call this to start fresh)
 */
export function resetDiscovery() {
  discoveryOffset = 0;
  allCompanies = null;
  globalSeenCIKs.clear();
}

/**
 * Discover active 13F filers from SEC EDGAR dynamically
 * Maintains state across calls to continue from where it left off
 */
export async function discover13FFilers(targetCount: number = 200): Promise<CompanyFiler[]> {
  const discovered: CompanyFiler[] = [];

  try {
    if (!allCompanies) {
      console.log(`   📥 Fetching SEC company tickers data...`);
      const tickersResponse = await axios.get("https://www.sec.gov/files/company_tickers.json", {
        headers: {
          "User-Agent": "Longwall API research@longwall.com",
          Accept: "application/json",
        },
        timeout: 30000,
      });

      allCompanies = Object.values(tickersResponse.data) as Array<{
        cik_str: number;
        ticker: string;
        title: string;
      }>;

      console.log(`   ✅ Found ${allCompanies.length} total SEC companies`);
    } else {
      console.log(`   ✅ Using cached company list (${allCompanies.length} companies)`);
    }

    console.log(`   🔎 Continuing discovery from offset ${discoveryOffset}...`);

    // Step 2: Check companies for 13F filing activity
    const batchSize = 50;

    // Check if we've exhausted all companies
    if (discoveryOffset >= allCompanies.length) {
      console.log(
        `   ⚠️ Reached end of SEC company list (${allCompanies.length} companies checked)`,
      );
      return [];
    }

    let currentOffset = discoveryOffset;

    while (discovered.length < targetCount && currentOffset < allCompanies.length) {
      const batch = allCompanies.slice(currentOffset, currentOffset + batchSize);

      console.log(
        `   📦 Checking companies ${currentOffset}-${currentOffset + batch.length} (Found so far: ${discovered.length}/${targetCount})...`,
      );

      const batchResults = await Promise.allSettled(
        batch.map((company) =>
          limit(async () => {
            const cikStr = company.cik_str.toString();

            // Skip if we already checked this CIK
            if (globalSeenCIKs.has(cikStr)) {
              return null;
            }

            const cik = cikStr.padStart(10, "0");
            globalSeenCIKs.add(cikStr);

            const isActive = await check13FActivity(cik);

            if (isActive) {
              return {
                name: company.title,
                cik,
              };
            }
            return null;
          }),
        ),
      );

      // Collect successful results
      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value) {
          discovered.push(result.value);
          if (discovered.length >= targetCount) break;
        }
      }

      currentOffset += batchSize;

      if (discovered.length >= targetCount) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    discoveryOffset = currentOffset;

    console.log(`   ✅ Discovery complete: Found ${discovered.length} active 13F filers`);
    return discovered;
  } catch (error: any) {
    console.error(` Discovery error:`, error.message);
    console.log(`Falling back to empty discovery list`);
    return [];
  }
}

async function check13FActivity(cik: string): Promise<boolean> {
  try {
    const response = await axios.get(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: {
        "User-Agent": "Longwall API research@longwall.com",
        Accept: "application/json",
      },
      timeout: 10000,
    });

    const recentFilings = response.data.filings?.recent;
    if (!recentFilings?.form || !Array.isArray(recentFilings.form)) {
      return false;
    }

    const now = new Date();
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());

    let count13F = 0;
    for (let i = 0; i < recentFilings.form.length && i < 100; i++) {
      const form = recentFilings.form[i];
      const filingDate = new Date(recentFilings.filingDate[i]);

      if ((form === "13F-HR" || form === "13F-HR/A") && filingDate >= twoYearsAgo) {
        count13F++;
      }
    }

    return count13F >= 2;
  } catch (error) {
    return false;
  }
}

export async function verifyFilerActivity(cik: string): Promise<boolean> {
  return check13FActivity(cik);
}
