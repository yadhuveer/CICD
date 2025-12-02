import express from "express";

import {
  scrapeForm13Signals,
  scrapeForm13DGToSignals,
  processForm13XMLsToSignals,
  scrapeFormS3ToSignals,
  scrapeFormS3FromUrl,
  getS3Stats,
  scrapeFormDSignals,
  scrapeFormDToSignals,
  processFormDXMLsToSignals,
  getFormDStats,
  scrapeFormDRaw,
  scrapeForm8KToSignals,
  scrapeForm8KFromUrl,
  get8KStats,
  get8KEventStats,
  scrapeForm8KRaw,
  process13FToInstitutional,
  getInstitutionalStats,
} from "../controllers/scraping.controller.js";
import { scrapeS3 } from "../services/scraping/liquiditySignals/commonScraping.service.js";
import { scrapeAircraftData } from "../services/scraping/nonLiquidity/aircraftAndVessels.service.js";
import { getScrapingLinks } from "../services/scraping/nonLiquidity/art&collections.service.js";
import {
  scrapeTaxProfessionals,
  scrapeTaxProfessionalsIndividual,
} from "../helpers/scrapeTaxEtorny.js";
import { analyzeDocumentsBatch } from "../tools/AiAgents/enritchmentAgent/insightsEnritchment.agent.js";
import {
  enrichContactData,
  enrichContactsBatch,
  type ContactEnrichmentInput,
} from "../tools/AiAgents/enritchmentAgent/contactDataEnrichment.agent.js";

import { exportContactsPdf } from "../controllers/export.controller.js";

const router = express.Router();

/////////////////////////////////////////////////////////////////////////////////////
// Schedule 13D/G Scraping Routes
/////////////////////////////////////////////////////////////////////////////////////

/**
 * NEW PIPELINE: Scrape latest Schedule 13D/G filings → Signals
 * GET /api/test/scrape-13dg-signals?limit=20
 * This endpoint uses the optimized pipeline that goes directly to Signal schema
 */
router.get("/scrape-13dg-signals", scrapeForm13DGToSignals);

/**
 * Process XML strings to Signals
 * POST /api/test/process-13dg-xmls
 * Body: { xmlStrings: string[], filingLinks?: string[] }
 * Useful for reprocessing existing XML data
 */
router.post("/process-13dg-xmls", processForm13XMLsToSignals);

/**
 * LEGACY: Scrape 13D/G XMLs (returns raw XML, does not create Signals)
 * POST /api/test/scrapeForm13D
 */

router.post("/scrapeForm13D", scrapeForm13Signals);

router.post("/scrapeFormD", scrapeFormDSignals);

