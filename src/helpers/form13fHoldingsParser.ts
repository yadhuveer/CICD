import xml2js from "xml2js";
import logger from "../utils/logger.js";

/**
 * =========================================
 * Form 13F Holdings Parser
 * =========================================
 * Parses the information table XML from Form 13F filings
 * to extract ALL holdings (not just top 10)
 *
 * XML Structure Example:
 * <informationTable>
 *   <infoTable>
 *     <nameOfIssuer>APPLE INC</nameOfIssuer>
 *     <titleOfClass>COM</titleOfClass>
 *     <cusip>037833100</cusip>
 *     <value>1234567</value>
 *     <shrsOrPrnAmt>
 *       <sshPrnamt>100000</sshPrnamt>
 *       <sshPrnamtType>SH</sshPrnamtType>
 *     </shrsOrPrnAmt>
 *     <investmentDiscretion>SOLE</investmentDiscretion>
 *     <votingAuthority>
 *       <Sole>100000</Sole>
 *       <Shared>0</Shared>
 *       <None>0</None>
 *     </votingAuthority>
 *   </infoTable>
 * </informationTable>
 */

export interface Holding {
  issuerName: string;
  titleOfClass?: string;
  cusip: string;
  ticker?: string;
  value: number; // in dollars (already converted from thousands if needed)
  shares: number;
  shareType?: string; // SH, PRN, etc.
  investmentDiscretion?: string; // SOLE, SHARED, DEFINED
  votingAuthority?: {
    sole?: number;
    shared?: number;
    none?: number;
  };
}

/**
 * Parse Form 13F information table XML to extract holdings
 * @param infoTableXml - The information table XML content
 * @param filingDate - The filing date (used to determine value format)
 */
export async function parseForm13FHoldings(
  infoTableXml: string,
  filingDate?: Date | string,
): Promise<Holding[]> {
  try {
    logger.info("📊 Parsing Form 13F information table XML...");

    // Configure xml2js parser
    const parser = new xml2js.Parser({
      explicitArray: false, // Don't wrap single elements in arrays
      trim: true,
      normalize: true,
      ignoreAttrs: false,
      tagNameProcessors: [
        // Remove namespace prefixes (ns1:, com:, etc.)
        (name: string) => name.replace(/^(com:|ns\d+:|xmlns:?)/, ""),
      ],
      attrNameProcessors: [(name: string) => name.replace(/^(com:|ns\d+:|xmlns:?)/, "")],
    });

    // Parse XML to JS object
    const parsed = await parser.parseStringPromise(infoTableXml);

    // Extract holdings array - handle different XML structures
    let infoTableEntries: any[] = [];

    // Try different possible paths where holdings might be
    if (parsed.informationTable?.infoTable) {
      infoTableEntries = Array.isArray(parsed.informationTable.infoTable)
        ? parsed.informationTable.infoTable
        : [parsed.informationTable.infoTable];
    } else if (parsed.infoTable) {
      infoTableEntries = Array.isArray(parsed.infoTable) ? parsed.infoTable : [parsed.infoTable];
    } else if (parsed.edgarSubmission?.formData?.coverPage?.informationTable?.infoTable) {
      const table = parsed.edgarSubmission.formData.coverPage.informationTable.infoTable;
      infoTableEntries = Array.isArray(table) ? table : [table];
    }

    logger.info(`Found ${infoTableEntries.length} holdings in information table`);

    // Determine if we need to multiply by 1000 based on filing date
    // SEC changed format on January 3, 2023:
    // - Before: values in thousands (multiply by 1000)
    // - After: values in actual dollars (no multiplication)
    const SEC_FORMAT_CHANGE_DATE = new Date("2023-01-03");
    const parsedFilingDate = filingDate ? new Date(filingDate) : new Date();
    const shouldMultiplyBy1000 = parsedFilingDate < SEC_FORMAT_CHANGE_DATE;

    logger.info(
      `Filing date: ${parsedFilingDate.toISOString().split("T")[0]}, ` +
        `Values format: ${shouldMultiplyBy1000 ? "thousands (multiply by 1000)" : "actual dollars"}`,
    );

    // Parse each holding entry
    const holdings: Holding[] = [];

    for (const entry of infoTableEntries) {
      try {
        // Extract shares - handle nested structure
        let shares = 0;
        let shareType = "";

        if (entry.shrsOrPrnAmt) {
          shares = parseFloat(entry.shrsOrPrnAmt.sshPrnamt || entry.shrsOrPrnAmt.sshPrnAmt || "0");
          shareType = entry.shrsOrPrnAmt.sshPrnamtType || entry.shrsOrPrnAmt.sshPrnAmtType || "SH";
        } else if (entry.sshPrnamt || entry.sshPrnAmt) {
          shares = parseFloat(entry.sshPrnamt || entry.sshPrnAmt || "0");
          shareType = entry.sshPrnamtType || entry.sshPrnAmtType || "SH";
        }

        // Extract value and convert based on filing date
        // Before Jan 3, 2023: values in thousands (need to multiply by 1000)
        // After Jan 3, 2023: values in actual dollars (use as-is)
        let value = parseFloat(entry.value || "0");
        if (shouldMultiplyBy1000) {
          value = value * 1000;
        }

        // Extract voting authority
        let votingAuthority: { sole?: number; shared?: number; none?: number } | undefined;
        if (entry.votingAuthority) {
          votingAuthority = {
            sole: parseFloat(entry.votingAuthority.Sole || entry.votingAuthority.sole || "0"),
            shared: parseFloat(entry.votingAuthority.Shared || entry.votingAuthority.shared || "0"),
            none: parseFloat(entry.votingAuthority.None || entry.votingAuthority.none || "0"),
          };
        }

        // Create holding object
        const holding: Holding = {
          issuerName: entry.nameOfIssuer || entry.issuerName || "",
          titleOfClass: entry.titleOfClass || entry.classTitle,
          cusip: entry.cusip || "",
          value,
          shares,
          shareType: shareType || undefined,
          investmentDiscretion: entry.investmentDiscretion,
          votingAuthority,
        };

        // Only add if we have essential data (cusip and value)
        if (holding.cusip && holding.value > 0) {
          holdings.push(holding);
        }
      } catch (err: any) {
        logger.warn(`Failed to parse holding entry: ${err.message}`);
        // Continue to next entry
      }
    }

    logger.info(`✅ Successfully parsed ${holdings.length} valid holdings`);

    // Log some sample data for verification
    if (holdings.length > 0) {
      logger.info(
        `Sample holding: ${holdings[0].issuerName} (${holdings[0].cusip}) - $${(holdings[0].value / 1000000).toFixed(2)}M, ${holdings[0].shares.toLocaleString()} shares`,
      );
    }

    return holdings;
  } catch (err: any) {
    logger.error(`Error parsing Form 13F holdings XML: ${err.message}`);
    throw new Error(`Failed to parse holdings XML: ${err.message}`);
  }
}

/**
 * Helper function to extract summary statistics from holdings
 */
export function getHoldingsSummary(holdings: Holding[]) {
  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
  const totalHoldings = holdings.length;

  // Get top 10 holdings by value
  const topHoldings = holdings
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((h) => ({
      issuerName: h.issuerName,
      cusip: h.cusip,
      value: h.value,
      shares: h.shares,
      percentOfPortfolio: ((h.value / totalValue) * 100).toFixed(2) + "%",
    }));

  return {
    totalHoldings,
    totalValue,
    topHoldings,
  };
}
