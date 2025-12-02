import { Company } from "../models/Company.model.js";
import { Signal } from "../models/Signals.model.js";
import { Contact } from "../models/Contacts.model.js";

/**
 * Maps Signal signalType to standardized signal type enum
 */
/*const mapSignalTypeToEnum = (signalType: string): string => {
  const mapping: { [key: string]: string } = {
    Form4: "form_4",
    Schedule13D: "13d_13g",
    Schedule13G: "13d_13g",
    Schedule13DA: "13d_13g",
    Schedule13GA: "13d_13g",
  };
  return mapping[signalType] || "13d_13g"; // Default to 13d_13g if unknown
};*/

/**
 * Find or create a Company record from Signal data
 * Uses deduplication strategy: ticker (primary) or CIK (secondary)
 * Appends signalTypes when company already exists
 * @param signalData - Signal object containing company information
 * @returns Object with companyId and isNew flag
 */
export const findOrCreateCompanyFromSignal = async (
  signalData: any,
): Promise<{ companyId: string; isNew: boolean }> => {
  try {
    const {
      fullName, // Company name (for Company-type signals)
      companyName, // Company name (for Person-type signals)
      companyTicker,
      companyCik,
      companyCusip,
      location,
      percentOfClass,
      aggregateSharesOwned,
      votingPower,
      citizenshipOrOrganization,
      signalType,
      _id: signalId,
    } = signalData;

    // Use companyName if available (Person signals), otherwise use fullName (Company signals)
    const actualCompanyName = companyName || fullName;

    console.log(`🔍 Finding or creating Company: ${actualCompanyName}`);
    console.log(`   Ticker: ${companyTicker || "N/A"}, CIK: ${companyCik || "N/A"}`);

    // Use signal's signalType directly if available, otherwise map from old format
    const mappedSignalType = signalType || null; // Use signalType from signal directly

    // STEP 1: Try to find existing company
    let company: any = null;

    // Primary deduplication: by ticker (most reliable)
    if (companyTicker) {
      company = await Company.findOne({ stockSymbol: companyTicker });
      if (company) {
        console.log(`✅ Found existing company by ticker: ${companyTicker}`);
      }
    }

    // Secondary deduplication: by CIK if ticker didn't match
    if (!company && companyCik) {
      company = await Company.findOne({ cik: companyCik });
      if (company) {
        console.log(`✅ Found existing company by CIK: ${companyCik}`);
      }
    }

    // STEP 2: If company exists, update it
    if (company) {
      // Check if signal already exists in array
      const companySignals = company.signals || [];
      const signalExists = companySignals.some((sig: any) => sig.signalId?.toString() === signalId);

      if (!signalExists) {
        // Add new signal with type to company's signals array
        await Company.findByIdAndUpdate(
          company._id,
          {
            $addToSet: {
              signals: {
                signalId: signalId,
                signalType: mappedSignalType,
                linkedAt: new Date(),
              },
            },
            lastUpdated: new Date(),
          },
          { new: true },
        );
        console.log(
          `🔗 Added signal ${signalId} (type: ${mappedSignalType}) to company ${company.name}`,
        );
      } else {
        console.log(`ℹ️  Signal already linked to company`);
      }

      return { companyId: company._id.toString(), isNew: false };
    }

    // STEP 3: Create new company
    console.log(`🆕 Creating new company: ${actualCompanyName}`);

    const companyData: any = {
      companyName: actualCompanyName,
      stockSymbol: companyTicker || undefined,
      ticker: companyTicker || undefined,
      cik: companyCik || undefined,
      cusip: companyCusip || undefined,
      headquarters: location
        ? {
            address: location,
          }
        : undefined,
      signals: [
        {
          signalId: signalId,
          signalType: mappedSignalType,
          linkedAt: new Date(),
        },
      ],
      /*sourceOfInformation: `SEC ${signalData.signalType || "Filing"}`,*/
      lastUpdated: new Date(),
      // Add Schedule 13D/G specific data as description
      /*description:
        percentOfClass || aggregateSharesOwned
          ? `Ownership: ${percentOfClass || "N/A"}, Shares: ${aggregateSharesOwned || "N/A"}, Voting: ${votingPower || "N/A"}`
          : undefined,
      citizenshipOrOrganization: citizenshipOrOrganization || undefined,*/
    };

    const newCompany = await Company.create(companyData);
    console.log(`✅ Created new company: ${newCompany.companyName} (ID: ${newCompany._id})`);

    return { companyId: newCompany._id.toString(), isNew: true };
  } catch (error: any) {
    console.error(`❌ Failed to find or create company:`, error.message);
    throw error;
  }
};

/**
 * Link contacts to a company (bidirectional many-to-many)
 * Updates both Company.contacts and Contact.companies arrays
 * @param companyId - MongoDB ObjectId of the Company
 * @param companyId - MongoDB ObjectId of the Company
 * @param contactIds - Array of Contact ObjectIds
 */
export const linkContactsToCompany = async (
  companyId: string,
  contactIds: string[],
  designation?: string,
): Promise<void> => {
  try {
    if (contactIds.length === 0) {
      console.log(`ℹ️  No contacts to link to company ${companyId}`);
      return;
    }

    console.log(`🔗 Linking ${contactIds.length} contact(s) to company ${companyId}`);

    // Update Company: add contacts to company.contacts array
    await Company.findByIdAndUpdate(
      companyId,
      {
        $addToSet: {
          contacts: { $each: contactIds },
          keyPeople: { $each: contactIds }, // Also add to keyPeople for backward compatibility
        },
        lastUpdated: new Date(),
      },
      { new: true },
    );

    console.log(`✅ Added contacts to Company.contacts array`);

    // Update Contacts: add companyId to each contact.companies array
    // We need to update each contact individually to handle the designation field
    for (const contactId of contactIds) {
      await Contact.findByIdAndUpdate(
        contactId,
        {
          $addToSet: {
            companies: {
              companyId: companyId,
              designation: designation,
            },
          },
        },
        { new: true },
      );
    }

    console.log(`✅ Added company reference to ${contactIds.length} Contact(s)`);
  } catch (error: any) {
    console.error(`❌ Failed to link contacts to company:`, error.message);
    throw error;
  }
};

/**
 * Update Signal with Company reference
 * @param signalId - MongoDB ObjectId of the Signal
 * @param signalId - MongoDB ObjectId of the Signal
 * @param signalId - MongoDB ObjectId of the Signal
 * @param signalId - MongoDB ObjectId of the Signal
 * @param companyId - MongoDB ObjectId of the Company
 */
export const linkSignalToCompany = async (signalId: string, companyId: string): Promise<void> => {
  try {
    await Signal.findByIdAndUpdate(
      signalId,
      {
        companyId: companyId,
      },
      { new: true },
    );

    console.log(`✅ Linked Signal ${signalId} to Company ${companyId}`);
  } catch (error: any) {
    console.error(`❌ Failed to link signal to company:`, error.message);
    throw error;
  }
};
