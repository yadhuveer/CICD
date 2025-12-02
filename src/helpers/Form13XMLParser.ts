/**
 * Parse Schedule 13D/G XML into lightly-cleaned JSON for AI processing
 * This parser handles the new SEC XML format (post-December 2024)
 * XML namespace: http://www.sec.gov/edgar/schedule13D
 *
 * Philosophy: Minimal cleaning - preserve context, let AI agent extract insights
 */

import { parseStringPromise } from "xml2js";

/**
 * Lightly-Parsed Form 13D/G Data Structure
 * This preserves most of the original XML structure for AI agent processing
 */
export interface ParsedForm13Data {
  // Raw parsed XML object (lightly cleaned - only redundant xmlns removed)
  rawParsed: any;

  // Only extract critical identifiers for deduplication/routing
  metadata: {
    submissionType?: string; // "SCHEDULE 13D", "SCHEDULE 13D/A", etc.
    accessionNumber?: string;
    dateOfEvent?: string;
    issuerName?: string;
    issuerCik?: string;
  };
}

/**
 * Parse Schedule 13D/G XML to lightly-cleaned JSON
 * Only removes truly redundant data (namespaces, excessive nesting)
 * Preserves all context for AI agent
 */
export async function parseForm13XML(xmlString: string): Promise<ParsedForm13Data> {
  try {
    // Parse XML with xml2js - minimal processing
    const parsed = await parseStringPromise(xmlString, {
      explicitArray: false, // Don't wrap single elements in arrays
      trim: true, // Trim whitespace
      normalize: true, // Normalize whitespace
      ignoreAttrs: false, // Keep attributes (they may have useful data)
      tagNameProcessors: [
        (name) => name.replace(/^(com:|ns\d+:|xmlns:)/, ""), // Remove namespace prefixes
      ],
      attrNameProcessors: [
        (name) => name.replace(/^(com:|ns\d+:|xmlns:?)/, ""), // Remove namespace from attributes
      ],
    });
    console.log("parsed data 👀👀👀", parsed);

    // Extract only critical metadata for routing/deduplication
    const edgarSubmission = parsed.edgarSubmission || parsed;
    const headerData = edgarSubmission?.headerData || {};
    const formData = edgarSubmission?.formData || {};
    const coverPage = formData?.coverPageHeader || {};
    const issuerInfo = coverPage?.issuerInfo || {};

    const metadata = {
      submissionType: headerData.submissionType || coverPage.submissionType || "",
      accessionNumber:
        headerData.accessionNumber || headerData.filerInfo?.accessionNumber || undefined,
      dateOfEvent: coverPage.dateOfEvent || "",
      issuerName: issuerInfo.issuerName || "",
      issuerCik: issuerInfo.issuerCIK || "",
    };

    return {
      rawParsed: parsed,
      metadata,
    };
  } catch (error: any) {
    console.error("❌ Error parsing Schedule 13D/G XML:", error.message);
    throw new Error(`XML parsing failed: ${error.message}`);
  }
}

/**
 * Generate company name variants for ContactOut API matching
 * IMPORTANT: This generates variations of the ISSUER COMPANY NAME (company being invested in),
 * NOT the investor/reporting person name
 * @param issuerName - The name of the ISSUER company (company being invested in)
 */
export function generateCompanyNameVariants(issuerName: string): string[] {
  const variants: string[] = [];

  // For Form 13D/G, companyNameVariants should ALWAYS be variations of the ISSUER company
  // (the company being invested in), regardless of whether the investor is Individual or Company

  // Add original issuer name
  variants.push(issuerName);

  // Remove common suffixes from issuer name
  const suffixPattern =
    /,?\s*(LP|LLC|L\.L\.C\.|LTD|LIMITED|INC\.|INCORPORATED|CORP\.|CORPORATION|PLC)$/i;
  const baseName = issuerName.replace(suffixPattern, "").trim();

  if (baseName !== issuerName) {
    variants.push(baseName);
  }

  // Add different suffix variations for issuer
  variants.push(`${baseName} Inc.`);
  variants.push(`${baseName} Corporation`);
  variants.push(`${baseName} LLC`);

  // Add abbreviated forms
  const words = baseName.split(" ");
  if (words.length > 1) {
    variants.push(words[0]); // First word only
    variants.push(`${words[0]} ${words[1]}`); // First two words
  }

  // Add with descriptors
  variants.push(`${baseName} Holdings`);
  variants.push(`${baseName} Group`);

  // Remove duplicates and limit to 8 variants
  return [...new Set(variants)].slice(0, 8);
}
