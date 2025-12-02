import axios from "axios";
import * as cheerio from "cheerio";
import { parseStringPromise } from "xml2js";
import { sleep } from "./array.util.js"; // Simple sleep function
import { withRetry } from "./retry.util.js";

const SEC_HEADERS = {
  "User-Agent": "Longwall Research research@longwall.com", // TODO: REPLACE WITH YOUR EMAIL
  "Accept-Encoding": "gzip, deflate",
  Host: "www.sec.gov",
};

/**
 * Scrapes the SEC Index page to find the specific XML links for 13F-HR
 */
export async function fetchAndParse13F(cik: string, accessionNumber: string) {
  const accessionNoHyphens = accessionNumber.replace(/-/g, "");
  const cikNoZeros = parseInt(cik, 10).toString();
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikNoZeros}/${accessionNoHyphens}/${accessionNumber}-index.htm`;

  // Add delay before request to respect SEC rate limits (10 requests per second max)
  await sleep(300); // Increased from 150ms to 300ms

  // Retry logic for SEC rate limits with exponential backoff
  const html = await withRetry(
    async () => {
      const res = await axios.get(indexUrl, { headers: SEC_HEADERS, timeout: 30000 });
      return res.data;
    },
    { maxAttempts: 3, initialDelayMs: 2000 },
    `Fetching index for ${accessionNumber}`,
  );

  const $ = cheerio.load(html);
  let primaryUrl = "";
  let infoTableUrl = "";

  // Iterate ALL tables to find files (more robust than just .tableFile)
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 3) return;

    // Get the description and document type from various cell positions
    const description = $(cells[1]).text().trim().toLowerCase();
    const href = $(cells[2]).find("a").attr("href");
    const docType = cells.length > 3 ? $(cells[3]).text().trim() : "";

    if (!href) return;
    const fullUrl = `https://www.sec.gov${href}`;

    // Logic to identify Primary Doc vs Info Table
    if (
      docType.includes("13F-HR") ||
      description.includes("primary document") ||
      (href.toLowerCase().includes("primary") && href.toLowerCase().endsWith(".xml"))
    ) {
      primaryUrl = fullUrl;
    }

    // Logic to identify Holdings Table (must be XML)
    if (
      href.toLowerCase().endsWith(".xml") &&
      (docType.includes("INFORMATION TABLE") ||
        description.includes("information table") ||
        description.includes("infotable") ||
        href.toLowerCase().includes("infotable"))
    ) {
      infoTableUrl = fullUrl;
    }
  });

  if (!primaryUrl || !infoTableUrl) {
    console.error(`❌ Missing XML components for ${accessionNumber}`);
    console.error(`   Primary URL found: ${primaryUrl || "NONE"}`);
    console.error(`   InfoTable URL found: ${infoTableUrl || "NONE"}`);
    console.error(`   Index URL: ${indexUrl}`);

    // Log all found XML files for debugging
    const allXmlFiles: string[] = [];
    $("table tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length >= 3) {
        const href = $(cells[2]).find("a").attr("href");
        if (href && href.toLowerCase().endsWith(".xml")) {
          allXmlFiles.push(href);
        }
      }
    });
    console.error(`   XML files found in index: ${allXmlFiles.join(", ") || "NONE"}`);

    throw new Error(
      `Missing XML components for ${accessionNumber}. Primary: ${!!primaryUrl}, InfoTable: ${!!infoTableUrl}`,
    );
  }

  // Fetch XML content with delay and retry logic to respect rate limits
  let primaryRes: any, infoTableRes: any;
  try {
    await sleep(200); // Increased from 100ms to 200ms
    primaryRes = await withRetry(
      async () => axios.get(primaryUrl, { headers: SEC_HEADERS, timeout: 30000 }),
      { maxAttempts: 3, initialDelayMs: 2000 },
      `Fetching primary XML for ${accessionNumber}`,
    );

    await sleep(200); // Increased from 100ms to 200ms
    infoTableRes = await withRetry(
      async () => axios.get(infoTableUrl, { headers: SEC_HEADERS, timeout: 30000 }),
      { maxAttempts: 3, initialDelayMs: 2000 },
      `Fetching info table XML for ${accessionNumber}`,
    );
  } catch (xmlErr: any) {
    console.error(`❌ Failed to fetch XML files for ${accessionNumber}:`, xmlErr.message);
    console.error(`   Primary URL: ${primaryUrl}`);
    console.error(`   InfoTable URL: ${infoTableUrl}`);
    throw new Error(`Failed to download XML: ${xmlErr.message}`);
  }

  // Clean XML namespaces (ns1:, com:) for easier parsing
  const cleanName = (name: string) => name.replace(/^(.*:)/, "").toLowerCase();

  try {
    const primaryJson = await parseStringPromise(primaryRes.data, {
      explicitArray: false,
      ignoreAttrs: true,
      tagNameProcessors: [cleanName],
    });
    const infoTableJson = await parseStringPromise(infoTableRes.data, {
      explicitArray: false,
      ignoreAttrs: true,
      tagNameProcessors: [cleanName],
    });

    return { primaryJson, infoTableJson };
  } catch (parseErr: any) {
    console.error(`❌ Failed to parse XML for ${accessionNumber}:`, parseErr.message);
    throw new Error(`XML parsing failed: ${parseErr.message}`);
  }
}

