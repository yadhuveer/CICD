import { Contact } from "../models/Contacts.model.js";
import { ContactOutCache } from "../models/LocalContactOutDb.model.js";
import { ContactSearch } from "../models/ContactQuery.model.js";
import { scrapeContactsWrapper } from "../helpers/coWrapper.Helper.js";
import axios, { AxiosError } from "axios";

interface ContactFilters {
  jobTitle?: string;
  fullName?: string;
  location?: string;
  company?: string;
  limit?: number;
}

interface ContactProfile {
  name: string;
  location: string | null;
  role: string | null;
  company: string | null;
  linkedinUrl: string | null;
  emails?: {
    personal: string[];
    business: string[];
  };
  phoneNumbers?: string[];
  keyInsights: string | null;
  rawResponse: any;
}

export const getRequiredContacts = async (filters: ContactFilters): Promise<any[]> => {
  const { jobTitle, fullName, location, company, limit } = filters;

  // Build query object dynamically based on provided filters
  const query: any = {
    $and: [
      // Email filter: at least one personal OR one business email must exist
      {
        $or: [
          { "emailAddress.personal.0": { $exists: true } },
          { "emailAddress.business.0": { $exists: true } },
        ],
      },
    ],
  };

  // Add optional filters if provided
  if (jobTitle) {
    query.$and.push({ occupationTitle: { $regex: jobTitle, $options: "i" } });
  }

  if (fullName) {
    query.$and.push({ fullName: { $regex: fullName, $options: "i" } });
  }

  if (location) {
    query.$and.push({ primaryAddress: { $regex: location, $options: "i" } });
  }

  if (company) {
    query.$and.push({ companyName: { $regex: company, $options: "i" } });
  }

  // Fetch contacts sorted by latest created first
  const contacts = await Contact.find(query).sort({ createdAt: -1 }).lean().exec();

  // Return contacts only if count is greater than limit, otherwise return empty array
  if (limit && contacts.length >= limit) {
    return contacts.slice(0, limit);
  } else if (limit && contacts.length < limit) {
    return [];
  }

  return contacts;
};

export const getRequiredContactCaches = async (filters: ContactFilters): Promise<any[]> => {
  const { jobTitle, fullName, location, company, limit } = filters;

  const query: any = {
    $and: [
      // Email filter: at least one personal email OR email must exist
      {
        $or: [
          { "rawResponse.contact_info.personal_emails.0": { $exists: true } },
          { "rawResponse.contact_info.emails.0": { $exists: true } },
        ],
      },
    ],
  };

  // Add optional filters if provided
  if (jobTitle) {
    query.$and.push({ "rawResponse.title": { $regex: jobTitle, $options: "i" } });
  }

  if (fullName) {
    query.$and.push({ fullName: { $regex: fullName, $options: "i" } });
  }

  if (location) {
    query.$and.push({ "rawResponse.location": { $regex: location, $options: "i" } });
  }

  if (company) {
    query.$and.push({ companyName: { $regex: company, $options: "i" } });
  }

  const contactCaches = await ContactOutCache.find(query).sort({ createdAt: -1 }).lean().exec();

  // Return contact caches only if count is greater than limit, otherwise return empty array
  if (limit && contactCaches.length >= limit) {
    return contactCaches.slice(0, limit);
  } else if (limit && contactCaches.length <= limit) {
    return [];
  }

  return contactCaches;
};

