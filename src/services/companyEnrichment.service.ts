import mongoose from "mongoose";
import { SignalNew } from "../models/newSignal.model.js";
import { Contact } from "../models/Contacts.model.js";
import { findMatchingContact, MatchConfidence } from "../utils/contactMatching.util.js";
import { contactOutService } from "./contactout.service.js";
import { findOrCreateCompanyFromSignal, linkContactsToCompany } from "./company.service.js";

/**
 * =====================================
 * COMPANY ENRICHMENT SERVICE
 * =====================================
 * Orchestrates the company signal enrichment pipeline:
 * 1. Check if signal already processed
 * 2. Filter Company-type signals (skip Person)
 * 3. Find or create Company record
 * 4. Process keyPeople array from signal
 * 5. Enrich each keyPerson via ContactOut
 * 6. Create Contact records and link to Company
 * 7. Bidirectional linking (Contact ↔ Company ↔ Signal)
 */

// =====================================
// TYPES & INTERFACES
// =====================================

export interface CompanyEnrichmentResult {
  success: boolean;
  signalId: string;
  companyId?: string;
  contactsCreated: number;
  contactsMatched: number;
  contactIds: string[];
  status:
    | "already_processed"
    | "company_created"
    | "company_matched"
    | "no_key_people"
    | "error"
    | "existing_company";
  message: string;
  keyPeopleProcessed: number;
  keyPeopleTotal: number;
  enrichmentDetails?: KeyPersonEnrichmentDetail[];
  error?: string;
}

export interface KeyPersonEnrichmentDetail {
  fullName: string;
  designation?: string;
  contactId?: string;
  status: "created" | "matched" | "not_found" | "error";
  message: string;
}

export interface BatchCompanyEnrichmentResult {
  totalSignals: number;
  successful: number;
  failed: number;
  alreadyProcessed: number;
  companiesCreated: number;
  companiesMatched: number;
  totalContactsCreated: number;
  totalContactsMatched: number;
  noKeyPeople: number;
  results: CompanyEnrichmentResult[];
}

// =====================================
// HELPER FUNCTIONS
// =====================================

/**
 * Extract company name from Company-type signal
 */
