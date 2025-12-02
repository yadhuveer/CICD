import mongoose from "mongoose";
import { SignalNew } from "../models/newSignal.model.js";
import { Contact } from "../models/Contacts.model.js";
import { Company } from "../models/Company.model.js";
import {
  findMatchingContact,
  compareContactCompanies,
  MatchConfidence,
} from "../utils/contactMatching.util.js";
import { contactOutService } from "./contactout.service.js";
import { findOrCreateCompanyFromSignal, linkContactsToCompany } from "./company.service.js";

/**
 * =====================================
 * CONTACT ENRICHMENT SERVICE
 * =====================================
 * Orchestrates the signal-to-contact enrichment pipeline:
 * 1. Check if signal already processed
 * 2. Try matching existing contact (name + company)
 * 3. If no match → Call ContactOut API
 * 4. Create/update Contact and Company records
 * 5. Bidirectional linking (Contact ↔ Company ↔ Signal)
 */

// =====================================
// TYPES & INTERFACES
// =====================================

export interface EnrichmentResult {
  success: boolean;
  signalId: string;
  contactId?: string;
  companyId?: string;
  status:
    | "already_processed"
    | "contact_matched"
    | "contact_created"
    | "no_contact_found"
    | "error";
  message: string;
  matchMethod?: string;
  matchConfidence?: string;
  enrichmentSource?: "existing_contact" | "contactout_api" | "none";
  error?: string;
}

export interface BatchEnrichmentResult {
  totalSignals: number;
  successful: number;
  failed: number;
  alreadyProcessed: number;
  contactsCreated: number;
  contactsMatched: number;
  noContactFound: number;
  results: EnrichmentResult[];
}

// =====================================
// HELPER FUNCTIONS
// =====================================

/**
 * Extract company name from signal based on signal type
 */
function extractCompanyNameFromSignal(signal: any): string | undefined {
  // For person-type signals
  if (signal.companyName) {
    return signal.companyName;
  }

  // For company-type signals, use fullName as company name
  if (signal.signalSource === "Company" && signal.fullName) {
    return signal.fullName;
  }

  // Try nested data structures
  if (signal.form4Data?.insiderRole) {
    // Form 4 might have company in relationship data
    return signal.companyName;
  }

  if (signal.maEventData?.parties?.acquirer?.name) {
    return signal.maEventData.parties.acquirer.name;
  }

  if (signal.jobPostingData?.companyDomain) {
    return signal.jobPostingData.companyDomain;
  }

  return undefined;
}

/**
 * Extract person designation/title from signal
 */
function extractDesignationFromSignal(signal: any): string | undefined {
  if (signal.designation) return signal.designation;

  if (signal.form4Data?.insiderRole) return signal.form4Data.insiderRole;

  if (signal.jobPostingData?.jobTitle) return signal.jobPostingData.jobTitle;

  return undefined;
}

/**
 * Map signal filing type to Contact signal type enum
 */
function mapFilingTypeToSignalType(filingType: string): string {
  const mapping: { [key: string]: string } = {
    "form-4": "form_4",
    "form-13d": "13d_13g",
    "form-13da": "13d_13g",
    "form-13g": "13d_13g",
    "form-13ga": "13d_13g",
    "def-14a": "def_14a",
    "10-k": "10k",
    "10-q": "10q",
    "form-8k": "8k",
    "form-8ka": "8k",
    "s-1": "s1_s3",
    "s-3": "s1_s3",
    "form-s3": "s1_s3",
    "form-s3a": "s1_s3",
    "form-d": "form_d",
    "10b5-1": "10b5_1",
    "ma-event": "ma_private",
    "hiring-event": "hiring",
  };

  return mapping[filingType] || filingType;
}

// =====================================
// MAIN ENRICHMENT FUNCTION
// =====================================

/**
 * Enrich a single signal with contact data
 * Implements the full signal-to-contact pipeline
 */
