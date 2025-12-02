import axios from "axios";
import { withRetry } from "../../utils/institutional/retry.util.js";
import { sleep } from "../../utils/institutional/array.util.js";
import type { CompanyFiler, Filing } from "../../types/institutional.types.js";

// ✅ CORRECTED: Only your specific 6 companies
export const TARGET_COMPANIES: CompanyFiler[] = [
  { name: "Wolf Hill Capital Management, LP", cik: "0001785988" },
  { name: "Soleus Capital Management, L.P.", cik: "0001802630" },
  { name: "Starboard Value LP", cik: "0001517137" },
  { name: "Corvex Management LP", cik: "0001535472" },
  { name: "PointState Capital LP", cik: "0001509842" },
  { name: "BNP Paribas Asset Management Holding S.A.", cik: "0001520354" },
];

export async function fetchFilings(
  cik: string,
  companyName: string,
  startYear: number,
  endYear: number,
): Promise<Filing[]> {
  const cikPadded = cik.padStart(10, "0");
  const submissionsUrl = `https://data.sec.gov/submissions/CIK${cikPadded}.json`;

  try {
    const response = await withRetry(
      async () =>
        axios.get(submissionsUrl, {
          headers: {
            "User-Agent": "Longwall API research@longwall.com", // Use real email in prod
            Accept: "application/json",
          },
          timeout: 30000,
        }),
      { maxAttempts: 3, initialDelayMs: 2000 },
    );

    const data = response.data;

    if (!data) {
      console.error(`❌ Empty response from SEC for ${companyName}`);
      return [];
    }

    const filings: Filing[] = [];

    // 1. Process "Recent" Filings (The main list usually contains last ~100 filings)
    if (data.filings?.recent) {
      processFilingList(data.filings.recent, cik, companyName, startYear, endYear, filings);
    }

    // 2. Process "Historical" Filings (CRITICAL for big funds)
    // Big funds like BNP have so many filings that 2023/2024 might be in the archives.
    if (data.filings?.files && Array.isArray(data.filings.files)) {
      // We check the first historical file (usually sufficient for 2-3 years back)
      if (data.filings.files.length > 0) {
        const file = data.filings.files[0];
        try {
          const fileUrl = `https://data.sec.gov/submissions/${file.name}`;
          const fileRes = await axios.get(fileUrl, {
            headers: { "User-Agent": "Longwall API research@longwall.com" },
          });
          processFilingList(fileRes.data, cik, companyName, startYear, endYear, filings);
        } catch (err) {
          console.warn(`   ⚠️ Could not fetch historical file for ${companyName}`);
        }
      }
    }

    // Sort: Oldest to Newest (Important for QoQ math)
    filings.sort((a, b) => a.filingDate.localeCompare(b.filingDate));

    // Deduplicate by Accession Number (in case overlap between recent and historical)
    const uniqueFilings = Array.from(new Map(filings.map((f) => [f.accessionNumber, f])).values());

    console.log(
      `   Found ${uniqueFilings.length} filings for ${companyName} (${startYear}-${endYear})`,
    );
    return uniqueFilings;
  } catch (error) {
    console.error(`Error fetching filings for ${companyName}:`, error);
    return [];
  }
}

function processFilingList(
  data: any,
  cik: string,
  companyName: string,
  startYear: number,
  endYear: number,
  filings: Filing[],
) {
  if (!data || !data.accessionNumber) {
    console.warn(`   ⚠️ No accession numbers found in filing data for ${companyName}`);
    return;
  }

  if (!Array.isArray(data.accessionNumber)) {
    console.warn(`   ⚠️ Malformed accession number data for ${companyName}`);
    return;
  }

  for (let i = 0; i < data.accessionNumber.length; i++) {
    try {
      const formType = data.form?.[i]?.trim();
      // Only care about 13F-HR (Holdings Report)
      if (formType !== "13F-HR" && formType !== "13F-HR/A") continue;

      const filingDate = data.filingDate?.[i]; // YYYY-MM-DD
      const reportDate = data.reportDate?.[i]; // YYYY-MM-DD
      const accessionNumber = data.accessionNumber?.[i];

      if (!filingDate || !accessionNumber || !reportDate) continue;

      // Filter by REPORT DATE (quarter period) - Only Q1 2024 onwards
      const reportPeriod = new Date(reportDate);
      const cutoffDate = new Date("2024-03-31"); // Q1 2024 cutoff

      const reportYear = parseInt(reportDate.split("-")[0]);

      // Only include quarters from Q1 2024 onwards within the year range
      if (reportPeriod >= cutoffDate && reportYear >= startYear && reportYear <= endYear) {
        const accessionNoHyphens = accessionNumber.replace(/-/g, "");
        const cikWithoutLeadingZeros = parseInt(cik).toString();
        const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cikWithoutLeadingZeros}/${accessionNoHyphens}/${accessionNumber}-index.htm`;

        filings.push({
          cik,
          companyName,
          accessionNumber,
          filingDate,
          periodOfReport: reportDate || filingDate,
          formType,
          filingUrl,
        });
      }
    } catch (err) {
      console.warn(`   ⚠️ Error processing filing index ${i} for ${companyName}:`, err);
      continue;
    }
  }
}

// Helper for single fetch
export async function fetchAllTargetCompanyFilings(
  startYear: number,
  endYear: number,
): Promise<Map<string, Filing[]>> {
  const filingsByCompany = new Map<string, Filing[]>();

  for (const company of TARGET_COMPANIES) {
    const filings = await fetchFilings(company.cik, company.name, startYear, endYear);
    filingsByCompany.set(company.cik, filings);
    await sleep(200);
  }

  return filingsByCompany;
}