export const saveContactCaches = async (profiles: ContactProfile[]): Promise<string[]> => {
  let savedCount = 0; // Counter to restrict saving only one contact for testing
  const cacheIds: string[] = []; // Array to store all cache IDs (new and existing)

  for (const profile of profiles) {
    // Stop after saving one contact
    /*if (savedCount >= 1) {
      console.log(`Reached test limit of 1 contact. Stopping.`);
      break;
    }*/

    try {
      // Extract data from profile
      const fullName = profile.name || profile.rawResponse?.full_name || "Unknown";
      const companyName = profile.company || profile.rawResponse?.company?.name || "";

      // Create searchKey
      const searchKey = `${fullName.toLowerCase()}@${companyName.toLowerCase()}`;

      // Extract LinkedIn URL
      let linkedinUrl = profile.linkedinUrl;
      if (!linkedinUrl && profile.rawResponse?.li_vanity) {
        linkedinUrl = `https://www.linkedin.com/in/${profile.rawResponse.li_vanity}`;
      }

      // Check if contact already exists in cache using multiple criteria
      const existenceQuery: any = {
        $or: [],
      };

      // Check by searchKey if available
      if (searchKey) {
        existenceQuery.$or.push({ searchKey });
      }

      // Check by linkedinUrl if available
      if (linkedinUrl) {
        existenceQuery.$or.push({ linkedinUrl });
      }

      // Check by fullName AND companyName combination
      if (fullName && companyName) {
        existenceQuery.$or.push({
          $and: [
            { fullName: { $regex: `^${fullName}$`, $options: "i" } },
            { companyName: { $regex: `^${companyName}$`, $options: "i" } },
          ],
        });
      }

      // Only check if we have at least one criterion
      if (existenceQuery.$or.length > 0) {
        const existingContact = await ContactOutCache.findOne(existenceQuery).lean().exec();

        if (existingContact) {
          console.log(`Contact already exists in cache: ${fullName} - Using existing ID`);
          cacheIds.push(existingContact._id.toString()); // Add existing cache ID
          continue; // Skip this contact and move to next
        }
      }

      // Prepare contact cache document
      const contactCacheData = {
        searchKey,
        fullName,
        nameVariations: [],
        allEmails: [],
        primaryEmail: undefined,
        linkedinUrl,
        companyName,
        companyDomain: companyName ? companyName.toLowerCase().replace(/\s+/g, "") : undefined,
        rawResponse: profile.rawResponse,
        contacts: [],
        mark: "test",
      };

      // Insert new contact to ContactOutCache
      const newContact = await ContactOutCache.create(contactCacheData);
      cacheIds.push(newContact._id.toString()); // Add new cache ID

      savedCount++; // Increment counter after successful save
      console.log(`Saved new contact cache for: ${fullName}`);
    } catch (error: any) {
      console.error(`Error saving contact cache for ${profile.name}:`, error.message);
      // Continue with next profile even if one fails
    }
  }

  return cacheIds;
};

interface CreateQuerySearchParams {
  cacheIds: string[];
  jobTitle?: string[] | null;
  fullName?: string | null;
  city?: string[] | null;
  state?: string[] | null;
  company?: string[] | null;
  pageNo?: number;
}

export const createQuerySearch = async (params: CreateQuerySearchParams): Promise<void> => {
  const { cacheIds, jobTitle, fullName, city, state, company, pageNo } = params;

  if (cacheIds.length === 0) {
    console.log("No cache IDs to create in ContactQuearySearch");
    return;
  }

  try {
    console.log("Creating new ContactQuearySearch");

    // Build searchParam object (with arrays)
    const searchParam: any = {};
    if (jobTitle && jobTitle.length > 0) searchParam.jobTitle = jobTitle;
    if (fullName) searchParam.fullName = fullName;
    if (company && company.length > 0) searchParam.Company = company;

    // Add location if city or state is provided (as arrays)
    if (city || state) {
      searchParam.location = {
        city: city || [],
        state: state || [],
        country: "United States",
      };
    }

    // Create page objects with 10 IDs each
    const pageObjects: any[] = [];
    for (let i = 0; i < cacheIds.length; i += 10) {
      const pageIds = cacheIds.slice(i, i + 10);
      const currentPageNo = (pageNo || 1) + Math.floor(i / 10);
      const pageKey = `page${currentPageNo}`;
      pageObjects.push({ [pageKey]: pageIds });
    }

    // Create new ContactSearch document
    await ContactSearch.create({
      searchParam,
      contactPages: pageObjects,
      totalContactCount: 0, // Keep empty as requested
      lastVisitedPageNo: 1, // Always set to 1 as requested
      noOfSearches: 1, // First time this query is created
    });

    console.log(`Created new ContactQuearySearch with ${pageObjects.length} page(s)`);
  } catch (error: any) {
    console.error("Error creating ContactQuearySearch:", error.message);
  }
};

interface HandlePageDataParams {
  jobTitle?: string[] | null;
  fullName?: string | null;
  city?: string[] | null;
  state?: string[] | null;
  company?: string[] | null;
  location?: string[] | null;
  pageNo: number;
}

