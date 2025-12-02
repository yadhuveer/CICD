import { Request, Response } from "express";
import {
  saveContactCaches,
  createQuerySearch,
  handlePageDataRetrieval,
} from "../services/coWrapper.services.js";
import { scrapeContactsWrapper } from "../helpers/coWrapper.Helper.js";
import { ContactSearch } from "../models/ContactQuery.model.js";
import { generateSearchQuery } from "../tools/AiAgents/SearchQueryGenerator.agent.js";
import { ContactOutCache } from "../models/LocalContactOutDb.model.js";
import { Contact } from "../models/Contacts.model.js";
import { Company } from "../models/Company.model.js";
import {
  analyzeDocumentForInsights,
  getInsights,
} from "../tools/AiAgents/enritchmentAgent/insightsEnritchment.agent.js";
import mongoose from "mongoose";

// not needed anymore
export const getContactoutData = async (req: Request, res: Response): Promise<void> => {
  try {
    const { jobTitle, fullName, city, state, company, location, pageNo } = req.body;

    console.log(`API Request: contact out coWrapper`);
    console.log(
      `Request params - jobTitle: ${JSON.stringify(jobTitle)}, fullName: ${fullName}, city: ${JSON.stringify(city)}, state: ${JSON.stringify(state)}, company: ${JSON.stringify(company)}, pageNo: ${pageNo}`,
    );

    // Special handling: If fullName and company are provided, search for specific contact
    if (fullName && company) {
      try {
        console.log(
          `🔍 Special lookup: Searching for "${fullName}" at "${Array.isArray(company) ? company[0] : company}"`,
        );

        const companyName = Array.isArray(company) ? company[0] : company;

        // Step 1: Check if contact exists in Contacts DB (without email requirement)
        const existingContact = await Contact.findOne({
          fullName: { $regex: fullName, $options: "i" },
          companyName: { $regex: companyName, $options: "i" },
        })
          .lean()
          .exec();

        // Check if contact has email
        const hasEmail =
          existingContact &&
          ((existingContact.emailAddress?.personal &&
            existingContact.emailAddress.personal.length > 0) ||
            (existingContact.emailAddress?.business &&
              existingContact.emailAddress.business.length > 0));

        if (existingContact && hasEmail) {
          console.log(
            `Found existing contact with email in Contacts DB: ${existingContact.fullName}`,
          );

          // Get the contactCache ID from the contact
          let cacheId = null;
          if (existingContact.contactCache && existingContact.contactCache.length > 0) {
            cacheId = (existingContact.contactCache[0] as any).contactcacheId;
          }

          // If contact has cache, fetch it; otherwise create minimal cache entry
          let contactCache: any;
          if (cacheId) {
            contactCache = await ContactOutCache.findById(cacheId).lean().exec();

            // If cache exists but doesn't have emails, update it with contact's emails
            if (contactCache && (!contactCache.allEmails || contactCache.allEmails.length === 0)) {
              console.log(`Updating existing cache with emails from contact...`);
              const allEmails = [
                ...(existingContact.emailAddress?.personal || []),
                ...(existingContact.emailAddress?.business || []),
              ];
              const primaryEmail =
                existingContact.emailAddress?.business?.[0] ||
                existingContact.emailAddress?.personal?.[0];

              // Update rawResponse.contact_info with emails (needed for frontend to show emails)
              const updatedRawResponse = {
                ...contactCache.rawResponse,
                contact_info: {
                  ...contactCache.rawResponse?.contact_info,
                  emails: allEmails,
                  personal_emails: existingContact.emailAddress?.personal || [],
                  work_emails: existingContact.emailAddress?.business || [],
                },
              };

              await ContactOutCache.findByIdAndUpdate(cacheId, {
                allEmails,
                primaryEmail,
                rawResponse: updatedRawResponse,
              });

              // Re-fetch updated cache
              contactCache = await ContactOutCache.findById(cacheId).lean().exec();
              console.log(
                `✅ Updated cache with ${allEmails.length} emails (including rawResponse)`,
              );
            }
          }

          if (!contactCache) {
            // No cache exists, check if one exists by searchKey to avoid duplicate
            console.log(`Checking for existing ContactOutCache by searchKey...`);
            const searchKey = `${existingContact.fullName.toLowerCase()}@${existingContact.companyName?.toLowerCase() || ""}`;
            contactCache = await ContactOutCache.findOne({ searchKey }).lean().exec();

            if (!contactCache) {
              // Create new cache only if not found by searchKey
              console.log(`Creating new ContactOutCache for existing contact...`);
              const newCache = await ContactOutCache.create({
                searchKey,
                fullName: existingContact.fullName,
                companyName: existingContact.companyName,
                linkedinUrl: existingContact.linkedinUrl,
                rawResponse: {
                  full_name: existingContact.fullName,
                  title: Array.isArray(existingContact.occupationTitle)
                    ? existingContact.occupationTitle[0]
                    : existingContact.occupationTitle,
                  company: { name: existingContact.companyName },
                  location: Array.isArray(existingContact.primaryAddress)
                    ? existingContact.primaryAddress[0]
                    : existingContact.primaryAddress,
                  contact_info: {
                    personal_emails: existingContact.emailAddress?.personal || [],
                    work_emails: existingContact.emailAddress?.business || [],
                    emails: [
                      ...(existingContact.emailAddress?.personal || []),
                      ...(existingContact.emailAddress?.business || []),
                    ],
                    phones: [
                      ...(existingContact.phoneNumber?.personal || []),
                      ...(existingContact.phoneNumber?.business || []),
                    ],
                  },
                },
                allEmails: [
                  ...(existingContact.emailAddress?.personal || []),
                  ...(existingContact.emailAddress?.business || []),
                ],
                contacts: [{ contactId: existingContact._id }],
              });
              contactCache = newCache;
            }

            // Link cache to contact if not already linked
            await Contact.findByIdAndUpdate(existingContact._id, {
              $addToSet: { contactCache: { contactcacheId: contactCache._id } },
            });
          }

          // Return the cache (for insights to work) with emails
          const formattedContact = {
            _id: contactCache._id,
            fullName: contactCache.fullName,
            companyName: contactCache.companyName,
            linkedinUrl: contactCache.linkedinUrl,
            rawResponse: contactCache.rawResponse,
            allEmails: contactCache.allEmails || [],
            primaryEmail: contactCache.primaryEmail,
          };

          res.status(200).json({
            success: true,
            data: [formattedContact],
            source: "contacts_db",
          });
          return;
        }

        // If contact exists but has no email, OR contact doesn't exist, check cache first
        console.log(`Checking if cache exists for this contact...`);
        const searchKey = `${fullName.toLowerCase()}@${companyName.toLowerCase()}`;
        let contactCache: any = await ContactOutCache.findOne({ searchKey }).lean().exec();

        if (contactCache) {
          console.log(`✅ Found existing cache`);

          // Check if linked contact has emails (from previous reveal email action)
          let allEmails: string[] = [];
          let primaryEmail: string | undefined;

          if (contactCache.contacts && contactCache.contacts.length > 0) {
            const contactId = contactCache.contacts[0].contactId;
            const linkedContact = await Contact.findById(contactId).lean().exec();

            if (
              linkedContact &&
              ((linkedContact.emailAddress?.personal &&
                linkedContact.emailAddress.personal.length > 0) ||
                (linkedContact.emailAddress?.business &&
                  linkedContact.emailAddress.business.length > 0))
            ) {
              // Get emails from linked contact
              allEmails = [
                ...(linkedContact.emailAddress?.personal || []),
                ...(linkedContact.emailAddress?.business || []),
              ];
              primaryEmail =
                linkedContact.emailAddress?.business?.[0] ||
                linkedContact.emailAddress?.personal?.[0];
              console.log(`✅ Found emails in linked contact, returning with emails`);
            } else {
              console.log(`✅ No emails found in linked contact`);
            }
          } else {
            console.log(`✅ No linked contact found`);
          }

          // Return cache (with emails if they exist in linked contact)
          const formattedContact = {
            _id: contactCache._id,
            fullName: contactCache.fullName,
            companyName: contactCache.companyName,
            linkedinUrl: contactCache.linkedinUrl,
            rawResponse: contactCache.rawResponse,
            allEmails,
            primaryEmail,
          };

          res.status(200).json({
            success: true,
            data: [formattedContact],
            source: allEmails.length > 0 ? "cache_with_email" : "cache",
          });
          return;
        }

        // Step 2: No cache exists, fetch from ContactOut API WITHOUT email (no email credits used)
        console.log(
          `No cache found, fetching from ContactOut API without email for: ${fullName} @ ${companyName}`,
        );
        const { searchContactOutWithoutEmail } = await import("../helpers/coWrapper.Helper.js");

        const contactOutResult = await searchContactOutWithoutEmail({
          fullName,
          companyName,
        });

        if (!contactOutResult.found) {
          console.log(`❌ No contact found on ContactOut`);
          res.status(200).json({
            success: true,
            data: [],
            message: "No contact found matching the criteria",
          });
          return;
        }

        // Step 3: Process ContactOut data (without email)
        const contactOutPerson = contactOutResult.data!;

        // Extract LinkedIn URL
        let linkedinUrl: string | null = null;
        if (contactOutPerson.li_vanity) {
          linkedinUrl = `https://www.linkedin.com/in/${contactOutPerson.li_vanity}`;
        } else if (contactOutPerson.linkedin_url) {
          linkedinUrl = contactOutPerson.linkedin_url;
        }

        // Step 3a: Generate insights from ContactOut data
        let insightAnalysis: Awaited<ReturnType<typeof analyzeDocumentForInsights>> | null = null;
        try {
          console.log("🔍 Generating insights for contact...");
          insightAnalysis = await analyzeDocumentForInsights(
            JSON.stringify(contactOutPerson, null, 2),
          );
          console.log("✅ Insights generated successfully");
        } catch (error: any) {
          console.error("❌ Error generating insights:", error.message);
          insightAnalysis = null;
        }

        // Step 3b: Create cache ONLY (don't create/update contact yet)
        console.log(`Creating ContactOutCache without email...`);
        const newCache = await ContactOutCache.create({
          searchKey,
          fullName: contactOutPerson.full_name || fullName,
          companyName: companyName,
          linkedinUrl,
          rawResponse: contactOutPerson,
          allEmails: [], // No emails yet
          primaryEmail: undefined,
          // Add insights if generated successfully
          ...(insightAnalysis && {
            insight: {
              informativeInsight: insightAnalysis.informativeInsight,
              actionableInsight: insightAnalysis.actionableInsight,
            },
            signalType: {
              category: insightAnalysis.signalType.category,
              source: insightAnalysis.signalType.source,
            },
            leadScore: insightAnalysis.leadScore,
          }),
        });
        contactCache = newCache.toObject();
        console.log(`✅ Created ContactOutCache (ID: ${contactCache._id}) without email`);

        // If existing contact without email, link cache to it
        if (existingContact && !hasEmail) {
          await Contact.findByIdAndUpdate(existingContact._id, {
            $addToSet: { contactCache: { contactcacheId: contactCache._id } },
          });
          await ContactOutCache.findByIdAndUpdate(contactCache._id, {
            $addToSet: { contacts: { contactId: existingContact._id } },
          });
          console.log(`✅ Linked cache to existing contact (without email)`);
        }

        // Transform to ContactOutCache format for frontend compatibility (return cache, not contact)
        const formattedNewContact = {
          _id: contactCache._id, // Use cache ID for insights endpoint
          fullName: contactCache.fullName,
          companyName: contactCache.companyName,
          linkedinUrl: contactCache.linkedinUrl,
          rawResponse: contactCache.rawResponse,
        };

        // Return the cache (do NOT save to search query DB, do NOT create contact yet)
        res.status(200).json({
          success: true,
          data: [formattedNewContact],
          source: "contactout_api_no_email",
        });
        return;
      } catch (error: any) {
        console.error("Error in fullName+company lookup:", error);
        // Return empty array instead of 500 error
        res.status(200).json({
          success: true,
          data: [],
          message: "No contacts found matching the criteria",
        });
        return;
      }
    }

    // Normalize parameters to arrays for consistent handling
    const normalizedJobTitle = Array.isArray(jobTitle) ? jobTitle : jobTitle ? [jobTitle] : null;
    const normalizedCity = Array.isArray(city) ? city : city ? [city] : null;
    const normalizedState = Array.isArray(state) ? state : state ? [state] : null;
    const normalizedCompany = Array.isArray(company) ? company : company ? [company] : null;
    const normalizedLocation = Array.isArray(location) ? location : location ? [location] : null;

    // Step 1: Build search query with only provided parameters (using arrays)
    const searchQuery: any = {};

    if (normalizedJobTitle) {
      searchQuery["searchParam.jobTitle"] = normalizedJobTitle;
    }
    if (fullName) {
      searchQuery["searchParam.fullName"] = fullName;
    }
    if (normalizedCity) {
      searchQuery["searchParam.location.city"] = normalizedCity;
    }
    if (normalizedState) {
      searchQuery["searchParam.location.state"] = normalizedState;
    }
    if (normalizedCompany) {
      searchQuery["searchParam.Company"] = normalizedCompany;
    }

    // Only proceed with search if at least one parameter is provided
    if (Object.keys(searchQuery).length === 0) {
      console.log("No search parameters provided");
      res.status(400).json({
        success: false,
        error: "At least one search parameter is required",
      });
      return;
    }

    console.log("Checking ContactQuearySearch for exact match...");
    const existingSearch = await ContactSearch.findOne(searchQuery).lean().exec();

    if (existingSearch) {
      console.log("Found matching search query in ContactQuearySearch");

      // Check if the existing search has ONLY the fields we requested (exact match)
      // If DB has any parameter that we didn't provide, it's not an exact match
      const dbJobTitle = Array.isArray(existingSearch.searchParam.jobTitle)
        ? existingSearch.searchParam.jobTitle
        : existingSearch.searchParam.jobTitle
          ? [existingSearch.searchParam.jobTitle]
          : null;
      const dbHasFullName = !!existingSearch.searchParam.fullName;
      const dbLocation = existingSearch.searchParam.location as any;
      const dbCity = Array.isArray(dbLocation?.city)
        ? dbLocation.city
        : dbLocation?.city
          ? [dbLocation.city]
          : null;
      const dbState = Array.isArray(dbLocation?.state)
        ? dbLocation.state
        : dbLocation?.state
          ? [dbLocation.state]
          : null;
      const dbCompany = Array.isArray(existingSearch.searchParam.Company)
        ? existingSearch.searchParam.Company
        : existingSearch.searchParam.Company
          ? [existingSearch.searchParam.Company]
          : null;

      // Check for exact match of arrays
      const arraysMatch = (arr1: string[] | null, arr2: string[] | null): boolean => {
        // Treat null, undefined, and empty arrays as equivalent
        const isEmpty1 = !arr1 || arr1.length === 0;
        const isEmpty2 = !arr2 || arr2.length === 0;

        if (isEmpty1 && isEmpty2) return true;
        if (isEmpty1 || isEmpty2) return false;
        if (arr1!.length !== arr2!.length) return false;
        return (
          arr1!.every((val) => arr2!.includes(val)) && arr2!.every((val) => arr1!.includes(val))
        );
      };

      const hasExtraFields =
        (!normalizedJobTitle && dbJobTitle && dbJobTitle.length > 0) ||
        (!fullName && dbHasFullName) ||
        (!normalizedCity && dbCity && dbCity.length > 0) ||
        (!normalizedState && dbState && dbState.length > 0) ||
        (!normalizedCompany && dbCompany && dbCompany.length > 0) ||
        !arraysMatch(normalizedJobTitle, dbJobTitle) ||
        !arraysMatch(normalizedCity, dbCity) ||
        !arraysMatch(normalizedState, dbState) ||
        !arraysMatch(normalizedCompany, dbCompany);

      if (hasExtraFields) {
        console.log("Search has extra parameters, not an exact match. Will scrape new data.");

        // Step 3: Scrape new data because of parameter mismatch
        console.log("Fetching data from ContactOut API");
        const contactOutResult = await scrapeContactsWrapper(
          1, // pages
          normalizedJobTitle || [],
          normalizedLocation || [],
          normalizedCompany || [],
        );

        // Save fetched profiles to ContactOutCache and get cache IDs
        let cacheIds: string[] = [];
        if (contactOutResult.success && contactOutResult.profiles.length > 0) {
          console.log(`Saving ${contactOutResult.profiles.length} profiles to ContactOutCache`);
          cacheIds = await saveContactCaches(contactOutResult.profiles);
          console.log(`Got ${cacheIds.length} cache IDs`);

          // Step 4: Create new ContactQuearySearch
          await createQuerySearch({
            cacheIds,
            jobTitle: normalizedJobTitle,
            fullName,
            city: normalizedCity,
            state: normalizedState,
            company: normalizedCompany,
            pageNo,
          });
        }

        // Return the profiles as JSON array
        res.status(200).json({
          success: true,
          data: contactOutResult.profiles,
          totalFound: contactOutResult.totalFound,
          source: "contactout_api",
          cacheIds,
        });
      } else {
        // Query matches exactly, handle page data retrieval
        console.log("Coming inside correct");
        const result = await handlePageDataRetrieval({
          jobTitle: normalizedJobTitle,
          fullName,
          city: normalizedCity,
          state: normalizedState,
          company: normalizedCompany,
          location: normalizedLocation,
          pageNo,
        });

        res.status(200).json({
          success: result.success,
          data: result.data,
          message: result.message,
          source: result.source,
        });
        return;
      }
      // Step 2: Check if contactPages has data for the requested pageNo
    } else {
      console.log("No matching search query found in ContactQuearySearch");

      // Step 3: Scrape new data because no matching query found
      console.log("Fetching data from ContactOut API");
      const contactOutResult = await scrapeContactsWrapper(
        1, // pages
        normalizedJobTitle || [],
        normalizedLocation || [],
        normalizedCompany || [],
      );

      // Save fetched profiles to ContactOutCache and get cache IDs
      let cacheIds: string[] = [];
      if (contactOutResult.success && contactOutResult.profiles.length > 0) {
        console.log(`Saving ${contactOutResult.profiles.length} profiles to ContactOutCache`);
        cacheIds = await saveContactCaches(contactOutResult.profiles);
        console.log(`Got ${cacheIds.length} cache IDs`);

        // Step 4: Create new ContactQuearySearch
        await createQuerySearch({
          cacheIds,
          jobTitle: normalizedJobTitle,
          fullName,
          city: normalizedCity,
          state: normalizedState,
          company: normalizedCompany,
          pageNo,
        });
      }

      // Return the profiles as JSON array
      res.status(200).json({
        success: true,
        data: contactOutResult.profiles,
        totalFound: contactOutResult.totalFound,
        source: "contactout_api",
        cacheIds,
      });
    }
  } catch (error: any) {
    console.error("Contact out coWrapper controller error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during contact search",
      message: error.message,
    });
  }
};