export async function enrichSignalWithContact(signalId: string): Promise<EnrichmentResult> {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    console.log(`\n${"=".repeat(80)}`);
    console.log(`🚀 Starting enrichment for Signal ID: ${signalId}`);
    console.log(`${"=".repeat(80)}\n`);

    // ==========================================
    // STEP 1: Check if signal already processed
    // ==========================================
    const signal = await SignalNew.findById(signalId).session(session);

    if (!signal) {
      await session.abortTransaction();
      return {
        success: false,
        signalId,
        status: "error",
        message: "Signal not found",
        error: "Signal with this ID does not exist",
      };
    }

    // Check if already processed
    if (signal.contactEnrichmentStatus === "completed") {
      console.log(`⚠️  Signal already processed (contactId: ${signal.contactId})`);
      await session.abortTransaction();
      return {
        success: true,
        signalId,
        contactId: signal.contactId?.toString(),
        status: "already_processed",
        message: "Signal was already processed",
      };
    }

    // Check if currently processing
    if (signal.contactEnrichmentStatus === "processing") {
      console.log(`⚠️  Signal is currently being processed`);
      await session.abortTransaction();
      return {
        success: false,
        signalId,
        status: "error",
        message: "Signal is currently being processed",
        error: "Concurrent processing detected",
      };
    }

    // Mark as processing
    await SignalNew.findByIdAndUpdate(
      signalId,
      {
        contactEnrichmentStatus: "processing",
        contactEnrichmentDate: new Date(),
      },
      { session },
    );

    console.log(`📋 Signal details:`);
    console.log(`   Name: ${signal.fullName}`);
    console.log(`   Company: ${extractCompanyNameFromSignal(signal) || "N/A"}`);
    console.log(`   Filing Type: ${signal.filingType}`);
    console.log(`   Signal Source: ${signal.signalSource}`);

    // ==========================================
    // Check if signal is Person type (skip Company for now)
    // ==========================================
    if (signal.signalSource !== "Person") {
      console.log(`⚠️  Skipping: Signal is not Person type (signalSource: ${signal.signalSource})`);
      console.log(
        `   Company-type signals require different enrichment logic (not implemented yet)`,
      );

      await SignalNew.findByIdAndUpdate(
        signalId,
        {
          contactEnrichmentStatus: "pending",
          contactEnrichmentError: "Company-type signals not yet supported",
        },
        { session },
      );

      await session.commitTransaction();

      return {
        success: false,
        signalId,
        status: "error",
        message: "Signal is Company type - enrichment skipped (Person type only)",
        error: "Company-type signals require different enrichment algorithm",
      };
    }

    // ==========================================
    // STEP 2: Try matching existing contact
    // ==========================================
    console.log(`\n🔍 STEP 2: Searching for existing contact...`);

    const companyName = extractCompanyNameFromSignal(signal);
    const matchResult = await findMatchingContact({
      fullName: signal.fullName,
      companyName,
    });

    console.log(`   Match result: ${matchResult.matchMethod}`);
    console.log(`   Confidence: ${matchResult.matchConfidence}`);

    // ==========================================
    // STEP 3: Handle existing contact match
    // ==========================================
    if (matchResult.contact) {
      console.log(`\n✅ STEP 3: Found existing contact (ID: ${matchResult.contact._id})`);

      // Compare company in signal vs contact's companies
      const isSameCompany = await compareContactCompanies(matchResult.contact, companyName);

      console.log(`   Company comparison: ${isSameCompany ? "SAME" : "DIFFERENT"}`);

      if (isSameCompany) {
        // ==========================================
        // CASE 1: Same company → Just attach signal
        // ==========================================
        console.log(`\n📌 CASE 1: Same company - attaching signal to existing contact`);

        const signalType = mapFilingTypeToSignalType(signal.filingType);

        // Add signal to contact's signals array
        await Contact.findByIdAndUpdate(
          matchResult.contact._id,
          {
            $addToSet: {
              signals: {
                signalId: signal._id,
                signalType,
                linkedAt: new Date(),
              },
            },
          },
          { session },
        );

        // Update signal with contact reference
        await SignalNew.findByIdAndUpdate(
          signalId,
          {
            contactId: matchResult.contact._id,
            contactEnrichmentStatus: "completed",
            contactEnrichmentDate: new Date(),
          },
          { session },
        );

        console.log(`✅ Signal attached to existing contact`);

        await session.commitTransaction();

        return {
          success: true,
          signalId,
          contactId: matchResult.contact._id.toString(),
          status: "contact_matched",
          message: "Signal attached to existing contact (same company)",
          matchMethod: matchResult.matchMethod,
          matchConfidence: matchResult.matchConfidence,
          enrichmentSource: "existing_contact",
        };
      } else {
        // ==========================================
        // CASE 2: Different company → Create NEW contact
        // ==========================================
        console.log(`\n🆕 CASE 2: Different company - creating new contact for different role`);

        // This will fall through to ContactOut enrichment below
        // We treat this as "no match" for the purpose of creating a new contact
        console.log(`   Person exists at different company - proceeding with ContactOut`);
      }
    }

    // ==========================================
    // STEP 4: No match (or different company) → Try ContactOut
    // ==========================================
    console.log(`\n🔎 STEP 4: Searching ContactOut API...`);

    const contactOutResult = await contactOutService.searchContact({
      fullName: signal.fullName,
      companyName,
    });

    console.log(`   ContactOut result: ${contactOutResult.found ? "FOUND" : "NOT FOUND"}`);
    console.log(`   Search attempts: ${contactOutResult.searchAttempts.length}`);

    if (!contactOutResult.found) {
      // ==========================================
      // STEP 5: No contact found → Mark as failed
      // ==========================================
      console.log(`\n❌ STEP 5: No contact found - marking signal as failed`);

      await SignalNew.findByIdAndUpdate(
        signalId,
        {
          contactEnrichmentStatus: "failed",
          contactEnrichmentError: "No contact found on ContactOut after all variations",
          contactEnrichmentDate: new Date(),
        },
        { session },
      );

      await session.commitTransaction();

      return {
        success: true, // Not an error - just no contact found
        signalId,
        status: "no_contact_found",
        message: "No contact found on ContactOut - signal marked as failed (no contact created)",
        enrichmentSource: "none",
      };
    }

    // ==========================================
    // STEP 6: Create new Contact from ContactOut data
    // ==========================================
    console.log(`\n🆕 STEP 6: Creating new contact from ContactOut data...`);

    const contactOutPerson = contactOutResult.data!;

    // Extract data from ContactOut
    const emails = contactOutService.extractEmails(contactOutPerson);
    const phones = contactOutService.extractPhoneNumbers(contactOutPerson);
    const linkedinUrl = contactOutService.extractLinkedInUrl(contactOutPerson);
    const location = contactOutService.extractLocation(contactOutPerson);
    const designation = extractDesignationFromSignal(signal);

    const signalType = mapFilingTypeToSignalType(signal.filingType);

    // Create Contact document
    const newContact = await Contact.create(
      [
        {
          fullName: signal.fullName,
          emailAddress: emails,
          phoneNumber: phones,
          linkedinUrl,
          companyName,
          primaryAddress: location,
          occupationTitle: designation || contactOutPerson.title,
          sourceOfInformation: signal.signalType || signal.signalSource,
          signalType: {
            category: signalType,
            source: signal.signalSource || signal.filingType,
          },
          signals: [
            {
              signalId: signal._id,
              signalType,
              linkedAt: new Date(),
            },
          ],
          // Default required fields
          annualEarnedIncome: 0,
          totalNetWorth: 0,
          companies: [], // Will be populated in next step
        },
      ],
      { session },
    );

    console.log(`✅ Created new contact (ID: ${newContact[0]._id})`);
    console.log(`   Emails: ${[...emails.personal, ...emails.business].join(", ") || "None"}`);
    console.log(`   Phones: ${[...phones.personal, ...phones.business].join(", ") || "None"}`);
    console.log(`   LinkedIn: ${linkedinUrl || "None"}`);

    // ==========================================
    // STEP 7: Find or create Company
    // ==========================================
    console.log(`\n🏢 STEP 7: Finding or creating company...`);

    let companyId: string | undefined;

    if (companyName) {
      const companyResult = await findOrCreateCompanyFromSignal({
        ...signal.toObject(),
        companyName,
        _id: signal._id,
      });

      companyId = companyResult.companyId;
      console.log(
        `   ${companyResult.isNew ? "Created new" : "Found existing"} company (ID: ${companyId})`,
      );
    }

    // ==========================================
    // STEP 8: Bidirectional linking
    // ==========================================
    console.log(`\n🔗 STEP 8: Creating bidirectional links...`);

    if (companyId) {
      // Link Contact ↔ Company
      await linkContactsToCompany(companyId, [newContact[0]._id.toString()], designation);

      // Update Contact's companies array with the linked company
      await Contact.findByIdAndUpdate(
        newContact[0]._id,
        {
          $addToSet: {
            companies: {
              companyId: companyId,
              designation: designation,
            },
          },
        },
        { session },
      );

      console.log(`   ✅ Linked Contact ↔ Company`);
    }

    // Link Signal → Contact
    await SignalNew.findByIdAndUpdate(
      signalId,
      {
        contactId: newContact[0]._id,
        contactEnrichmentStatus: "completed",
        contactEnrichmentDate: new Date(),
      },
      { session },
    );

    console.log(`   ✅ Linked Signal → Contact`);

    // ==========================================
    // STEP 9: Success!
    // ==========================================
    await session.commitTransaction();

    console.log(`\n${"=".repeat(80)}`);
    console.log(`✅ Enrichment completed successfully!`);
    console.log(`   Signal ID: ${signalId}`);
    console.log(`   Contact ID: ${newContact[0]._id}`);
    console.log(`   Company ID: ${companyId || "N/A"}`);
    console.log(`${"=".repeat(80)}\n`);

    return {
      success: true,
      signalId,
      contactId: newContact[0]._id.toString(),
      companyId,
      status: "contact_created",
      message: "Contact created successfully from ContactOut data",
      enrichmentSource: "contactout_api",
    };
  } catch (error: any) {
    await session.abortTransaction();
    console.error(`\n❌ Enrichment failed:`, error.message);

    // Mark signal as failed
    try {
      await SignalNew.findByIdAndUpdate(signalId, {
        contactEnrichmentStatus: "failed",
        contactEnrichmentError: error.message,
        contactEnrichmentDate: new Date(),
      });
    } catch (updateError) {
      console.error("Failed to update signal status:", updateError);
    }

    return {
      success: false,
      signalId,
      status: "error",
      message: "Enrichment failed with error",
      error: error.message,
    };
  } finally {
    session.endSession();
  }
}

