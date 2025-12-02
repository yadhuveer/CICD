// // import { analyzeForm4AndStoreSignal } from "../tools/dataToSignal.agent.js";
// import { Form4Filing } from "../models/form4.model.js";
// import { Signal } from "../models/Signals.model.js";
// import logger from "../utils/logger.js";

// /**
//  * Extract and format Form 4 data for the agent
//  */
// function extractForm4DataForAgent(form4Data: any) {
//   // Calculate transaction summaries
//   const nonDerivativeSummary =
//     form4Data.nonDerivativeTransactions?.map((tx: any) => ({
//       securityTitle: tx.securityTitle,
//       transactionDate: tx.transactionDate,
//       transactionCode: tx.transactionCode,
//       shares: tx.transactionShares,
//       pricePerShare: tx.transactionPricePerShare,
//       acquiredDisposed: tx.transactionAcquiredDisposedCode,
//       sharesOwnedAfter: tx.sharesOwnedFollowingTransaction,
//       ownership: tx.directOrIndirectOwnership,
//     })) || [];

//   const derivativeSummary =
//     form4Data.derivativeTransactions?.map((tx: any) => ({
//       securityTitle: tx.securityTitle,
//       transactionDate: tx.transactionDate,
//       transactionCode: tx.transactionCode,
//       shares: tx.transactionShares,
//       pricePerShare: tx.transactionPricePerShare,
//       underlyingSecurity: tx.underlyingSecurityTitle,
//       underlyingShares: tx.underlyingSecurityShares,
//     })) || [];

//   const formattedData = {
//     // Company Information
//     companyName: form4Data.companyName,
//     companyCik: form4Data.companyCik,
//     companyTicker: form4Data.companyTicker,

//     // Insider Information
//     insiderName: form4Data.insiderName,
//     insiderCik: form4Data.insiderCik,
//     insiderRelationship: {
//       isDirector: form4Data.insiderRelationship?.isDirector,
//       isOfficer: form4Data.insiderRelationship?.isOfficer,
//       isTenPercentOwner: form4Data.insiderRelationship?.isTenPercentOwner,
//       isOther: form4Data.insiderRelationship?.isOther,
//       officerTitle: form4Data.insiderRelationship?.officerTitle,
//       otherText: form4Data.insiderRelationship?.otherText,
//     },

//     // Filing Information
//     accession: form4Data.accession,
//     filingDate: form4Data.filingDate,
//     periodOfReport: form4Data.periodOfReport,
//     filingLink: form4Data.filingLink,

//     // Transaction Data
//     nonDerivativeTransactions: nonDerivativeSummary,
//     derivativeTransactions: derivativeSummary,

//     // Additional Information
//     remarks: form4Data.remarks,
//     rawXml: form4Data.rawXml ? `${form4Data.rawXml.substring(0, 500)}...` : undefined, // Truncate for readability
//   };

//   return formattedData;
// }

// /**
//  * Test helper to analyze a Form 4 filing and generate signals
//  *
//  * This function:
//  * 1. Fetches a Form 4 filing from the database by ID
//  * 2. Extracts and formats the data for the agent
//  * 3. Runs it through the AI agent for analysis
//  * 4. Returns insights including sentiment, transaction summary, and key insights
//  */
// export async function testForm4ToSignalAgent(form4Id: string) {
//   try {
//     logger.info(`[Test] Fetching Form 4 filing with ID: ${form4Id}`);

//     // Fetch the Form 4 filing from database
//     const form4Data = await Form4Filing.findById(form4Id).lean();

//     if (!form4Data) {
//       throw new Error(`Form 4 filing with ID ${form4Id} not found`);
//     }

//     logger.info(
//       `[Test] Found Form 4 filing for ${form4Data.companyName} by ${form4Data.insiderName}`,
//     );

//     // Extract and format data for agent
//     const formattedData = extractForm4DataForAgent(form4Data);

//     // Log the transaction details for context
//     const transactionCount =
//       (form4Data.nonDerivativeTransactions?.length || 0) +
//       (form4Data.derivativeTransactions?.length || 0);

//     logger.info(`[Test] Processing ${transactionCount} transaction(s)`);
//     logger.info(`[Test] Sending formatted data to agent:`, {
//       companyName: formattedData.companyName,
//       insiderName: formattedData.insiderName,
//       insiderRole: formattedData.insiderRelationship?.officerTitle || "Director",
//       nonDerivativeCount: formattedData.nonDerivativeTransactions.length,
//       derivativeCount: formattedData.derivativeTransactions.length,
//     });

//     // Run the agent
//     const startTime = Date.now();
//     const result = await analyzeForm4AndStoreSignal(formattedData);
//     const duration = Date.now() - startTime;

//     logger.info(`[Test] Agent completed in ${duration}ms`);

//     return {
//       success: true,
//       duration: `${duration}ms`,
//       input: {
//         form4Id,
//         companyName: form4Data.companyName,
//         companyTicker: form4Data.companyTicker,
//         insiderName: form4Data.insiderName,
//         insiderRole:
//           form4Data.insiderRelationship?.officerTitle ||
//           (form4Data.insiderRelationship?.isDirector ? "Director" : "Unknown"),
//         transactionCount,
//         filingDate: form4Data.filingDate,
//         periodOfReport: form4Data.periodOfReport,
//       },
//       formattedDataSentToAgent: formattedData,
//       agentResult: result,
//     };
//   } catch (error: any) {
//     logger.error(`[Test] Error in testForm4ToSignalAgent:`, error);
//     throw error;
//   }
// }

// /**
//  * Helper to get a random Form 4 filing for testing
//  */
// export async function getRandomForm4ForTest() {
//   try {
//     const count = await Form4Filing.countDocuments();

