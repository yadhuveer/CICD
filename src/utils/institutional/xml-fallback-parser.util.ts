import { parseStringPromise } from "xml2js";

/**
 * Fallback XML parser for when AI fails to extract critical fields
 * Uses traditional XML parsing to extract manager name and contact info
 */
export async function extractMetadataFromXML(xmlString: string): Promise<{
  managerName: string;
  managerCik?: string;
  managerAddress?: string;
  managerCity?: string;
  managerState?: string;
  managerZipCode?: string;
  reportContactName?: string;
  reportContactTitle?: string;
  reportContactPhone?: string;
  reportContactEmail?: string;
  formType: string;
  filingDate: string;
  periodOfReport: string;
  accessionNo?: string;
  amendmentNumber?: string;
  tableEntryTotal?: string;
  tableValueTotal?: string;
}> {
  try {
    const parsed = await parseStringPromise(xmlString, {
      explicitArray: false,
      trim: true,
      normalize: true,
      ignoreAttrs: true,
      tagNameProcessors: [
        (name: string) => name.replace(/^(ns\d+:|xmlns:?|xsi:)/, "").toLowerCase(),
      ],
      attrNameProcessors: [(name: string) => name.replace(/^(ns\d+:|xmlns:?|xsi:)/, "")],
    });

    const ed = parsed.edgarsubmission;
    const coverpage = ed?.formdata?.coverpage;
    const filingmanager = coverpage?.filingmanager;
    const signatureblock = ed?.formdata?.signatureblock;
    const summarypage = ed?.formdata?.summarypage;
    const headerdata = ed?.headerdata;

    // Debug: log the structure to see what we're actually getting
    console.log("📋 XML Structure Check:");
    console.log("  filingmanager:", filingmanager);
    console.log("  filingmanager.name:", filingmanager?.name);
    console.log("  signatureblock.name:", signatureblock?.name);

    // Extract manager info
    const managerName =
      filingmanager?.name || headerdata?.filerinfo?.filer?.name || "Unknown Manager";

    const managerAddress = filingmanager?.address?.street1;
    const managerCity = filingmanager?.address?.city;
    const managerState = filingmanager?.address?.stateorcountry;
    const managerZipCode = filingmanager?.address?.zipcode;
    const managerCik = headerdata?.filerinfo?.filer?.credentials?.cik;

    // Extract contact info from signature block
    const reportContactName = signatureblock?.name;
    const reportContactTitle = signatureblock?.title;
    const reportContactPhone = signatureblock?.phone;

    // Extract form metadata
    const formType = headerdata?.submissiontype || "13F-HR";
    const periodOfReport = formatDate(
      headerdata?.filerinfo?.periodofreport || coverpage?.reportcalendarorquarter,
    );
    const filingDate = formatDate(signatureblock?.signaturedate);

    // Extract summary data
    const tableEntryTotal = summarypage?.tableentrytotal;
    const tableValueTotal = summarypage?.tablevaluetotal;

    return {
      managerName,
      managerCik,
      managerAddress,
      managerCity,
      managerState,
      managerZipCode,
      reportContactName,
      reportContactTitle,
      reportContactPhone,
      reportContactEmail: undefined,
      formType,
      filingDate,
      periodOfReport,
      accessionNo: undefined,
      amendmentNumber: coverpage?.amendmentnumber,
      tableEntryTotal,
      tableValueTotal,
    };
  } catch (error) {
    console.error("❌ XML fallback parser error:", error);
    throw error;
  }
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  // Convert MM-DD-YYYY or MM/DD/YYYY to YYYY-MM-DD
  const parts = dateStr.split(/[-/]/);
  if (parts.length === 3) {
    const [month, day, year] = parts;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return dateStr;
}