export const handlePageDataRetrieval = async (
  params: HandlePageDataParams,
): Promise<{ success: boolean; data: any[]; message?: string; source?: string }> => {
  const { jobTitle, fullName, city, state, company, location, pageNo } = params;

  try {
    // Build search query with only provided parameters (using arrays)
    const searchQuery: any = {};
    if (jobTitle && jobTitle.length > 0) searchQuery["searchParam.jobTitle"] = jobTitle;
    if (fullName) searchQuery["searchParam.fullName"] = fullName;
    if (city && city.length > 0) searchQuery["searchParam.location.city"] = city;
    if (state && state.length > 0) searchQuery["searchParam.location.state"] = state;
    if (company && company.length > 0) searchQuery["searchParam.Company"] = company;

    // Find the existing search query
    const existingSearch = await ContactSearch.findOne(searchQuery).exec();

    if (!existingSearch) {
      return {
        success: false,
        data: [],
        message: "Query search not found",
      };
    }

    // Check if the requested page exists
    const pageKey = `page${pageNo}`;
    const contactPages = existingSearch.contactPages || [];

    let cacheIds: string[] = [];
    let pageIndex = -1;

    for (let i = 0; i < contactPages.length; i++) {
      if (contactPages[i][pageKey]) {
        cacheIds = contactPages[i][pageKey];
        pageIndex = i;
        break;
      }
    }

    // If page has 10 cache IDs, return the data
    if (cacheIds.length === 10) {
      console.log(`Page ${pageNo} has 10 cache IDs. Fetching data...`);

      // Fetch contact data from ContactOutCache using these IDs
      const contactData = await ContactOutCache.find({
        _id: { $in: cacheIds },
      })
        .lean()
        .exec();

      // Increment noOfSearches
      await ContactSearch.findByIdAndUpdate(existingSearch._id, {
        $inc: { noOfSearches: 1 },
      });

      return {
        success: true,
        data: contactData,
        message: `Data retrieved from cache for page${pageNo}`,
        source: "cache",
      };
    }

    // Page doesn't have 10 IDs, need to scrape and fill
    console.log(
      `Page ${pageNo} has ${cacheIds.length} cache IDs. Need to scrape more data to fill the page.`,
    );

    // Get the next page to visit from lastVisitedPageNo
    const lastVisitedPageNo = existingSearch.lastVisitedPageNo || 1;
    const nextPageToVisit = lastVisitedPageNo + 1;
    console.log(`Last visited page: ${lastVisitedPageNo}, Next page to scrape: ${nextPageToVisit}`);

    // Scrape new data from the next page
    const contactOutResult = await scrapeContactsWrapper(
      nextPageToVisit, // Use dynamic page number from DB
      jobTitle || [],
      location || [],
      company || [],
    );

    if (!contactOutResult.success || contactOutResult.profiles.length === 0) {
      return {
        success: false,
        data: [],
        message: "Failed to scrape new data",
      };
    }

    // Save profiles and get new cache IDs
    const newCacheIds = await saveContactCaches(contactOutResult.profiles);
    console.log(`Got ${newCacheIds.length} new cache IDs from scraping`);

    // Combine existing and new cache IDs
    const allCacheIds = [...cacheIds, ...newCacheIds];

    // Fill the incomplete page first, then create new pages
    const updatedContactPages = [...contactPages];

    if (pageIndex >= 0) {
      // Update the existing incomplete page
      const idsForCurrentPage = allCacheIds.slice(0, 10);
      updatedContactPages[pageIndex] = { [pageKey]: idsForCurrentPage };

      // Create new pages with remaining IDs
      const remainingIds = allCacheIds.slice(10);
      for (let i = 0; i < remainingIds.length; i += 10) {
        const pageIds = remainingIds.slice(i, i + 10);
        const newPageNo = pageNo + 1 + Math.floor(i / 10);
        const newPageKey = `page${newPageNo}`;
        updatedContactPages.push({ [newPageKey]: pageIds });
      }
    } else {
      // Page doesn't exist, create new pages
      for (let i = 0; i < allCacheIds.length; i += 10) {
        const pageIds = allCacheIds.slice(i, i + 10);
        const newPageNo = pageNo + Math.floor(i / 10);
        const newPageKey = `page${newPageNo}`;
        updatedContactPages.push({ [newPageKey]: pageIds });
      }
    }

    // Update the ContactSearch document with new pages and updated lastVisitedPageNo
    await ContactSearch.findByIdAndUpdate(existingSearch._id, {
      $set: {
        contactPages: updatedContactPages,
        lastVisitedPageNo: nextPageToVisit, // Update to the page we just visited
      },
      $inc: { noOfSearches: 1 },
    });

    console.log(
      `Updated ContactQuearySearch with filled/new pages. Updated lastVisitedPageNo to ${nextPageToVisit}`,
    );

    // Fetch and return the requested page data (first 10 IDs from allCacheIds)
    const requestedPageIds = allCacheIds.slice(0, 10);
    const contactData = await ContactOutCache.find({
      _id: { $in: requestedPageIds },
    })
      .lean()
      .exec();

    return {
      success: true,
      data: contactData,
      message: `Page ${pageNo} filled and data retrieved`,
      source: "contactout_api_filled",
    };
  } catch (error: any) {
    console.error("Error in handlePageDataRetrieval:", error.message);
    return {
      success: false,
      data: [],
      message: error.message,
    };
  }
};