//     if (count === 0) {
//       throw new Error("No Form 4 filings found in database. Please scrape some data first.");
//     }

//     const random = Math.floor(Math.random() * count);
//     const randomForm4 = await Form4Filing.findOne().skip(random);

//     return randomForm4;
//   } catch (error: any) {
//     logger.error(`[Test] Error fetching random Form 4:`, error);
//     throw error;
//   }
// }

// /**
//  * Helper to get the latest Form 4 filings
//  */
// export async function getLatestForm4Filings(limit: number = 10) {
//   try {
//     const filings = await Form4Filing.find()
//       .sort({ filingDate: -1 })
//       .limit(limit)
//       .select(
//         "_id companyName insiderName filingDate nonDerivativeTransactions derivativeTransactions",
//       );

//     return filings.map((filing) => ({
//       id: filing._id,
//       companyName: filing.companyName,
//       insiderName: filing.insiderName,
//       filingDate: filing.filingDate,
//       transactionCount:
//         (filing.nonDerivativeTransactions?.length || 0) +
//         (filing.derivativeTransactions?.length || 0),
//     }));
//   } catch (error: any) {
//     logger.error(`[Test] Error fetching latest Form 4s:`, error);
//     throw error;
//   }
// }

// /**
//  * Helper to verify signal was saved correctly
//  */
// export async function verifySignalCreation(signalId: string) {
//   try {
//     const signal = await Signal.findById(signalId);

//     if (!signal) {
//       return {
//         success: false,
//         message: `Signal with ID ${signalId} not found`,
//       };
//     }

//     return {
//       success: true,
//       signal: {
//         id: signal._id,
//         filingType: signal.filingType,
//         companyName: signal.companyName,
//         insiderName: signal.insiderName,
//         transactionType: (signal as any).transactionType,
//         sharesTraded: (signal as any).sharesTraded,
//         totalValue: (signal as any).totalValue,
//         createdAt: signal.createdAt,
//       },
//     };
//   } catch (error: any) {
//     logger.error(`[Test] Error verifying signal:`, error);
//     throw error;
//   }
// }

// /**
//  * Helper to create a mock Form 4 data for testing without database
//  */
// export function createMockForm4Data() {
//   return {
//     insiderName: "John Doe",
//     insiderCik: "0001234567",
//     insiderRelationship: {
//       isDirector: true,
//       isOfficer: true,
//       isTenPercentOwner: false,
//       isOther: false,
//       officerTitle: "Chief Executive Officer",
//     },
//     companyName: "Test Corporation",
//     companyCik: "0009876543",
//     companyTicker: "TEST",
//     accession: "0001234567-24-000001",
//     filingDate: new Date("2024-01-15"),
//     periodOfReport: new Date("2024-01-12"),
//     filingLink: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001234567",
//     nonDerivativeTransactions: [
//       {
//         securityTitle: "Common Stock",
//         transactionDate: new Date("2024-01-12"),
//         transactionCode: "S",
//         transactionShares: 50000,
//         transactionPricePerShare: 125.5,
//         transactionAcquiredDisposedCode: "D",
//         sharesOwnedFollowingTransaction: 450000,
//         directOrIndirectOwnership: "D",
//         natureOfOwnership: "Direct",
//         footnotes: [],
//       },
//       {
//         securityTitle: "Common Stock",
//         transactionDate: new Date("2024-01-13"),
//         transactionCode: "S",
//         transactionShares: 25000,
//         transactionPricePerShare: 126.75,
//         transactionAcquiredDisposedCode: "D",
//         sharesOwnedFollowingTransaction: 425000,
//         directOrIndirectOwnership: "D",
//         natureOfOwnership: "Direct",
//         footnotes: [],
//       },
//     ],
//     derivativeTransactions: [],
//     remarks: "Test filing for demonstration purposes",
//     rawXml: "<ownershipDocument>...</ownershipDocument>",
//     contacts: [],
//   };
// }

// /**
//  * Comprehensive test that validates the entire pipeline
//  */
// export async function runComprehensiveTest() {
//   const results = {
//     timestamp: new Date().toISOString(),
//     tests: [] as any[],
//   };

//   try {
//     // Test 1: Check if there are Form 4 filings in database
//     logger.info("[Comprehensive Test] Step 1: Checking database...");
//     const count = await Form4Filing.countDocuments();
//     results.tests.push({
//       name: "Database Check",
//       passed: count > 0,
//       message: `Found ${count} Form 4 filing(s) in database`,
//     });

//     if (count === 0) {
//       results.tests.push({
//         name: "Test Skipped",
//         passed: false,
//         message: "No Form 4 filings available. Please run /test/scrapeForm4 first.",
//       });
//       return results;
//     }

//     // Test 2: Fetch a random filing and analyze it
//     logger.info("[Comprehensive Test] Step 2: Analyzing random Form 4...");
//     const randomForm4 = await getRandomForm4ForTest();

//     if (randomForm4) {
//       const analysisResult = await testForm4ToSignalAgent(randomForm4._id.toString());
//       results.tests.push({
//         name: "Agent Analysis",
//         passed: analysisResult.success,
//         duration: analysisResult.duration,
//         details: analysisResult.input,
//       });

//       // Test 3: Verify signal was created (if agent returns signal ID)
//       if (analysisResult.agentResult?.signalId) {
//         logger.info("[Comprehensive Test] Step 3: Verifying signal creation...");
//         const verification = await verifySignalCreation(analysisResult.agentResult.signalId);
//         results.tests.push({
//           name: "Signal Verification",
//           passed: verification.success,
//           signal: verification.signal,
//         });
//       }
//     }

//     return results;
//   } catch (error: any) {
//     results.tests.push({
//       name: "Test Failed",
//       passed: false,
//       error: error.message,
//     });
//     return results;
//   }
// }