export const extractEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const cacheId = req.params.cacheId;

    const contactCache = await ContactOutCache.findById(cacheId);

    if (!contactCache) {
      res.status(404).json({
        success: false,
        error: "Contact cache not found",
      });
      return;
    }

    const fullName = contactCache.fullName;
    const companyName = contactCache.companyName;
    const linkedinUrl = contactCache.linkedinUrl;
    const rawResponse = contactCache.rawResponse as any;
    const primaryAddress = rawResponse?.location || "";
    const occupationTitle = rawResponse?.title || "";

    if (!linkedinUrl) {
      res.status(400).json({
        success: false,
        error: "LinkedIn URL not found in cache",
      });
      return;
    }

    const apiKey = process.env.CONTACTOUT_API_KEY || "";

    if (!apiKey) {
      res.status(500).json({
        success: false,
        error: "CONTACTOUT_API_KEY not configured",
      });
      return;
    }

    const apiUrl = `https://api.contactout.com/v1/people/linkedin?profile=${encodeURIComponent(linkedinUrl)}&include_phone=false`;

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        token: apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      res.status(response.status).json({
        success: false,
        error: "ContactOut API request failed",
        message: await response.text(),
      });
      return;
    }

    const contactOutData = await response.json();

    // Extract emails from ContactOut response
    const allEmails: string[] = [];
    const personalEmails: string[] = [];
    const businessEmails: string[] = [];

    // Extract from profile object
    const profile = contactOutData?.profile;

    if (profile) {
      // Extract work emails
      if (Array.isArray(profile.work_email)) {
        for (const email of profile.work_email) {
          if (email && !allEmails.includes(email)) {
            allEmails.push(email);
            businessEmails.push(email);
          }
        }
      }

      // Extract personal emails
      if (Array.isArray(profile.personal_email)) {
        for (const email of profile.personal_email) {
          if (email && !allEmails.includes(email)) {
            allEmails.push(email);
            personalEmails.push(email);
          }
        }
      }

      // Extract from general email array (if not already added)
      if (Array.isArray(profile.email)) {
        for (const email of profile.email) {
          if (email && !allEmails.includes(email)) {
            allEmails.push(email);
            // If not categorized yet, add to personal by default
            if (!businessEmails.includes(email) && !personalEmails.includes(email)) {
              personalEmails.push(email);
            }
          }
        }
      }
    }

    // Log if no emails found
    if (allEmails.length === 0) {
      console.log("No emails found in ContactOut response");
    }

    // Check if contact exists by linkedinUrl
    let contact = await Contact.findOne({ linkedinUrl });

    if (!contact) {
      // Generate insights from full ContactOut raw response
      let insightAnalysis: Awaited<ReturnType<typeof analyzeDocumentForInsights>> | null = null;
      try {
        console.log("🔍 Generating insights for new contact...");
        insightAnalysis = await analyzeDocumentForInsights(JSON.stringify(rawResponse, null, 2));
        console.log("✅ Insights generated successfully");
      } catch (error: any) {
        console.error("❌ Error generating insights:", error.message);
        // Continue without insights if generation fails
        insightAnalysis = null;
      }

      // Create new contact
      contact = new Contact({
        fullName,
        companyName,
        linkedinUrl,
        primaryAddress,
        occupationTitle,
        emailAddress: {
          personal: personalEmails,
          business: businessEmails,
        },
        contactCache: [{ contactcacheId: new mongoose.Types.ObjectId(cacheId) }],
        annualEarnedIncome: 0,
        totalNetWorth: 0,
        sourceOfInformation: "web_scraping",
        // Add insights if generated successfully
        ...(insightAnalysis && {
          insight: {
            informativeInsight: insightAnalysis.informativeInsight,
            actionableInsight: insightAnalysis.actionableInsight,
          },
          signalType: {
            category: insightAnalysis.signalType.category,
            source: insightAnalysis.signalType.source,
          },
          leadScore: insightAnalysis.leadScore,
        }),
      });

      // Handle company
      if (companyName) {
        let company = await Company.findOne({ companyName });

        if (!company) {
          // Create new company
          company = new Company({
            companyName,
          });
          await company.save();
        }

        // Link company to contact
        if (contact.companies) {
          (contact.companies as any).push({
            companyId: company._id,
            designation: "",
          });
        }

        // Link contact to company
        if (company.contacts && !company.contacts.includes(contact._id)) {
          company.contacts.push(contact._id);
          await company.save();
        }
      }

      await contact.save();

      // Link contact to cache
      if (!contactCache.contacts) {
        (contactCache as any).contacts = [];
      }
      const contactExists = contactCache.contacts?.some(
        (c: any) => c.contactId?.toString() === contact!._id.toString(),
      );
      if (!contactExists) {
        (contactCache.contacts as any).push({ contactId: contact._id });
        await contactCache.save();
      }
    }

    res.status(200).json({
      success: true,
      data: {
        fullName,
        companyName,
        linkedinUrl,
        emails: allEmails,
        contactOutData,
        contactId: contact._id,
      },
    });
  } catch (error: any) {
    console.error("Extract email error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
    });
  }
};