// =====================================
// BATCH ENRICHMENT FUNCTION
// =====================================

/**
 * Enrich multiple signals in batch
 * Processes signals sequentially to avoid rate limiting issues
 */
export async function enrichSignalsBatch(signalIds: string[]): Promise<BatchEnrichmentResult> {
  console.log(`\n🚀 Starting batch enrichment for ${signalIds.length} signals...`);

  const results: EnrichmentResult[] = [];
  let successful = 0;
  let failed = 0;
  let alreadyProcessed = 0;
  let contactsCreated = 0;
  let contactsMatched = 0;
  let noContactFound = 0;

  for (const signalId of signalIds) {
    try {
      const result = await enrichSignalWithContact(signalId);
      results.push(result);

      if (result.success) {
        successful++;

        switch (result.status) {
          case "already_processed":
            alreadyProcessed++;
            break;
          case "contact_created":
            contactsCreated++;
            break;
          case "contact_matched":
            contactsMatched++;
            break;
          case "no_contact_found":
            noContactFound++;
            break;
        }
      } else {
        failed++;
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error: any) {
      console.error(`Error enriching signal ${signalId}:`, error.message);
      results.push({
        success: false,
        signalId,
        status: "error",
        message: "Unexpected error during enrichment",
        error: error.message,
      });
      failed++;
    }
  }

  console.log(`\n✅ Batch enrichment completed:`);
  console.log(`   Total: ${signalIds.length}`);
  console.log(`   Successful: ${successful}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Already Processed: ${alreadyProcessed}`);
  console.log(`   Contacts Created: ${contactsCreated}`);
  console.log(`   Contacts Matched: ${contactsMatched}`);
  console.log(`   No Contact Found: ${noContactFound}\n`);

  return {
    totalSignals: signalIds.length,
    successful,
    failed,
    alreadyProcessed,
    contactsCreated,
    contactsMatched,
    noContactFound,
    results,
  };
}

// =====================================
// UTILITY FUNCTIONS
// =====================================

/**
 * Get pending signals that need enrichment
 * Only returns Person-type signals (Company signals require different enrichment logic)
 */
export async function getPendingSignals(limit: number = 50): Promise<string[]> {
  const signals = await SignalNew.find({
    contactEnrichmentStatus: "pending",
    signalSource: "Person", // Only Person-type signals for contact enrichment
  })
    .sort({ createdAt: -1 }) // Newest first
    .limit(limit)
    .select("_id");

  console.log(`📊 Found ${signals.length} pending Person-type signals (limit: ${limit})`);

  return signals.map((s) => s._id.toString());
}

/**
 * Get pending signals by filing type
 * Allows filtering by specific signal types (form-4, ma-event, form-13d, etc.)
 * @param filingTypes - Array of filing types to filter by (e.g., ["form-4", "ma-event"])
 * @param limit - Maximum number of signals to return (default: 50)
 */
export async function getPendingSignalsByFilingType(
  filingTypes: string[],
  limit: number = 50,
): Promise<string[]> {
  const signals = await SignalNew.find({
    contactEnrichmentStatus: "pending",
    signalSource: "Person", // Only Person-type signals for contact enrichment
    filingType: { $in: filingTypes }, // Filter by filing type(s)
  })
    .sort({ createdAt: -1 }) // Newest first
    .limit(limit)
    .select("_id");

  console.log(
    `📊 Found ${signals.length} pending signals for filing types [${filingTypes.join(", ")}] (limit: ${limit})`,
  );

  return signals.map((s) => s._id.toString());
}

/**
 * Get failed signals for retry
 */
export async function getFailedSignals(limit: number = 50): Promise<string[]> {
  const signals = await SignalNew.find({
    contactEnrichmentStatus: "failed",
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("_id");

  return signals.map((s) => s._id.toString());
}

/**
 * Get enrichment statistics
 */
export async function getEnrichmentStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}> {
  const [pending, processing, completed, failed, total] = await Promise.all([
    SignalNew.countDocuments({ contactEnrichmentStatus: "pending" }),
    SignalNew.countDocuments({ contactEnrichmentStatus: "processing" }),
    SignalNew.countDocuments({ contactEnrichmentStatus: "completed" }),
    SignalNew.countDocuments({ contactEnrichmentStatus: "failed" }),
    SignalNew.countDocuments({}),
  ]);

  return {
    pending,
    processing,
    completed,
    failed,
    total,
  };
}

/**
 * Retry failed enrichments
 */
export async function retryFailedEnrichments(limit: number = 20): Promise<BatchEnrichmentResult> {
  console.log(`🔄 Retrying failed enrichments (limit: ${limit})...`);

  const failedSignalIds = await getFailedSignals(limit);

  if (failedSignalIds.length === 0) {
    console.log(`ℹ️  No failed signals to retry`);
    return {
      totalSignals: 0,
      successful: 0,
      failed: 0,
      alreadyProcessed: 0,
      contactsCreated: 0,
      contactsMatched: 0,
      noContactFound: 0,
      results: [],
    };
  }

  // Reset status to pending before retrying
  await SignalNew.updateMany(
    { _id: { $in: failedSignalIds } },
    {
      contactEnrichmentStatus: "pending",
      contactEnrichmentError: undefined,
    },
  );

  return enrichSignalsBatch(failedSignalIds);
}