function extractCompanyNameFromSignal(signal: any): string | undefined {
  // For Company-type signals, fullName is the company name

  // Fallback to companyName field
  if (signal.companyName) {
    return signal.companyName;
  }

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
 * Enrich a single Company-type signal
 * Implements the company signal enrichment pipeline
 */
export async function enrichCompanySignal(signalId: string): Promise<CompanyEnrichmentResult> {
  try {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Starting COMPANY enrichment for Signal ID: ${signalId}`);
    console.log(`${"=".repeat(80)}\n`);

    // ==========================================
    // STEP 1: Check if signal already processed
    // ==========================================
    const signal = await SignalNew.findById(signalId);

    if (!signal) {
      return {
        success: false,
        signalId,
        contactsCreated: 0,
        contactsMatched: 0,
        contactIds: [],
        status: "error",
        message: "Signal not found",
        keyPeopleProcessed: 0,
        keyPeopleTotal: 0,
        error: "Signal with this ID does not exist",
      };
    }

    // Check if already processed
    if (signal.contactEnrichmentStatus === "completed") {
      console.log(`Signal already processed`);
      return {
        success: true,
        signalId,
        contactsCreated: 0,
        contactsMatched: 0,
        contactIds: [],
        status: "already_processed",
        message: "Signal was already processed",
        keyPeopleProcessed: 0,
        keyPeopleTotal: 0,
      };
    }

    // Check if currently processing
    if (signal.contactEnrichmentStatus === "processing") {
      console.log(`Signal is currently being processed`);
      return {
        success: false,
        signalId,
        contactsCreated: 0,
        contactsMatched: 0,
        contactIds: [],
        status: "error",
        message: "Signal is currently being processed",
        keyPeopleProcessed: 0,
        keyPeopleTotal: 0,
        error: "Concurrent processing detected",
      };
    }

    // ==========================================
    // STEP 2: Validate signal is Company type
    // ==========================================
    if (signal.signalSource !== "Company") {
      console.log(
        `⚠️  Skipping: Signal is not Company type (signalSource: ${signal.signalSource})`,
      );
      console.log(`   This pipeline only handles Company-type signals`);

      return {
        success: false,
        signalId,
        contactsCreated: 0,
        contactsMatched: 0,
        contactIds: [],
        status: "error",
        message: "Signal is Person type - use contact enrichment pipeline instead",
        keyPeopleProcessed: 0,
        keyPeopleTotal: 0,
        error: "Person-type signals require contactEnrichment.service.ts",
      };
    }

    // Mark as processing
    await SignalNew.findByIdAndUpdate(signalId, {
      contactEnrichmentStatus: "processing",
      contactEnrichmentDate: new Date(),
    });

    const companyName = extractCompanyNameFromSignal(signal);

    console.log(` Signal details:`);
    console.log(`   Company: ${companyName || "N/A"}`);
    console.log(`   Filing Type: ${signal.filingType}`);
    console.log(`   Signal Source: ${signal.signalSource}`);
    console.log(`   Key People Count: ${signal.keyPeople?.length || 0}`);

    // ==========================================
    // STEP 3: Find or create Company
    // ==========================================
    console.log(`STEP 3: Finding or creating company...`);

    if (!companyName) {
      return {
        success: false,
        signalId,
        contactsCreated: 0,
        contactsMatched: 0,
        contactIds: [],
        status: "error",
        message: "Cannot extract company name from signal",
        keyPeopleProcessed: 0,
        keyPeopleTotal: 0,
        error: "Missing company name",
      };
    }

    const companyResult = await findOrCreateCompanyFromSignal({
      ...signal.toObject(),
      companyName,
      _id: signal._id,
    });

    const companyId = companyResult.companyId;
    console.log(
      `   ${companyResult.isNew ? "✅ Created new" : "✅ Found existing"} company (ID: ${companyId})`,
    );

    // ==========================================
    // EARLY EXIT: If company already exists, just attach signal and skip enrichment
    // ==========================================
    if (!companyResult.isNew) {
      console.log(`Company already exists - skipping keyPeople processing`);
      console.log(`Signal attached to existing company`);

      await SignalNew.findByIdAndUpdate(signalId, {
        contactEnrichmentStatus: "completed",
        contactEnrichmentDate: new Date(),
      });

      console.log(`\n${"=".repeat(80)}`);
      console.log(`✅ Company enrichment completed (existing company - no enrichment needed)`);
      console.log(`   Signal ID: ${signalId}`);
      console.log(`   Company ID: ${companyId}`);
      console.log(`${"=".repeat(80)}\n`);

      return {
        success: true,
        signalId,
        companyId,
        contactsCreated: 0,
        contactsMatched: 0,
        contactIds: [],
        status: "existing_company",
        message: "Signal attached to existing company - no enrichment performed",
        keyPeopleProcessed: 0,
        keyPeopleTotal: 0,
      };
    }

    // ==========================================
    // STEP 4: Check if signal has keyPeople
    // ==========================================
    console.log(`STEP 4: Processing key people...`);

    // Create in-memory cache to store ContactOut data (avoids schema changes)
    const contactOutDataCache = new Map<string, any>();

    if (!signal.keyPeople || signal.keyPeople.length === 0) {
      console.log(`    No key people found in signal`);
      console.log(`   Attempting auto-discovery via ContactOut API...`);

      // STEP 4a: Search ContactOut for executives by company + seniority
      const executiveSearchResult =
        await contactOutService.searchExecutivesByCompanyAndSeniority(companyName);

      if (!executiveSearchResult.found || executiveSearchResult.executives.length === 0) {
        console.log(`No executives found - completing without contacts`);

        await SignalNew.findByIdAndUpdate(signalId, {
          contactEnrichmentStatus: "completed",
          contactEnrichmentDate: new Date(),
          contactEnrichmentError: `No key people in signal. ContactOut search attempted: ${executiveSearchResult.companyVariations.length} company variants, 0 results found.`,
        });

        console.log(`\n${"=".repeat(80)}`);
        console.log(`Company enrichment completed (no key people found)`);
        console.log(`   Signal ID: ${signalId}`);
        console.log(`   Company ID: ${companyId}`);
        console.log(
          `   ContactOut Search: ${executiveSearchResult.companyVariations.length} variants tried`,
        );
        console.log(`${"=".repeat(80)}\n`);

        return {
          success: true,
          signalId,
          companyId,
          contactsCreated: 0,
          contactsMatched: 0,
          contactIds: [],
          status: "no_key_people",
          message: `Company ${companyResult.isNew ? "created" : "matched"} - no key people found via ContactOut`,
          keyPeopleProcessed: 0,
          keyPeopleTotal: 0,
        };
      }

      // STEP 4b: Found executives - convert to keyPeople format and process
      console.log(`Found ${executiveSearchResult.totalFound} executives`);
      console.log(
        `      C-Suite: ${executiveSearchResult.cSuiteCount}, Vice Presidents: ${executiveSearchResult.vpCount}`,
      );

      // Convert executives to keyPeople array format
      signal.keyPeople = executiveSearchResult.executives.map((exec) => {
        const location = contactOutService.extractLocation(exec);

        // Store full ContactOut data in cache (keyed by fullName)
        if (exec.full_name) {
          contactOutDataCache.set(exec.full_name, exec);
          console.log(`   💾 Cached ContactOut data for: ${exec.full_name}`);
        }

        return {
          fullName: exec.full_name,
          designation: exec.title || "",
          location: location,
          relationship: "Auto-discovered Executive",
          phoneNumber: exec.contact_info?.phones?.[0],
          email: exec.contact_info?.emails?.[0] || exec.contact_info?.work_emails?.[0],
          address: location,
          sourceOfInformation: "ContactOut API - Company + Seniority Search",
          dateAdded: new Date(),
          lastUpdated: new Date(),
        };
      });

      console.log(`   Processing ${signal.keyPeople.length} auto-discovered key people...`);
    }

    // ==========================================
    // STEP 5: Process each keyPerson
    // ==========================================
    console.log(`   Found ${signal.keyPeople.length} key people to process`);

    const enrichmentDetails: KeyPersonEnrichmentDetail[] = [];
    const contactIds: string[] = [];
    let contactsCreated = 0;
    let contactsMatched = 0;

    for (let i = 0; i < signal.keyPeople.length; i++) {
      const keyPerson = signal.keyPeople[i];

      // Skip if fullName is missing (required for contact matching/creation)
      if (!keyPerson.fullName) {
        console.log(`\n   --- Skipping keyPerson ${i + 1}/${signal.keyPeople.length} ---`);
        console.log(`   ⚠️  Missing fullName - cannot process`);

        enrichmentDetails.push({
          fullName: "Unknown",
          designation: keyPerson.designation,
          status: "error",
          message: "Missing required field: fullName",
        });

        continue;
      }

      console.log(`\n   --- Processing keyPerson ${i + 1}/${signal.keyPeople.length} ---`);
      console.log(`   Name: ${keyPerson.fullName}`);
      console.log(`   Designation: ${keyPerson.designation || "N/A"}`);

      // Start a new transaction for this contact
      const contactSession = await mongoose.startSession();

      try {
        contactSession.startTransaction();
        // ==========================================
        // STEP 5a: Check if contact already exist
        // ==========================================
        console.log(`Checking for existing contact...`);

        const matchResult = await findMatchingContact({
          fullName: keyPerson.fullName,
          companyName,
        });

        console.log(`      Match method: ${matchResult.matchMethod}`);
        console.log(`      Confidence: ${matchResult.matchConfidence}`);

        if (matchResult.contact && matchResult.matchConfidence !== MatchConfidence.NONE) {
          // ==========================================
          // CASE 1: Contact already exists - Link it
          // ==========================================
          console.log(`Found existing contact (ID: ${matchResult.contact._id})`);

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
            { session: contactSession },
          );

          // Commit this contact's transaction
          await contactSession.commitTransaction();

          // Link contact to company if not already linked
          await linkContactsToCompany(
            companyId,
            [matchResult.contact._id.toString()],
            keyPerson.designation,
          );

          contactIds.push(matchResult.contact._id.toString());
          contactsMatched++;

          enrichmentDetails.push({
            fullName: keyPerson.fullName,
            designation: keyPerson.designation,
            contactId: matchResult.contact._id.toString(),
            status: "matched",
            message: `Matched existing contact (${matchResult.matchMethod})`,
          });

          console.log(`   ✅ Linked existing contact to company and signal`);
          continue;
        }

        // ==========================================
        // STEP 5b: Try ContactOut enrichment
        // ==========================================
        let contactOutResult;

        // Check if contact data was cached from auto-discovery
        const cachedContactOutData = contactOutDataCache.get(keyPerson.fullName);

        if (cachedContactOutData) {
          console.log(`   ✅ Reusing ContactOut data from auto-discovery (API call saved)`);

          // Use cached data instead of making another API call
          contactOutResult = {
            found: true,
            data: cachedContactOutData,
            source: "cache" as const,
            searchAttempts: ["reused-from-auto-discovery-cache"],
          };

          console.log(`      ContactOut result: FOUND (from cache)`);
        } else {
          // No cached data - make API call as normal
          console.log(`   🔎 Searching ContactOut API...`);

          contactOutResult = await contactOutService.searchContact({
            fullName: keyPerson.fullName,
            companyName,
          });

          console.log(`      ContactOut result: ${contactOutResult.found ? "FOUND" : "NOT FOUND"}`);

          if (!contactOutResult.found) {
            console.log(`   ⚠️  Contact not found on ContactOut - skipping`);

            enrichmentDetails.push({
              fullName: keyPerson.fullName,
              designation: keyPerson.designation,
              status: "not_found",
              message: "Not found on ContactOut",
            });

            continue;
          }
        }

        // ==========================================
        // STEP 5c: Create new Contact from ContactOut
        // ==========================================
        console.log(`   🆕 Creating new contact from ContactOut data...`);

        const contactOutPerson = contactOutResult.data!;

        // Extract data from ContactOut
        const emails = contactOutService.extractEmails(contactOutPerson);
        const phones = contactOutService.extractPhoneNumbers(contactOutPerson);
        const linkedinUrl = contactOutService.extractLinkedInUrl(contactOutPerson);
        const location = contactOutService.extractLocation(contactOutPerson);

        const signalType = mapFilingTypeToSignalType(signal.filingType);

        // Create Contact document
        let newContact;
        let isDuplicate = false;

        try {
          newContact = await Contact.create(
            [
              {
                fullName: keyPerson.fullName,
                emailAddress: emails,
                phoneNumber: phones,
                linkedinUrl,
                companyName,
                primaryAddress: location || keyPerson.address,
                occupationTitle: keyPerson.designation || contactOutPerson.title,
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
                companies: [
                  {
                    companyId: companyId,
                    designation: keyPerson.designation,
                  },
                ],
              },
            ],
            { session: contactSession },
          );

          console.log(`   ✅ Created new contact (ID: ${newContact[0]._id})`);
        } catch (createError: any) {
          // Handle duplicate LinkedIn URL (E11000 error)
          if (createError.code === 11000) {
            console.log(`   ⚠️  Contact with this LinkedIn URL already exists`);
            console.log(`   🔍 Finding existing contact...`);

            // Try finding by LinkedIn URL first
            let existingContact = linkedinUrl
              ? await Contact.findOne({ linkedinUrl }).session(contactSession)
              : null;

            // Fallback: Search by name + company
            if (!existingContact) {
              const fallbackMatch = await findMatchingContact({
                fullName: keyPerson.fullName,
                companyName,
              });
              existingContact = fallbackMatch.contact;
            }

            if (existingContact) {
              newContact = [existingContact];
              isDuplicate = true;
              contactsMatched++;
              console.log(`   ✅ Found existing contact (ID: ${existingContact._id})`);
            } else {
              throw new Error(
                `Duplicate contact error but cannot find existing contact: ${createError.message}`,
              );
            }
          } else {
            // Re-throw other errors
            throw createError;
          }
        }

        if (!isDuplicate) {
          contactsCreated++;
        }

        console.log(
          `      Emails: ${[...emails.personal, ...emails.business].join(", ") || "None"}`,
        );
        console.log(
          `      Phones: ${[...phones.personal, ...phones.business].join(", ") || "None"}`,
        );
        console.log(`      LinkedIn: ${linkedinUrl || "None"}`);

        // Commit this contact's transaction
        await contactSession.commitTransaction();

        // Link Contact ↔ Company (outside transaction)
        await linkContactsToCompany(
          companyId,
          [newContact[0]._id.toString()],
          keyPerson.designation,
        );

        contactIds.push(newContact[0]._id.toString());

        enrichmentDetails.push({
          fullName: keyPerson.fullName,
          designation: keyPerson.designation,
          contactId: newContact[0]._id.toString(),
          status: isDuplicate ? "matched" : "created",
          message: isDuplicate
            ? "Matched existing contact (duplicate LinkedIn URL)"
            : "Created from ContactOut data",
        });

        console.log(`   ✅ Linked new contact to company`);

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error: any) {
        // Rollback this contact's transaction
        await contactSession.abortTransaction();

        console.error(`   ❌ Error processing keyPerson: ${error.message}`);

        enrichmentDetails.push({
          fullName: keyPerson.fullName,
          designation: keyPerson.designation,
          status: "error",
          message: error.message,
        });

        // Continue processing other key people
      } finally {
        // Always end the session
        contactSession.endSession();
      }
    }

    // ==========================================
    // STEP 6: Update signal status
    // ==========================================
    console.log(`\n📝 STEP 6: Updating signal status...`);

    // Check if at least one contact was successfully linked
    if (contactIds.length === 0) {
      // NO contacts succeeded - mark as failed
      await SignalNew.findByIdAndUpdate(signalId, {
        contactEnrichmentStatus: "failed",
        contactEnrichmentError: "No contacts could be created or matched",
        contactEnrichmentDate: new Date(),
      });

      console.log(`\n${"=".repeat(80)}`);
      console.log(`❌ Company enrichment completed with no contacts`);
      console.log(`   Signal ID: ${signalId}`);
      console.log(`   Company ID: ${companyId}`);
      console.log(`   Key People Attempted: ${signal.keyPeople.length}`);
      console.log(`   Contacts Created: 0`);
      console.log(`   Contacts Matched: 0`);
      console.log(`${"=".repeat(80)}\n`);

      return {
        success: false,
        signalId,
        companyId,
        contactsCreated: 0,
        contactsMatched: 0,
        contactIds: [],
        status: "error",
        message: "No contacts could be created or matched",
        keyPeopleProcessed: signal.keyPeople.length,
        keyPeopleTotal: signal.keyPeople.length,
        enrichmentDetails,
        error: "All contact enrichments failed",
      };
    }

    // At least one contact succeeded - mark as completed
    await SignalNew.findByIdAndUpdate(signalId, {
      contactEnrichmentStatus: "completed",
      contactEnrichmentDate: new Date(),
    });

    // ==========================================
    // STEP 7: Success!
    // ==========================================

    console.log(`\n${"=".repeat(80)}`);
    console.log(`✅ Company enrichment completed successfully!`);
    console.log(`   Signal ID: ${signalId}`);
    console.log(`   Company ID: ${companyId}`);
    console.log(`   Key People Processed: ${signal.keyPeople.length}`);
    console.log(`   Contacts Created: ${contactsCreated}`);
    console.log(`   Contacts Matched: ${contactsMatched}`);
    console.log(`   Total Contacts: ${contactIds.length}`);
    console.log(`${"=".repeat(80)}\n`);

    return {
      success: true,
      signalId,
      companyId,
      contactsCreated,
      contactsMatched,
      contactIds,
      status: companyResult.isNew ? "company_created" : "company_matched",
      message: `Company ${companyResult.isNew ? "created" : "matched"} with ${contactIds.length} contacts processed`,
      keyPeopleProcessed: signal.keyPeople.length,
      keyPeopleTotal: signal.keyPeople.length,
      enrichmentDetails,
    };
  } catch (error: any) {
    console.error(`\n❌ Company enrichment failed:`, error.message);

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
      contactsCreated: 0,
      contactsMatched: 0,
      contactIds: [],
      status: "error",
      message: "Company enrichment failed with error",
      keyPeopleProcessed: 0,
      keyPeopleTotal: 0,
      error: error.message,
    };
  }
}

// =====================================
// BATCH ENRICHMENT FUNCTION
// =====================================

/**
 * Enrich multiple Company signals in batch
 * Processes signals sequentially to avoid rate limiting
 */
export async function enrichCompanySignalsBatch(
  signalIds: string[],
): Promise<BatchCompanyEnrichmentResult> {
  console.log(`\n🚀 Starting batch COMPANY enrichment for ${signalIds.length} signals...`);

  const results: CompanyEnrichmentResult[] = [];
  let successful = 0;
  let failed = 0;
  let alreadyProcessed = 0;
  let companiesCreated = 0;
  let companiesMatched = 0;
  let totalContactsCreated = 0;
  let totalContactsMatched = 0;
  let noKeyPeople = 0;
  let _companyExsistAlready = 0;

  for (const signalId of signalIds) {
    try {
      const result = await enrichCompanySignal(signalId);
      results.push(result);

      if (result.success) {
        successful++;

        switch (result.status) {
          case "already_processed":
            alreadyProcessed++;
            break;
          case "company_created":
            companiesCreated++;
            totalContactsCreated += result.contactsCreated;
            totalContactsMatched += result.contactsMatched;
            break;
          case "company_matched":
            companiesMatched++;
            totalContactsCreated += result.contactsCreated;
            totalContactsMatched += result.contactsMatched;
            break;
          case "no_key_people":
            noKeyPeople++;
            break;
          case "existing_company":
            _companyExsistAlready++;
            break;
        }
      } else {
        failed++;
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error: any) {
      console.error(`Error enriching company signal ${signalId}:`, error.message);
      results.push({
        success: false,
        signalId,
        contactsCreated: 0,
        contactsMatched: 0,
        contactIds: [],
        status: "error",
        message: "Unexpected error during enrichment",
        keyPeopleProcessed: 0,
        keyPeopleTotal: 0,
        error: error.message,
      });
      failed++;
    }
  }

  console.log(`\n✅ Batch company enrichment completed:`);
  console.log(`   Total Signals: ${signalIds.length}`);
  console.log(`   Successful: ${successful}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Already Processed: ${alreadyProcessed}`);
  console.log(`   Companies Created: ${companiesCreated}`);
  console.log(`   Companies Matched: ${companiesMatched}`);
  console.log(`   No Key People: ${noKeyPeople}`);
  console.log(`   Total Contacts Created: ${totalContactsCreated}`);
  console.log(`   Total Contacts Matched: ${totalContactsMatched}\n`);

  return {
    totalSignals: signalIds.length,
    successful,
    failed,
    alreadyProcessed,
    companiesCreated,
    companiesMatched,
    totalContactsCreated,
    totalContactsMatched,
    noKeyPeople,
    results,
  };
}

// =====================================
// UTILITY FUNCTIONS
// =====================================

/**
 * Get pending Company signals that need enrichment
 */
export async function getPendingCompanySignals(limit: number = 50): Promise<string[]> {
  const signals = await SignalNew.find({
    contactEnrichmentStatus: "pending",
    signalSource: "Company", // Only Company-type signals
  })
    .sort({ createdAt: -1 }) // Newest first
    .limit(limit)
    .select("_id");

  console.log(`📊 Found ${signals.length} pending Company-type signals (limit: ${limit})`);

  return signals.map((s) => s._id.toString());
}

/**
 * Get pending Company signals by filing type
 */
export async function getPendingCompanySignalsByFilingType(
  filingTypes: string[],
  limit: number = 50,
): Promise<string[]> {
  const signals = await SignalNew.find({
    contactEnrichmentStatus: "pending",
    signalSource: "Company",
    filingType: { $in: filingTypes },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("_id");

  console.log(
    `📊 Found ${signals.length} pending Company signals for filing types [${filingTypes.join(", ")}] (limit: ${limit})`,
  );

  return signals.map((s) => s._id.toString());
}

/**
 * Get Company enrichment statistics
 */
export async function getCompanyEnrichmentStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
  withKeyPeople: number;
  withoutKeyPeople: number;
}> {
  const [pending, processing, completed, failed, total, withKeyPeople, withoutKeyPeople] =
    await Promise.all([
      SignalNew.countDocuments({
        contactEnrichmentStatus: "pending",
        signalSource: "Company",
      }),
      SignalNew.countDocuments({
        contactEnrichmentStatus: "processing",
        signalSource: "Company",
      }),
      SignalNew.countDocuments({
        contactEnrichmentStatus: "completed",
        signalSource: "Company",
      }),
      SignalNew.countDocuments({
        contactEnrichmentStatus: "failed",
        signalSource: "Company",
      }),
      SignalNew.countDocuments({ signalSource: "Company" }),
      SignalNew.countDocuments({
        signalSource: "Company",
        keyPeople: { $exists: true, $ne: [] },
      }),
      SignalNew.countDocuments({
        signalSource: "Company",
        $or: [{ keyPeople: { $exists: false } }, { keyPeople: [] }],
      }),
    ]);

  return {
    pending,
    processing,
    completed,
    failed,
    total,
    withKeyPeople,
    withoutKeyPeople,
  };
}

/**
 * Retry failed Company enrichments
 */
export async function retryFailedCompanyEnrichments(
  limit: number = 20,
): Promise<BatchCompanyEnrichmentResult> {
  console.log(`🔄 Retrying failed Company enrichments (limit: ${limit})...`);

  const failedSignals = await SignalNew.find({
    contactEnrichmentStatus: "failed",
    signalSource: "Company",
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("_id");

  const failedSignalIds = failedSignals.map((s) => s._id.toString());

  if (failedSignalIds.length === 0) {
    console.log(`ℹ️  No failed Company signals to retry`);
    return {
      totalSignals: 0,
      successful: 0,
      failed: 0,
      alreadyProcessed: 0,
      companiesCreated: 0,
      companiesMatched: 0,
      totalContactsCreated: 0,
      totalContactsMatched: 0,
      noKeyPeople: 0,
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

  return enrichCompanySignalsBatch(failedSignalIds);
}