router.post("/process-s1-signals", async (req, res) => {
  try {
    const result = await scrapeS3();
    return res.json({ success: true, data: result });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/////////////////////////////////////////////////////////////////////////////////////
// S-3 Registration Statement Scraping Routes
/////////////////////////////////////////////////////////////////////////////////////

/**
 * NEW PIPELINE: Scrape latest S-3 filings → Signals
 * GET /api/test/scrape-s3-signals?limit=5
 * This endpoint uses the optimized pipeline that goes directly to Signal schema
 */
router.get("/scrape-s3-signals", scrapeFormS3ToSignals);

/**
 * Scrape S-3 from a specific URL
 * GET /api/test/scrape-s3-url?url=https://www.sec.gov/...
 */
router.get("/scrape-s3-url", scrapeFormS3FromUrl);

/**
 * Get enrichment statistics for S-3 signals
 * GET /api/test/s3-stats
 */
router.get("/s3-stats", getS3Stats);

/////////////////////////////////////////////////////////////////////////////////////
// Form 8-K Current Report Scraping Routes
/////////////////////////////////////////////////////////////////////////////////////

/**
 * NEW PIPELINE: Scrape latest Form 8-K filings → Signals
 * GET /api/test/scrape-8k-signals?limit=5
 * This endpoint uses the optimized pipeline that goes directly to Signal schema
 *
 * Form 8-K reports material corporate events such as:
 * - Officer/director changes (Item 5.02) - High value signals
 * - Financial results (Item 2.02)
 * - Acquisitions/dispositions (Item 2.01)
 * - Material agreements (Item 1.01)
 */
router.get("/scrape-8k-signals", scrapeForm8KToSignals);

/**
 * Scrape Form 8-K from a specific URL
 * GET /api/test/scrape-8k-url?url=https://www.sec.gov/...
 */
router.get("/scrape-8k-url", scrapeForm8KFromUrl);

/**
 * Get enrichment statistics for Form 8-K signals
 * GET /api/test/8k-stats
 * Returns: total signals, enrichment status breakdown
 */
router.get("/8k-stats", get8KStats);

/**
 * Get event type statistics for Form 8-K signals
 * GET /api/test/8k-event-stats
 * Returns: breakdown of Item numbers (e.g., how many Item 5.02 officer changes)
 */
router.get("/8k-event-stats", get8KEventStats);

/**
 * LEGACY: Scrape Form 8-K XMLs (returns raw XML, does not create Signals)
 * POST /api/test/scrapeForm8K
 */
router.post("/scrapeForm8K", scrapeForm8KRaw);

/////////////////////////////////////////////////////////////////////////////////////
// Form D Notice of Exempt Offering Scraping Routes
/////////////////////////////////////////////////////////////////////////////////////

/**
 * NEW PIPELINE: Scrape latest Form D filings → Signals
 * GET /api/test/scrape-formd-signals?limit=20
 * This endpoint uses the optimized pipeline that goes directly to Signal schema
 *
 * Form D reports private placements and exempt offerings:
 * - Captures executives, directors, and promoters
 * - Tracks fundraising activities (Rule 506(b), 506(c), etc.)
 * - Identifies key decision-makers in private capital raises
 */
router.get("/scrape-formd-signals", scrapeFormDToSignals);

/**
 * Process XML strings to Signals
 * POST /api/test/process-formd-xmls
 * Body: { xmlStrings: string[], filingLinks?: string[] }
 * Useful for reprocessing existing XML data
 */
router.post("/process-formd-xmls", processFormDXMLsToSignals);

/**
 * Get enrichment statistics for Form D signals
 * GET /api/test/formd-stats
 * Returns: total signals, enrichment status breakdown, signal source breakdown
 */
router.get("/formd-stats", getFormDStats);

/**
 * LEGACY: Scrape Form D XMLs (returns raw XML, does not create Signals)
 * POST /api/test/scrapeFormD
 */
router.post("/scrapeFormD", scrapeFormDRaw);

/////////////////////////////////////////////////////////////////////////////////////
// Form 13F Institutional Holdings Pipeline Routes
/////////////////////////////////////////////////////////////////////////////////////

/**
 * NEW PIPELINE: Process Form 13F filings to InstitutionalFiler and InstitutionalHolding schemas
 * POST /api/test/process-13f-institutional
 * Body: { limit?: number } (optional, defaults to all available data)
 *
 * This endpoint:
 * - Fetches scraped Form 13F data from scrape13FNew()
 * - Populates InstitutionalFiler schema with manager info
 * - Populates InstitutionalHolding schema with ALL holdings
 * - Calculates quarter-on-quarter changes automatically
 * - Handles missing quarters (assumes UNCHANGED)
 * - Marks EXITED positions
 */
router.post("/process-13f-institutional", process13FToInstitutional);

/**
 * Get institutional holdings statistics
 * GET /api/test/institutional-stats
 * Returns:
 * - Total filers tracked
 * - Total holdings tracked
 * - Holdings breakdown by changeType (NEW, INCREASED, DECREASED, UNCHANGED, EXITED)
 * - Top filers by portfolio value
 * - Biggest increases and decreases
 */
router.get("/institutional-stats", getInstitutionalStats);

/////////////////////////////////////////////////////////////////////////////////////
// Non-Liquidity Event Scraping Routes (Aircraft & Vessels)
/////////////////////////////////////////////////////////////////////////////////////

router.get("/scrape-aircraft-data", async (req, res) => {
  try {
    console.log("📡 API: Starting aircraft data scraping...");

    await scrapeAircraftData();

    return res.json({
      success: true,
      message: "Aircraft data scraped and saved successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/////////////////////////////////////////////////////////////////////////////////////
// Art & Collectibles Scraping Routes
/////////////////////////////////////////////////////////////////////////////////////

router.get("/scrape-art-links", async (req, res) => {
  try {
    console.log("📡 API: Starting art & collectibles link discovery...");

    // Optional query parameter to search for specific artist/entity
    const baseQuery = req.query.query as string | undefined;

    const results = await getScrapingLinks(baseQuery);

    return res.json({
      success: true,
      message: "Art & collectibles transaction pages discovered successfully",
      data: {
        totalResults: results.length,
        searchQuery: baseQuery || "recent high-value art transactions",
        results: results.map((r) => ({
          url: r.url,
          title: r.title,
          description: r.description,
        })),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/////////////////////////////////////////////////////////////////////////////////////
// Insights Agent Testing Routes
/////////////////////////////////////////////////////////////////////////////////////

/**
 * Batch analyze multiple documents
 * POST /api/test/insights/batch
 * Body: { documents: string[] }
 *
 * Example Body:
 * {
 *   "documents": [
 *     "Form 4: CEO sold 10k shares",
 *     "Property sale for $5M",
 *     "M&A deal completed for $100M"
 *   ]
 * }
 */
router.post("/insights/batch", async (req, res) => {
  try {
    console.log("🔍 API: Batch analyzing documents with Insights Agent...");

    const { documents } = req.body;

    if (!documents || !Array.isArray(documents)) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: documents (array of strings)",
      });
    }

    const results = await analyzeDocumentsBatch(documents);

    return res.json({
      success: true,
      totalDocuments: documents.length,
      data: results,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("❌ Insights Agent Batch Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

router.post("/sacrapeTaxAtternoy", async (req, res) => {
  try {
    const pageLimit = req.body.limt;
    const result = await scrapeTaxProfessionals(pageLimit);
    return res.status(200).json({ result: result });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

router.post("/sacrapeTaxAtternoyIndividual", async (req, res) => {
  try {
    const pageLimit = req.body.limt;
    const designation = req.body.name;
    const result = await scrapeTaxProfessionalsIndividual(pageLimit, designation);
    return res.status(200).json({ result: result });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

router.post("/getExtraEnrichmentdetailsDetails", async (req, res) => {
  try {
    console.log("Starting contact enrichment with GROK");

    const { contactIds } = req.body;

    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: contactIds (array of contact IDs)",
      });
    }

    const { Contact } = await import("../models/Contacts.model.js");
    const { SignalNew } = await import("../models/newSignal.model.js");
    const { enrichContactWithSignals } = await import("../helpers/test.helper.js");

    // Get all contacts with their linked signals
    const enrichmentResults: any[] = [];

    for (const contactId of contactIds) {
      try {
        console.log(`\n Processing contact: ${contactId}`);

        const contact = await Contact.findById(contactId).lean();

        if (!contact) {
          console.log(` Contact ${contactId} not found, skipping...`);
          enrichmentResults.push({
            contactId,
            success: false,
            error: "Contact not found",
          });
          continue;
        }

        // get all linked signals
        const signalIds = contact.signals?.map((s: any) => s.signalId) || [];
        const signals = await SignalNew.find({ _id: { $in: signalIds } }).lean();

        // Prepare enrichment input
        const enrichmentInput = {
          contactId: contact._id.toString(),
          fullName: contact.fullName,
          emailAddress: contact.emailAddress,
          phoneNumber: contact.phoneNumber,
          linkedinUrl: contact.linkedinUrl,
          companyName: contact.companyName,
          dateOfBirth: contact.dateOfBirth,
          age: contact.age,
          designation: (contact.companies as any)?.[0]?.designation,
          location: contact.primaryAddress,
          signals: signals.map((signal: any) => ({
            signalId: signal._id.toString(),
            signalType: signal.signalType,
            filingType: signal.filingType,
            filingLink: signal.filingLink,
            filingDate: signal.filingDate,
            insights: signal.insights,
            fullName: signal.fullName,
            designation: signal.designation,
            companyName: signal.companyName,
            form4Data: signal.form4Data,
            form13Data: signal.form13Data,
            form8kData: signal.form8kData,
            maEventData: signal.maEventData,
            jobPostingData: signal.jobPostingData,
            dafContributionData: signal.dafContributionData,
            nextGenData: signal.nextGenData,
            k1IncomeData: signal.k1IncomeData,
          })),
        };

        // Call enrichment function
        const enrichedData = await enrichContactWithSignals(enrichmentInput);

        enrichmentResults.push({
          contactId,
          success: true,
          data: enrichedData,
        });

        console.log(`Successfully enriched ${contact.fullName}`);
      } catch (contactError: any) {
        console.error(`Error enriching contact ${contactId}:`, contactError.message);
        enrichmentResults.push({
          contactId,
          success: false,
          error: contactError.message,
        });
      }
    }

    // Return results
    console.log(
      `Enrichment complete: ${enrichmentResults.filter((r) => r.success).length}/${contactIds.length} successful`,
    );

    return res.json({
      success: true,
      message: `Enriched ${enrichmentResults.filter((r) => r.success).length} out of ${contactIds.length} contacts`,
      totalRequested: contactIds.length,
      successfulEnrichments: enrichmentResults.filter((r) => r.success).length,
      failedEnrichments: enrichmentResults.filter((r) => !r.success).length,
      results: enrichmentResults,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("API Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/////////////////////////////////////////////////////////////////////////////////////
// Contact Data Enrichment Agent Testing Routes
/////////////////////////////////////////////////////////////////////////////////////

/**
 * Test contact enrichment with Gemini AI
 * POST /api/test/enrich-contact
 *
 * Body: {
 *   "fullName": "John Smith",
 *   "companyName": "Tesla Inc",
 *   "designation": "VP of Engineering",
 *   "linkedinUrl": "https://linkedin.com/in/johnsmith",
 *   "location": "San Francisco, CA",
 *   "age": 45,
 *   "signals": "Recently sold $2M in company stock (Form 4)"
 * }
 */
router.post("/enrich-contact", async (req, res) => {
  try {
    console.log("🔍 API: Testing contact enrichment with Gemini...");

    const contactInput: ContactEnrichmentInput = {
      fullName: req.body.fullName,
      companyName: req.body.companyName,
      designation: req.body.designation,
      linkedinUrl: req.body.linkedinUrl,
      location: req.body.location,
      age: req.body.age,
      signals: req.body.signals,
    };

    if (!contactInput.fullName) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: fullName",
      });
    }

    const enrichedData = await enrichContactData(contactInput);

    return res.json({
      success: true,
      input: contactInput,
      enrichedData: enrichedData,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("❌ Contact Enrichment Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * Batch test contact enrichment
 * POST /api/test/enrich-contacts-batch
 *
 * Body: {
 *   "contacts": [
 *     {
 *       "fullName": "John Smith",
 *       "companyName": "Tesla Inc",
 *       "designation": "VP of Engineering"
 *     },
 *     {
 *       "fullName": "Jane Doe",
 *       "companyName": "Apple Inc",
 *       "designation": "CFO"
 *     }
 *   ]
 * }
 */
router.post("/enrich-contacts-batch", async (req, res) => {
  try {
    console.log("🔍 API: Batch testing contact enrichment with Gemini...");

    const { contacts } = req.body;

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: contacts (array of contact objects)",
      });
    }

    const enrichedResults = await enrichContactsBatch(contacts);

    return res.json({
      success: true,
      totalContacts: contacts.length,
      results: enrichedResults.map((enriched, index) => ({
        input: contacts[index],
        enrichedData: enriched,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("❌ Batch Contact Enrichment Error:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * Export contacts PDF
 * - GET /api/contacts/export?limit=20
 * - GET /api/contacts/export?limit=all
 */
router.get("/contacts/export", exportContactsPdf);

export default router;
