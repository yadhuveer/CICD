import { fetch13FXMLs, parseHoldingsXML } from "../../utils/institutional/xml-parser.util.js";
import { extract13FDataFromParsed } from "../../tools/AiAgents/scraperAgents/liquidity/Form13FParserAgent.js";
import { deduplicateHoldings } from "../../utils/institutional/holdings-deduplication.util.js";
import { withRetry } from "../../utils/institutional/retry.util.js";
import { sleep } from "../../utils/institutional/array.util.js";
import type { Filing, ScrapedFilingData } from "../../types/institutional.types.js";

export async function scrapeFiling(filing: Filing): Promise<ScrapedFilingData> {
  const xmlData = await withRetry(async () => fetch13FXMLs(filing.cik, filing.accessionNumber), {
    maxAttempts: 3,
    initialDelayMs: 2000,
  });

  // Use AI agent to extract metadata (same as old working code)
  const metadata = await withRetry(async () => extract13FDataFromParsed(xmlData.primaryXml), {
    maxAttempts: 2,
    initialDelayMs: 1000,
  });

  const rawHoldings = await withRetry(async () => parseHoldingsXML(xmlData.infoTableXml), {
    maxAttempts: 2,
    initialDelayMs: 1000,
  });

  const deduplicatedHoldings = deduplicateHoldings(rawHoldings);
  const duplicatesFound = rawHoldings.length - deduplicatedHoldings.length;

  // Use filing dates from SEC API as fallback if XML parsing failed
  const filingDate = metadata.filingDate || filing.filingDate;
  const periodOfReport = metadata.periodOfReport || filing.periodOfReport;

  return {
    filing,
    metadata: {
      managerName: metadata.managerName,
      managerCik: metadata.managerCik || filing.cik,
      managerAddress: metadata.managerAddress,
      managerCity: metadata.managerCity,
      managerState: metadata.managerState,
      managerZipCode: metadata.managerZipCode,
      reportContactName: metadata.reportContactName,
      reportContactTitle: metadata.reportContactTitle,
      reportContactPhone: metadata.reportContactPhone,
      reportContactEmail: metadata.reportContactEmail,
      formType: metadata.formType,
      filingDate,
      periodOfReport,
      accessionNo: metadata.accessionNo || filing.accessionNumber,
      amendmentNumber: metadata.amendmentNumber,
      tableEntryTotal: metadata.tableEntryTotal,
      tableValueTotal: metadata.tableValueTotal,
    },
    holdings: deduplicatedHoldings,
    duplicatesFound,
    totalHoldings: rawHoldings.length,
  };
}

export async function scrapeFilings(filings: Filing[]): Promise<ScrapedFilingData[]> {
  const results: ScrapedFilingData[] = [];
  const BATCH_SIZE = 5; // Process 5 filings in parallel

  // Process filings in batches
  for (let i = 0; i < filings.length; i += BATCH_SIZE) {
    const batch = filings.slice(i, i + BATCH_SIZE);
    console.log(
      `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(filings.length / BATCH_SIZE)} (${batch.length} filings)`,
    );

    // Process batch in parallel
    const batchResults = await Promise.allSettled(batch.map((filing) => scrapeFiling(filing)));

    // Collect successful results
    batchResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        console.error(`Failed: ${batch[index].accessionNumber}`, result.reason);
      }
    });

    // Small delay between batches to avoid overwhelming SEC servers
    if (i + BATCH_SIZE < filings.length) {
      await sleep(500);
    }
  }

  return results;
}