export const naturalLanguageSearch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { searchQuery, pageNo = 1 } = req.body;

    if (!searchQuery || typeof searchQuery !== "string") {
      res.status(400).json({
        success: false,
        error: "searchQuery is required and must be a string",
      });
      return;
    }

    console.log(`Natural Language Search Request: "${searchQuery}"`);

    // Step 1: Generate structured query from natural language using AI agent
    const generatedQuery = await generateSearchQuery(searchQuery);

    console.log("Generated Query:", JSON.stringify(generatedQuery, null, 2));

    // Step 2: Extract parameters from generated query
    const { jobTitle, fullName, city, state, company, location } = generatedQuery;

    // Step 3: Use the existing getContactoutData logic
    const normalizedJobTitle = jobTitle;
    const normalizedCity = city;
    const normalizedState = state;
    const normalizedCompany = company;
    const normalizedLocation = location;

    // Special handling:If fullName and company are provided, search for specific contact
    if (fullName && company) {
      try {
        console.log(
          `Special case lookup (NL Search): Searching for "${fullName}" at "${Array.isArray(company) ? company[0] : company}"`,
        );

        const companyName = Array.isArray(company) ? company[0] : company;

        // Step 1: Check if contact exists in Contacts DB (without email requirement)
        const existingContact = await Contact.findOne({
          fullName: { $regex: fullName, $options: "i" },
          companyName: { $regex: companyName, $options: "i" },
        })
          .lean()
          .exec();

        // Check if contact has email
        const hasEmail =
          existingContact &&
          ((existingContact.emailAddress?.personal &&
            existingContact.emailAddress.personal.length > 0) ||
            (existingContact.emailAddress?.business &&
              existingContact.emailAddress.business.length > 0));

        if (existingContact && hasEmail) {
          console.log(
            ` Found existing contact with email in Contacts DB: ${existingContact.fullName}`,
          );

          // Get the contactCache ID from the contact
          let cacheId = null;
          if (existingContact.contactCache && existingContact.contactCache.length > 0) {
            cacheId = (existingContact.contactCache[0] as any).contactcacheId;
          }

          // If contact has cache, fetch it; otherwise create minimal cache entry
          let contactCache: any;
          if (cacheId) {
            contactCache = await ContactOutCache.findById(cacheId).lean().exec();

            // If cache exists but doesn't have emails, update it with contact's emails
            if (contactCache && (!contactCache.allEmails || contactCache.allEmails.length === 0)) {
              console.log(`Updating existing cache with emails from contact...`);
              const allEmails = [
                ...(existingContact.emailAddress?.personal || []),
                ...(existingContact.emailAddress?.business || []),
              ];
              const primaryEmail =
                existingContact.emailAddress?.business?.[0] ||
                existingContact.emailAddress?.personal?.[0];

              // Update rawResponse.contact_info with emails (needed for frontend to show emails)
              const updatedRawResponse = {
                ...contactCache.rawResponse,
                contact_info: {
                  ...contactCache.rawResponse?.contact_info,
                  emails: allEmails,
                  personal_emails: existingContact.emailAddress?.personal || [],
                  work_emails: existingContact.emailAddress?.business || [],
                },
              };

              await ContactOutCache.findByIdAndUpdate(cacheId, {
                allEmails,
                primaryEmail,
                rawResponse: updatedRawResponse,
              });

              // Re-fetch updated cache
              contactCache = await ContactOutCache.findById(cacheId).lean().exec();
              console.log(
                `✅ Updated cache with ${allEmails.length} emails (including rawResponse)`,
              );
            }
          }

          if (!contactCache) {
            // No cache exists, check if one exists by searchKey to avoid duplicate
            console.log(`Checking for existing ContactOutCache by searchKey...`);
            const searchKey = `${existingContact.fullName.toLowerCase()}@${existingContact.companyName?.toLowerCase() || ""}`;
            contactCache = await ContactOutCache.findOne({ searchKey }).lean().exec();

            if (!contactCache) {
              // Create new cache only if not found by searchKey
              console.log(`Creating new ContactOutCache for existing contact...`);
              const newCache = await ContactOutCache.create({
                searchKey,
                fullName: existingContact.fullName,
                companyName: existingContact.companyName,
                linkedinUrl: existingContact.linkedinUrl,
                rawResponse: {
                  full_name: existingContact.fullName,
                  title: Array.isArray(existingContact.occupationTitle)
                    ? existingContact.occupationTitle[0]
                    : existingContact.occupationTitle,
                  company: { name: existingContact.companyName },
                  location: Array.isArray(existingContact.primaryAddress)
                    ? existingContact.primaryAddress[0]
                    : existingContact.primaryAddress,
                  contact_info: {
                    personal_emails: existingContact.emailAddress?.personal || [],
                    work_emails: existingContact.emailAddress?.business || [],
                    emails: [
                      ...(existingContact.emailAddress?.personal || []),
                      ...(existingContact.emailAddress?.business || []),
                    ],
                    phones: [
                      ...(existingContact.phoneNumber?.personal || []),
                      ...(existingContact.phoneNumber?.business || []),
                    ],
                  },
                },
                allEmails: [
                  ...(existingContact.emailAddress?.personal || []),
                  ...(existingContact.emailAddress?.business || []),
                ],
                contacts: [{ contactId: existingContact._id }],
              });
              contactCache = newCache;
            }

            // Link cache to contact if not already linked
            await Contact.findByIdAndUpdate(existingContact._id, {
              $addToSet: { contactCache: { contactcacheId: contactCache._id } },
            });
          }

          // Return the cache (for insights to work) with emails
          const formattedContact = {
            _id: contactCache._id,
            fullName: contactCache.fullName,
            companyName: contactCache.companyName,
            linkedinUrl: contactCache.linkedinUrl,
            rawResponse: contactCache.rawResponse,
            allEmails: contactCache.allEmails || [],
            primaryEmail: contactCache.primaryEmail,
          };

          res.status(200).json({
            success: true,
            data: [formattedContact],
            source: "contacts_db",
            generatedQuery,
          });
          return;
        }

        // If contact exists but has no email, OR contact doesn't exist, check cache first
        console.log(`Checking if cache exists for this contact...`);
        const searchKey = `${fullName.toLowerCase()}@${companyName.toLowerCase()}`;
        let contactCache: any = await ContactOutCache.findOne({ searchKey }).lean().exec();

        if (contactCache) {
          console.log(`✅ Found existing cache`);

          // Check if linked contact has emails (from previous reveal email action)
          let allEmails: string[] = [];
          let primaryEmail: string | undefined;

          if (contactCache.contacts && contactCache.contacts.length > 0) {
            const contactId = contactCache.contacts[0].contactId;
            const linkedContact = await Contact.findById(contactId).lean().exec();

            if (
              linkedContact &&
              ((linkedContact.emailAddress?.personal &&
                linkedContact.emailAddress.personal.length > 0) ||
                (linkedContact.emailAddress?.business &&
                  linkedContact.emailAddress.business.length > 0))
            ) {
              // Get emails from linked contact
              allEmails = [
                ...(linkedContact.emailAddress?.personal || []),
                ...(linkedContact.emailAddress?.business || []),
              ];
              primaryEmail =
                linkedContact.emailAddress?.business?.[0] ||
                linkedContact.emailAddress?.personal?.[0];
              console.log(`✅ Found emails in linked contact, returning with emails`);
            } else {
              console.log(`✅ No emails found in linked contact`);
            }
          } else {
            console.log(`✅ No linked contact found`);
          }

          // Return cache (with emails if they exist in linked contact)
          const formattedContact = {
            _id: contactCache._id,
            fullName: contactCache.fullName,
            companyName: contactCache.companyName,
            linkedinUrl: contactCache.linkedinUrl,
            rawResponse: contactCache.rawResponse,
            allEmails,
            primaryEmail,
          };

          res.status(200).json({
            success: true,
            data: [formattedContact],
            source: allEmails.length > 0 ? "cache_with_email" : "cache",
            generatedQuery,
          });
          return;
        }

        // Step 2: No cache exists, fetch from ContactOut API WITHOUT email (no email credits used)
        console.log(
          `No cache found, fetching from ContactOut API without email for: ${fullName} @ ${companyName}`,
        );
        const { searchContactOutWithoutEmail } = await import("../helpers/coWrapper.Helper.js");

        const contactOutResult = await searchContactOutWithoutEmail({
          fullName,
          companyName,
        });

        if (!contactOutResult.found) {
          console.log(`❌ No contact found on ContactOut`);
          res.status(200).json({
            success: true,
            data: [],
            message: "No contact found matching the criteria",
            generatedQuery,
          });
          return;
        }

        // Step 3: Process ContactOut data (without email)
        const contactOutPerson = contactOutResult.data!;

        // Extract LinkedIn URL
        let linkedinUrl: string | null = null;
        if (contactOutPerson.li_vanity) {
          linkedinUrl = `https://www.linkedin.com/in/${contactOutPerson.li_vanity}`;
        } else if (contactOutPerson.linkedin_url) {
          linkedinUrl = contactOutPerson.linkedin_url;
        }

        // Step 3a: Generate insights from ContactOut data
        let insightAnalysis: Awaited<ReturnType<typeof analyzeDocumentForInsights>> | null = null;
        try {
          console.log("🔍 Generating insights for contact...");
          insightAnalysis = await analyzeDocumentForInsights(
            JSON.stringify(contactOutPerson, null, 2),
          );
          console.log("✅ Insights generated successfully");
        } catch (error: any) {
          console.error("❌ Error generating insights:", error.message);
          insightAnalysis = null;
        }

        // Step 3b: Create cache ONLY (don't create/update contact yet)
        console.log(`Creating ContactOutCache without email...`);
        const newCache = await ContactOutCache.create({
          searchKey,
          fullName: contactOutPerson.full_name || fullName,
          companyName: companyName,
          linkedinUrl,
          rawResponse: contactOutPerson,
          allEmails: [], // No emails yet
          primaryEmail: undefined,
          // Add insights if generated successfully
          ...(insightAnalysis && {
            insight: {
              informativeInsight: insightAnalysis.informativeInsight,
              actionableInsight: insightAnalysis.actionableInsight,
            },
            signalType: {
              category: insightAnalysis.signalType.category,
              source: insightAnalysis.signalType.source,
            },
            leadScore: insightAnalysis.leadScore,
          }),
        });
        contactCache = newCache.toObject();
        console.log(`✅ Created ContactOutCache (ID: ${contactCache._id}) without email`);

        // If existing contact without email, link cache to it
        if (existingContact && !hasEmail) {
          await Contact.findByIdAndUpdate(existingContact._id, {
            $addToSet: { contactCache: { contactcacheId: contactCache._id } },
          });
          await ContactOutCache.findByIdAndUpdate(contactCache._id, {
            $addToSet: { contacts: { contactId: existingContact._id } },
          });
          console.log(`✅ Linked cache to existing contact (without email)`);
        }

        // Transform to ContactOutCache format for frontend compatibility (return cache, not contact)
        const formattedNewContact = {
          _id: contactCache._id, // Use cache ID for insights endpoint
          fullName: contactCache.fullName,
          companyName: contactCache.companyName,
          linkedinUrl: contactCache.linkedinUrl,
          rawResponse: contactCache.rawResponse,
        };

        // Return the cache (do NOT save to search query DB, do NOT create contact yet)
        res.status(200).json({
          success: true,
          data: [formattedNewContact],
          source: "contactout_api_no_email",
          generatedQuery,
        });
        return;
      } catch (error: any) {
        console.error("Error in fullName+company lookup (NL Search):", error);
        // Return empty array instead of 500 error
        res.status(200).json({
          success: true,
          data: [],
          message: "No contacts found matching the criteria",
          generatedQuery,
        });
        return;
      }
    }

    // Build search query with only provided parameters (using arrays)
    const searchQueryDb: any = {};

    if (normalizedJobTitle && normalizedJobTitle.length > 0) {
      searchQueryDb["searchParam.jobTitle"] = normalizedJobTitle;
    }
    if (fullName) {
      searchQueryDb["searchParam.fullName"] = fullName;
    }
    if (normalizedCity && normalizedCity.length > 0) {
      searchQueryDb["searchParam.location.city"] = normalizedCity;
    }
    if (normalizedState && normalizedState.length > 0) {
      searchQueryDb["searchParam.location.state"] = normalizedState;
    }
    if (normalizedCompany && normalizedCompany.length > 0) {
      searchQueryDb["searchParam.Company"] = normalizedCompany;
    }

    // Only proceed with search if at least one parameter is provided
    if (Object.keys(searchQueryDb).length === 0) {
      console.log("No search parameters generated from natural language query");
      res.status(400).json({
        success: false,
        error: "Could not extract valid search parameters from your query",
        generatedQuery,
      });
      return;
    }

    console.log("Checking ContactQuearySearch for exact match...");
    const existingSearch = await ContactSearch.findOne(searchQueryDb).lean().exec();

    if (existingSearch) {
      console.log("Found matching search query in ContactQuearySearch");

      // Check if the existing search has ONLY the fields we requested (exact match)
      const dbJobTitle = Array.isArray(existingSearch.searchParam.jobTitle)
        ? existingSearch.searchParam.jobTitle
        : existingSearch.searchParam.jobTitle
          ? [existingSearch.searchParam.jobTitle]
          : null;
      const dbHasFullName = !!existingSearch.searchParam.fullName;
      const dbLocation = existingSearch.searchParam.location as any;
      const dbCity = Array.isArray(dbLocation?.city)
        ? dbLocation.city
        : dbLocation?.city
          ? [dbLocation.city]
          : null;
      const dbState = Array.isArray(dbLocation?.state)
        ? dbLocation.state
        : dbLocation?.state
          ? [dbLocation.state]
          : null;
      const dbCompany = Array.isArray(existingSearch.searchParam.Company)
        ? existingSearch.searchParam.Company
        : existingSearch.searchParam.Company
          ? [existingSearch.searchParam.Company]
          : null;

      // Check for exact match of arrays.
      const arraysMatch = (arr1: string[] | null, arr2: string[] | null): boolean => {
        // Treat null, undefined, and empty arrays as equivalent
        const isEmpty1 = !arr1 || arr1.length === 0;
        const isEmpty2 = !arr2 || arr2.length === 0;

        if (isEmpty1 && isEmpty2) return true;
        if (isEmpty1 || isEmpty2) return false;
        if (arr1!.length !== arr2!.length) return false;
        return (
          arr1!.every((val) => arr2!.includes(val)) && arr2!.every((val) => arr1!.includes(val))
        );
      };

      const hasExtraFields =
        (!normalizedJobTitle && dbJobTitle && dbJobTitle.length > 0) ||
        (!fullName && dbHasFullName) ||
        (!normalizedCity && dbCity && dbCity.length > 0) ||
        (!normalizedState && dbState && dbState.length > 0) ||
        (!normalizedCompany && dbCompany && dbCompany.length > 0) ||
        !arraysMatch(normalizedJobTitle, dbJobTitle) ||
        !arraysMatch(normalizedCity, dbCity) ||
        !arraysMatch(normalizedState, dbState) ||
        !arraysMatch(normalizedCompany, dbCompany);

      if (hasExtraFields) {
        console.log("Search has extra parameters, not an exact match. Will scrape new data.");

        // Scrape new data because of parameter mismatch
        console.log("Fetching data from ContactOut API");
        const contactOutResult = await scrapeContactsWrapper(
          1,
          normalizedJobTitle || [],
          normalizedLocation || [],
          normalizedCompany || [],
        );

        // Save fetched profiles to ContactOutCache and get cache IDs
        let cacheIds: string[] = [];
        let contactData: any[] = [];

        if (contactOutResult.success && contactOutResult.profiles.length > 0) {
          console.log(`Saving ${contactOutResult.profiles.length} profiles to ContactOutCache`);
          cacheIds = await saveContactCaches(contactOutResult.profiles);
          console.log(`Got ${cacheIds.length} cache IDs`);

          // Create new ContactQuearySearch
          await createQuerySearch({
            cacheIds,
            jobTitle: normalizedJobTitle,
            fullName,
            city: normalizedCity,
            state: normalizedState,
            company: normalizedCompany,
            pageNo: 1, // Always start with page 1 for new queries
          });

          // Get only the IDs for the requested page (10 items per page)
          const startIndex = (pageNo - 1) * 10;
          const endIndex = startIndex + 10;
          const pageIds = cacheIds.slice(startIndex, endIndex);

          // Fetch the saved data from ContactOutCache to ensure consistent format
          if (pageIds.length > 0) {
            contactData = await ContactOutCache.find({
              _id: { $in: pageIds },
            })
              .lean()
              .exec();
            console.log(`Retrieved ${contactData.length} contacts from cache for page ${pageNo}`);
          }
        }

        // Return the profiles from DB in consistent format (matching handlePageDataRetrieval)
        res.status(200).json({
          success: true,
          data: contactData,
          message: `Data retrieved from ContactOut API for page ${pageNo}`,
          source: "contactout_api",
          generatedQuery,
        });
      } else {
        // Query matches exactly, handle page data retrieval
        console.log("Exact match found, retrieving from cache");
        const result = await handlePageDataRetrieval({
          jobTitle: normalizedJobTitle,
          fullName,
          city: normalizedCity,
          state: normalizedState,
          company: normalizedCompany,
          location: normalizedLocation,
          pageNo,
        });

        res.status(200).json({
          success: result.success,
          data: result.data,
          message: result.message,
          source: result.source,
          generatedQuery,
        });
        return;
      }
    } else {
      console.log("No matching search query found in ContactQuearySearch");

      // Scrape new data because no matching query found
      console.log("Fetching data from ContactOut API");
      const contactOutResult = await scrapeContactsWrapper(
        1,
        normalizedJobTitle || [],
        normalizedLocation || [],
        normalizedCompany || [],
      );

      // Save fetched profiles to ContactOutCache and get cache IDs
      let cacheIds: string[] = [];
      let contactData: any[] = [];

      if (contactOutResult.success && contactOutResult.profiles.length > 0) {
        console.log(`Saving ${contactOutResult.profiles.length} profiles to ContactOutCache`);
        cacheIds = await saveContactCaches(contactOutResult.profiles);
        console.log(`Got ${cacheIds.length} cache IDs`);

        // Create new ContactQuearySearch
        await createQuerySearch({
          cacheIds,
          jobTitle: normalizedJobTitle,
          fullName,
          city: normalizedCity,
          state: normalizedState,
          company: normalizedCompany,
          pageNo: 1, // Always start with page 1 for new queries
        });

        // Get only the IDs for the requested page (10 items per page)
        const startIndex = (pageNo - 1) * 10;
        const endIndex = startIndex + 10;
        const pageIds = cacheIds.slice(startIndex, endIndex);

        // Fetch the saved data from ContactOutCache to ensure consistent format
        if (pageIds.length > 0) {
          contactData = await ContactOutCache.find({
            _id: { $in: pageIds },
          })
            .lean()
            .exec();
          console.log(`Retrieved ${contactData.length} contacts from cache for page ${pageNo}`);
        }
      }

      // Return the profiles from DB in consistent format (matching handlePageDataRetrieval)
      res.status(200).json({
        success: true,
        data: contactData,
        message: `Data retrieved from ContactOut API for page ${pageNo}`,
        source: "contactout_api",
        generatedQuery,
      });
    }
  } catch (error: any) {
    console.error("Natural language search error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during natural language search",
      message: error.message,
    });
  }
};

