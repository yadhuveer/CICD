import pLimit from "p-limit";
import { InstitutionalFiler } from "../../models/13FInstitutes.model.js";
import { Holding } from "../../models/13FHoldings.model.js";
import { fetchFilings, TARGET_COMPANIES } from "./fetcher.service.js";
import { fetchAndParse13F, normalizeHoldings } from "../../utils/institutional/xml-parser.util.js";
// OLD: import { resolveTickersForHoldings } from "./ticker.service.js";
// OLD: import { enrichHoldingsWithSectors } from "./sector.service.js";
import { enrichHoldingsWithSECSectors } from "./sec-sector-enrichment.service.js";
import { calculateFinancials } from "./calculator.service.js";
import { deduplicateHoldings } from "../../utils/institutional/holdings-deduplication.util.js";
import { discover13FFilers, resetDiscovery } from "./discovery.service.js";

// Concurrency: Process 1 company at a time (reduced to avoid SEC rate limiting and API overload)
const companyLimit = pLimit(1);

export async function processAllCompanies(startYear: number, endYear: number) {
  console.log(`🚀 Starting Robust 13F Pipeline [${startYear}-${endYear}]`);

  // Reset discovery state to start fresh
  resetDiscovery();

  // Track overall stats
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;

  // 1. MANDATORY: Process the 6 target companies FIRST
  console.log(`\n📌 STEP 1: Processing ${TARGET_COMPANIES.length} MANDATORY TARGETS`);
  TARGET_COMPANIES.forEach((c) => console.log(`   • ${c.name} (${c.cik})`));

  const mandatoryTasks = TARGET_COMPANIES.map((company) =>
    companyLimit(() => processSingleCompany(company.cik, startYear, endYear, company.name)),
  );

  const mandatoryResults = await Promise.allSettled(mandatoryTasks);
  const mandatorySuccess = mandatoryResults.filter((r) => r.status === "fulfilled").length;
  const mandatoryFailed = mandatoryResults.filter((r) => r.status === "rejected").length;

  totalProcessed += TARGET_COMPANIES.length;
  totalSucceeded += mandatorySuccess;
  totalFailed += mandatoryFailed;

  console.log(
    `\n✅ Mandatory targets complete: ${mandatorySuccess} succeeded, ${mandatoryFailed} failed`,
  );

  console.log(`\n📌 STEP 2: Incremental Discovery + Processing`);
  console.log(`   Target: Discover and process ALL available 13F filers from SEC`);

  const targetCIKs = new Set(TARGET_COMPANIES.map((c) => c.cik));
  const batchSize = 20; // Discover 20 at a time
  let discoveredCount = 0;
  let consecutiveEmptyBatches = 0;

  while (true) {
    // Discover next batch
    const batchTarget = batchSize;

    console.log(
      `\n🔍 Discovery Batch ${Math.floor(discoveredCount / batchSize) + 1}: Finding ${batchTarget} more filers...`,
    );
    const batchDiscovered = await discover13FFilers(batchTarget);

    // Filter out duplicates
    const uniqueBatch = batchDiscovered.filter((d) => !targetCIKs.has(d.cik));

    if (uniqueBatch.length === 0) {
      consecutiveEmptyBatches++;
      console.log(
        `   ⚠️ No new filers found in this batch (${consecutiveEmptyBatches}/3 empty batches)`,
      );

      // Stop after 3 consecutive empty batches (we've exhausted all filers)
      if (consecutiveEmptyBatches >= 3) {
        console.log(`   🏁 Reached end of SEC 13F filers. Stopping discovery.`);
        break;
      }
      continue;
    }

    // Reset empty batch counter when we find new filers
    consecutiveEmptyBatches = 0;

    // Add to seen CIKs to prevent duplicates in future batches
    uniqueBatch.forEach((c) => targetCIKs.add(c.cik));

    console.log(`   ✅ Discovered ${uniqueBatch.length} new filers`);
    console.log(`   🏃 Processing this batch immediately...`);

    // Process this batch immediately
    const batchTasks = uniqueBatch.map((company) =>
      companyLimit(() => processSingleCompany(company.cik, startYear, endYear, company.name)),
    );

    const batchResults = await Promise.allSettled(batchTasks);
    const batchSuccess = batchResults.filter((r) => r.status === "fulfilled").length;
    const batchFailed = batchResults.filter((r) => r.status === "rejected").length;

    totalProcessed += uniqueBatch.length;
    totalSucceeded += batchSuccess;
    totalFailed += batchFailed;
    discoveredCount += uniqueBatch.length;

    console.log(`   ✅ Batch complete: ${batchSuccess} succeeded, ${batchFailed} failed`);
    console.log(`   📊 Total discovered filers processed so far: ${discoveredCount}`);
  }

  console.log(`\n🎉 PIPELINE COMPLETE!`);
  console.log(`   • Mandatory Targets: ${TARGET_COMPANIES.length} (${mandatorySuccess} succeeded)`);
  console.log(
    `   • Discovered Filers: ${discoveredCount} (${totalSucceeded - mandatorySuccess} succeeded)`,
  );
  console.log(`   • Total Processed: ${totalProcessed}`);
  console.log(`   • Total Succeeded: ${totalSucceeded}`);
  console.log(`   • Total Failed: ${totalFailed}`);

  return {
    success: true,
    message: `Pipeline Complete: ${totalSucceeded} succeeded, ${totalFailed} failed out of ${totalProcessed} total companies`,
    stats: {
      total: totalProcessed,
      succeeded: totalSucceeded,
      failed: totalFailed,
      mandatoryTargets: TARGET_COMPANIES.length,
      discoveredFilers: discoveredCount,
    },
  };
}

