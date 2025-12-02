import { SignalNew } from "../models/newSignal.model.js";
import { Contact } from "../models/Contacts.model.js";
import { enrichSignalWithContact } from "../services/contactEnrichment.service.js";

/**
 * Test contact enrichment for an existing Signal
 * @param signalId - MongoDB ObjectId of the Signal
 */
export async function testContactEnrichment(signalId: string) {
  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🧪 Testing Contact Enrichment for Signal: ${signalId}`);
    console.log(`${"=".repeat(60)}\n`);

    // Check if signal exists
    const signal = await SignalNew.findById(signalId).lean();
    if (!signal) {
      console.error(`❌ Signal not found: ${signalId}`);
      return null;
    }

    console.log(`✅ Signal Found:`);
    console.log(`   Source: ${signal.signalSource}`);
    console.log(`   Name: ${signal.fullName || "N/A"}`);
    console.log(`   Company: ${signal.companyName}`);
    console.log(
      `   Current Enrichment Status: ${signal.contactEnrichmentStatus || "Not enriched"}`,
    );

    // Run enrichment
    const enrichmentResult = await enrichSignalWithContact(signalId);

    if (!enrichmentResult.success || !enrichmentResult.contactId) {
      console.log(`\n⚠️ No contact created during enrichment`);
      console.log(`   Status: ${enrichmentResult.status}`);
      console.log(`   Message: ${enrichmentResult.message}`);
      return null;
    }

    console.log(`\n✅ Enrichment Completed: ${enrichmentResult.status}`);

    // Display contact
    const contact = await Contact.findById(enrichmentResult.contactId).lean();
    if (contact) {
      console.log(`\n   📇 Contact:`);
      console.log(`      ID: ${contact._id}`);
      console.log(`      Name: ${contact.fullName}`);
      console.log(`      Title: ${contact.occupationTitle || "N/A"}`);
      console.log(`      Company: ${contact.companyName || "N/A"}`);
      console.log(
        `      Email: ${contact.emailAddress?.business?.[0] || contact.emailAddress?.personal?.[0] || "N/A"}`,
      );
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`✅ Contact Enrichment Test Completed`);
    console.log(`${"=".repeat(60)}\n`);

    return enrichmentResult;
  } catch (error: any) {
    console.error(`❌ Contact enrichment test failed:`, error.message);
    return null;
  }
}