export const generateInsights = async (req: Request, res: Response): Promise<void> => {
  try {
    // get the id from query params
    const contactId = req.params.contactId as string;

    if (!contactId) {
      res.status(400).json({
        success: false,
        error: "contactId query parameter is required",
      });
      return;
    }

    console.log(`🔍 Generating insights for contact: ${contactId}`);

    // Find the contact by ID
    // const contact = await Contact.findById(contactId).lean().exec();

    // if (!contact) {
    //   res.status(404).json({
    //     success: false,
    //     error: "Contact not found",
    //   });
    //   return;
    // }

    // Get the first contactCache ID from the contact
    // if (!contact.contactCache || contact.contactCache.length === 0) {
    //   res.status(404).json({
    //     success: false,
    //     error: "No contact cache found for this contact",
    //   });
    //   return;
    // }

    // const cacheId = contact.contactCache[0].contactcacheId;

    // Find the cache to get the rawResponse
    const contactCache = await ContactOutCache.findById(contactId).lean().exec();

    if (!contactCache) {
      res.status(404).json({
        success: false,
        error: "Contact cache not found",
      });
      return;
    }

    const rawResponse = contactCache.rawResponse;

    if (!rawResponse) {
      res.status(404).json({
        success: false,
        error: "No raw response data found in cache",
      });
      return;
    }

    console.log(`📄 Found raw response data, generating insights...`);

    // Generate insights from the raw response
    const insights = await getInsights(JSON.stringify(rawResponse, null, 2));

    console.log(`✅ Insights generated successfully`);

    // Return the insights directly without saving to database
    res.status(200).json({
      success: true,
      data: {
        contactId: rawResponse._id,
        fullName: rawResponse.full_name,
        insights: {
          informativeInsight: insights.informative,
          actionableInsight: insights.actionable,
          // shouldReachOut: insights.shouldReachOut,
          // reachOutReason: insights.reachOutReason,
          // cashInHandLikelihood: insights.cashInHandLikelihood,
          // needsLongwallServices: insights.needsLongwallServices,
          // needsReason: insights.needsReason,
          // leadScore: insights.leadScore,
          // signalType: insights.signalType,
        },
      },
    });
  } catch (error: any) {
    console.error("Generate insights error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error during insights generation",
      message: error.message,
    });
  }
};