/**
 * Extracts normalized holdings array from raw JSON
 * @param infoTableJson - The parsed information table JSON
 * @param filingDate - The filing date to determine value format (before/after Jan 3, 2023)
 */
export function normalizeHoldings(infoTableJson: any, filingDate?: string) {
  // SEC changed format on January 3, 2023
  // Before: values in thousands (multiply by 1000)
  // After: values in actual dollars (no multiplication)
  const FORMAT_CHANGE_DATE = new Date("2023-01-03");
  const filing = filingDate ? new Date(filingDate) : null;
  const useThousands = !filing || filing < FORMAT_CHANGE_DATE;
  // Try multiple possible paths to find the holdings data
  let entries =
    infoTableJson.informationtable?.infotable ||
    infoTableJson.infotable ||
    infoTableJson.informationTable?.infoTable ||
    infoTableJson;

  if (!entries) {
    console.warn("⚠️ Could not find holdings entries in XML structure");
    console.warn("Available keys:", Object.keys(infoTableJson));
    return [];
  }

  if (!Array.isArray(entries)) entries = [entries]; // Handle single holding case

  return entries
    .map((e: any) => {
      try {
        // Handle "shrsOrPrnAmt" variations (SEC uses different naming conventions)
        const shrsStruct =
          e.shrsorprnamt || e.sshprnamt || e.shrsOrPrnAmt || e.sharesOrPrincipalAmount;

        // Extract shares value from nested structure or direct value
        let shares = 0;
        if (typeof shrsStruct === "object") {
          shares = parseFloat(shrsStruct?.sshprnamt || shrsStruct?.value || 0);
        } else {
          shares = parseFloat(shrsStruct || 0);
        }

        const type = shrsStruct?.sshprnamttype || shrsStruct?.type || "SH";

        // Extract value - format depends on filing date
        // Before Jan 3, 2023: values in thousands (multiply by 1000)
        // After Jan 3, 2023: values in actual dollars
        const rawValue = e.value || e.marketValue || 0;
        const value = parseFloat(rawValue) * (useThousands ? 1000 : 1);

        // Extract CUSIP
        const cusip = (e.cusip || e.CUSIP)?.toString().toUpperCase();

        return {
          issuerName: e.nameofissuer || e.issuername || e.issuerName || e.name,
          titleOfClass: e.titleofclass || e.titleOfClass || e.class,
          cusip: cusip,
          value: value,
          shares: shares,
          shareType: type,
          investmentDiscretion: e.investmentdiscretion || e.investmentDiscretion,
          votingAuthority: {
            sole: parseFloat(e.votingauthority?.sole || e.votingAuthority?.sole || 0),
            shared: parseFloat(e.votingauthority?.shared || e.votingAuthority?.shared || 0),
            none: parseFloat(e.votingauthority?.none || e.votingAuthority?.none || 0),
          },
        };
      } catch (err) {
        console.warn("⚠️ Failed to parse holding entry:", err);
        return null;
      }
    })
    .filter((h: any) => h && h.value > 0 && h.cusip);
}

// Export aliases for backward compatibility with institutional-v2
export async function fetch13FXMLs(cik: string, accessionNumber: string) {
  const result = await fetchAndParse13F(cik, accessionNumber);
  return {
    primaryXml: result.primaryJson,
    infoTableXml: result.infoTableJson,
  };
}

export function parseHoldingsXML(infoTableJson: any) {
  return normalizeHoldings(infoTableJson);
}