export async function processSingleCompany(
  cik: string,
  startYear: number,
  endYear: number,
  knownName?: string,
) {
  const name = knownName || TARGET_COMPANIES.find((c) => c.cik === cik)?.name || `CIK:${cik}`;

  try {
    console.log(`\n🏢 Starting ${name} (${cik})`);
    const filings = await fetchFilings(cik, name, startYear, endYear);

    if (!filings.length) {
      console.log(`   ⚠️ No filings found for ${name}`);
      return { processed: 0, reason: "No filings found" };
    }

    let filerDoc = await InstitutionalFiler.findOne({ cik });
    if (!filerDoc) {
      console.log(`   📝 Creating new filer document for ${name}`);
      filerDoc = new InstitutionalFiler({ cik, filerName: name, quarterlyReports: [] });
    } else {
      console.log(`   ✓ Found existing filer with ${filerDoc.quarterlyReports.length} reports`);
    }

    // Sort Oldest -> Newest (Crucial for QoQ Math)
    filings.sort((a, b) => a.filingDate.localeCompare(b.filingDate));

    let processedCount = 0;
    let skippedCount = 0;

    for (const filing of filings) {
      // Optimization: Skip if we already have this specific filing (Accession Number)
      if (filerDoc.quarterlyReports.some((q) => q.accessionNumber === filing.accessionNumber)) {
        skippedCount++;
        continue;
      }

      console.log(`📄 Processing ${name} - ${filing.periodOfReport} (${filing.accessionNumber})`);

      try {
        // A. Fetch & Parse XML
        const { primaryJson, infoTableJson } = await fetchAndParse13F(cik, filing.accessionNumber);

        // B. Extract Metadata
        const formData = primaryJson.edgarsubmission?.formdata || primaryJson;
        const managerName = formData.coverpage?.filingmanager?.name || name;
        const reportPeriod = formData.coverpage?.reportcalendarorquarter || filing.periodOfReport;

        // C. Normalize & Deduplicate Holdings (pass filing date for correct value format)
        const rawHoldings = normalizeHoldings(infoTableJson, filing.filingDate);
        console.log(`   📊 Found ${rawHoldings.length} raw holdings`);

        const dedupedHoldings = deduplicateHoldings(rawHoldings);
        if (dedupedHoldings.length !== rawHoldings.length) {
          console.log(`   🔄 Deduplicated to ${dedupedHoldings.length} holdings`);
        }

        // D. Enrich (Tickers & Sectors) - NEW: Using SEC's free data!
        const enrichedHoldings = await enrichHoldingsWithSECSectors(dedupedHoldings);

        // E. Calculate Financials (Compare to previous quarter in DB)
        const lastQuarter = filerDoc!.quarterlyReports[filerDoc!.quarterlyReports.length - 1];
        let lastQuarterHoldings: any[] | null = null;

        // Fetch previous quarter holdings from separate collection (grouped document)
        if (lastQuarter) {
          const previousQuarterDoc = await Holding.findOne({
            cik: cik,
            quarter: lastQuarter.quarter,
          }).lean();

          lastQuarterHoldings = previousQuarterDoc?.holdings || null;
        }

        const { enrichedHoldings: finalEnrichedHoldings, stats } = calculateFinancials(
          enrichedHoldings,
          lastQuarterHoldings,
        );

        // F. Build Quarter String
        const quarterStr = calculateQuarterString(reportPeriod);

        // F.1. Check if this quarter already exists in quarterly reports
        const quarterExists = filerDoc!.quarterlyReports.some((r) => r.quarter === quarterStr);

        if (quarterExists) {
          console.log(`   ⏭️  Skipping ${quarterStr} - already in quarterly reports`);
          continue;
        }

        // G. Build Quarterly Report Object (WITHOUT holdings array)
        const newReport = {
          quarter: quarterStr,
          periodOfReport: new Date(reportPeriod),
          filingDate: new Date(filing.filingDate),
          accessionNumber: filing.accessionNumber,
          summary: {
            totalHoldingsCount: finalEnrichedHoldings.filter((h) => h.changeType !== "EXITED")
              .length,
            totalMarketValue:
              stats.totalValueChange + (lastQuarter?.summary?.totalMarketValue || 0),
          },
          portfolioChanges: stats,
          sectorBreakdown: calculateSectorBreakdown(finalEnrichedHoldings),
        };

        // H. Save Holdings to Separate Collection (Grouped by Quarter)
        // Check if holdings already exist for this quarter to avoid duplicate key errors
        const existingHoldings = await Holding.findOne({ cik, quarter: quarterStr });

        if (existingHoldings) {
          console.log(`   💾 Holdings for ${quarterStr} already exist, updating instead`);
          // Clear existing holdings and push new ones to maintain Mongoose DocumentArray type
          existingHoldings.holdings.splice(0, existingHoldings.holdings.length);
          existingHoldings.holdings.push(...finalEnrichedHoldings);
          existingHoldings.filerName = managerName;
          existingHoldings.accessionNumber = filing.accessionNumber;
          await existingHoldings.save();
        } else {
          const quarterlyHoldings = new Holding({
            cik: cik,
            filerName: managerName,
            quarter: quarterStr,
            accessionNumber: filing.accessionNumber,
            holdings: finalEnrichedHoldings, // All holdings in single document
          });
          await quarterlyHoldings.save();
          console.log(
            `   💾 Saved ${finalEnrichedHoldings.length} holdings to separate collection (grouped)`,
          );
        }

        // I. Save Quarterly Report (summary only, no holdings)
        filerDoc!.quarterlyReports.push(newReport);
        filerDoc!.filerName = managerName;
        filerDoc!.latestActivity = {
          lastReportedQuarter: newReport.quarter,
          lastFilingDate: newReport.filingDate,
          currentMarketValue: newReport.summary.totalMarketValue,
          currentHoldingsCount: newReport.summary.totalHoldingsCount,
          lastUpdated: new Date(),
        };

        await filerDoc!.save();
        processedCount++;

        console.log(
          `   ✅ Saved ${newReport.quarter}: ${newReport.summary.totalHoldingsCount} holdings, $${(newReport.summary.totalMarketValue / 1_000_000).toFixed(1)}M portfolio`,
        );
      } catch (innerErr) {
        const errMsg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        console.error(`   ⚠️ Failed quarter ${filing.periodOfReport} for ${name}: ${errMsg}`);
        if (innerErr instanceof Error && innerErr.stack) {
          console.error(`   Stack: ${innerErr.stack.split("\n").slice(0, 3).join("\n")}`);
        }
      }
    }

    console.log(
      `   ✅ Completed ${name}: Processed ${processedCount}, Skipped ${skippedCount}, Total ${filings.length} filings`,
    );
    return { processed: processedCount, skipped: skippedCount, company: name };
  } catch (err: any) {
    console.error(`❌ Error processing ${name} (${cik}):`, err.message);
    throw err;
  }
}

function calculateQuarterString(dateStr: string): string {
  const d = new Date(dateStr);
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear().toString().slice(-2);
  const q = Math.floor(m / 3) + 1;
  return `${y}Q${q}`;
}

function calculateSectorBreakdown(holdings: any[]) {
  const active = holdings.filter((h) => h.changeType !== "EXITED");
  const total = active.reduce((sum, h) => sum + h.value, 0);
  const map = new Map<string, number>();
  active.forEach((h) => {
    const s = h.sector || "Unknown";
    map.set(s, (map.get(s) || 0) + h.value);
  });
  return Array.from(map.entries())
    .map(([sector, value]) => ({
      sector,
      value,
      percentage: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}
