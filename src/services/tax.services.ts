import { Contact } from "../models/Contacts.model.js";
import { ContactOutCache } from "../models/LocalContactOutDb.model.js";
import { TaxProfessionalProfile } from "../helpers/scrapeTaxEtorny.js";

/**
 * Process a single tax professional profile
 * - Store in ContactOutCache (rawResponse = entire profile object)
 * - Store in Contact
 * - Link them together
 */
export async function processSingleTaxProfile(profile: TaxProfessionalProfile) {
  try {
    console.log(`Processing: ${profile.name}`);

    const searchKey = `${profile.name.toLowerCase()}|${(profile.company || "unknown").toLowerCase()}`;

    let existingCache = await ContactOutCache.findOne({ searchKey });
    if (!existingCache && profile.linkedinUrl) {
      existingCache = await ContactOutCache.findOne({ linkedinUrl: profile.linkedinUrl });
    }

    // Check if contact already exists (by linkedinUrl or fullName + companyName)
    let existingContact = profile.linkedinUrl
      ? await Contact.findOne({ linkedinUrl: profile.linkedinUrl })
      : null;
    if (!existingContact) {
      existingContact = await Contact.findOne({
        fullName: profile.name,
        companyName: profile.company,
      });
    }

    // CASE 1: Both exist - skip
    if (existingCache && existingContact) {
      console.log(`Both cache and contact already exist for: ${profile.name}`);
      return {
        success: true,
        contactId: existingContact._id,
        cacheId: existingCache._id,
        name: profile.name,
        status: "skipped-already-exists",
      };
    }

    // CASE 2: Only cache exists - create contact and link
    if (existingCache && !existingContact) {
      console.log(`Cache exists, creating contact for: ${profile.name}`);

      const contact = new Contact({
        fullName: profile.name,
        emailAddress: {
          personal: profile.emails.personal,
          business: profile.emails.business,
        },
        phoneNumber: {
          personal: profile.phoneNumbers,
          business: [],
        },
        linkedinUrl: profile.linkedinUrl || undefined,
        companyName: profile.company || undefined,
        occupationTitle: profile.role || undefined,
        primaryAddress: profile.location || undefined,
        sourceOfInformation: "tax-professional-scrape",
        annualEarnedIncome: 0,
        totalNetWorth: 0,
        contactCache: [{ contactcacheId: existingCache._id }],
      });
      await contact.save();
      console.log(`Created contact: ${contact._id}`);

      // Link contact to existing cache
      await ContactOutCache.updateOne(
        { _id: existingCache._id },
        { $push: { contacts: { contactId: contact._id } } },
      );
      console.log(`Linked contact to existing cache`);

      return {
        success: true,
        contactId: contact._id,
        cacheId: existingCache._id,
        name: profile.name,
        status: "created-contact-linked-to-existing-cache",
      };
    }

    // CASE 3: Only contact exists - create cache and link
    if (!existingCache && existingContact) {
      console.log(`Contact exists, creating cache for: ${profile.name}`);

      const cacheEntry = new ContactOutCache({
        searchKey,
        fullName: profile.name,
        primaryEmail: profile.emails.business[0] || profile.emails.personal[0] || null,
        allEmails: [...profile.emails.personal, ...profile.emails.business],
        linkedinUrl: profile.linkedinUrl || undefined,
        companyName: profile.company || undefined,
        rawResponse: profile.rawResponse,
        statusCode: 200,
        totalResults: 1,
        contacts: [{ contactId: existingContact._id }],
      });
      await cacheEntry.save();
      console.log(`Created cache: ${cacheEntry._id}`);

      // Link cache to existing contact
      await Contact.updateOne(
        { _id: existingContact._id },
        { $push: { contactCache: { contactcacheId: cacheEntry._id } } },
      );
      console.log(`Linked cache to existing contact`);

      return {
        success: true,
        contactId: existingContact._id,
        cacheId: cacheEntry._id,
        name: profile.name,
        status: "created-cache-linked-to-existing-contact",
      };
    }

    // CASE 4: Neither exists - create both and link
    console.log(`Creating both cache and contact for: ${profile.name}`);

    const cacheEntry = new ContactOutCache({
      searchKey,
      fullName: profile.name,
      primaryEmail: profile.emails.business[0] || profile.emails.personal[0] || null,
      allEmails: [...profile.emails.personal, ...profile.emails.business],
      linkedinUrl: profile.linkedinUrl || undefined,
      companyName: profile.company || undefined,
      rawResponse: profile.rawResponse,
      statusCode: 200,
      totalResults: 1,
    });
    await cacheEntry.save();
    console.log(`Created cache: ${cacheEntry._id}`);

    const contact = new Contact({
      fullName: profile.name,
      emailAddress: {
        personal: profile.emails.personal,
        business: profile.emails.business,
      },
      phoneNumber: {
        personal: profile.phoneNumbers,
        business: [],
      },
      linkedinUrl: profile.linkedinUrl || undefined,
      companyName: profile.company || undefined,
      occupationTitle: profile.role || undefined,
      primaryAddress: profile.location || undefined,
      sourceOfInformation: "tax-professional-scrape",
      annualEarnedIncome: 0,
      totalNetWorth: 0,
      contactCache: [{ contactcacheId: cacheEntry._id }],
    });
    await contact.save();
    console.log(`Created contact: ${contact._id}`);

    // Link contact to cache
    await ContactOutCache.updateOne(
      { _id: cacheEntry._id },
      { $set: { contacts: [{ contactId: contact._id }] } },
    );
    console.log(`Linked contact to cache`);

    return {
      success: true,
      contactId: contact._id,
      cacheId: cacheEntry._id,
      name: profile.name,
      status: "created-both",
    };
  } catch (error: any) {
    console.error(`Error processing ${profile.name}:`, error.message);
    return {
      success: false,
      error: error.message,
      name: profile.name,
    };
  }
}

/**
 * Process all tax professional profiles in batch
 */
export async function processAllTaxProfiles(profiles: TaxProfessionalProfile[]) {
  const results: Array<{
    success: boolean;
    contactId?: any;
    cacheId?: any;
    name: string;
    error?: string;
    status?: string;
  }> = [];
  let successful = 0;
  let failed = 0;

  for (const profile of profiles) {
    const result = await processSingleTaxProfile(profile);
    results.push(result);
    if (result.success) {
      successful++;
    } else {
      failed++;
    }
  }

  return {
    totalProfiles: profiles.length,
    successful,
    failed,
    results,
  };
}
