import { Contact } from "../models/Contacts.model.js";

// Utility to safely escape characters for Regex (e.g., preventing errors with "+", "(", etc.)

function escapeRegex(text: string) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

export async function getContactsFiltered(
  // 1. Update Types to accept string OR string[]

  title?: string | string[],

  state?: string | string[],

  company?: string | string[],

  fromDate?: string,

  toDate?: string,

  search?: string,

  leadScore?: number,

  status?: string[],

  source?: string,

  type?: string,
) {
  const query: any = {};

  // --- 2. UPDATED LOGIC FOR TITLE (Array Support) ---

  if (title && (Array.isArray(title) ? title.length > 0 : title)) {
    const titleArray = Array.isArray(title) ? title : [title];

    // Filter empty strings, escape special chars, and join with OR operator "|"

    const cleanTitles = titleArray.filter((t) => t && t.trim() !== "").map(escapeRegex);

    if (cleanTitles.length > 0) {
      // Creates regex: /(Manager|Director|VP)/i

      query.occupationTitle = { $regex: cleanTitles.join("|"), $options: "i" };

      console.log("Title filter applied:", cleanTitles, "Regex:", cleanTitles.join("|"));
    }
  }

  // --- 3. UPDATED LOGIC FOR STATE (Array Support) ---

  if (state) {
    const stateArray = Array.isArray(state) ? state : [state];

    const cleanStates = stateArray.filter((s) => s && s.trim() !== "").map(escapeRegex);

    if (cleanStates.length > 0) {
      query.primaryAddress = { $regex: cleanStates.join("|"), $options: "i" };
    }
  }

  // --- 4. UPDATED LOGIC FOR COMPANY (Array Support) ----------
  if (company) {
    const companyArray = Array.isArray(company) ? company : [company];

    const cleanCompanies = companyArray.filter((c) => c && c.trim() !== "").map(escapeRegex);

    if (cleanCompanies.length > 0) {
      query.companyName = { $regex: cleanCompanies.join("|"), $options: "i" };
    }
  }

  if (fromDate || toDate) {
    console.log("📅 Date range filter received:", { fromDate, toDate });
    const dateQuery: any = {};

    if (fromDate) {
      // Start from beginning of fromDate
      const startOfDay = new Date(fromDate + "T00:00:00.000Z");
      dateQuery.$gte = startOfDay;
      console.log("📅 From date:", startOfDay.toISOString());
    }

    if (toDate) {
      // End at end of toDate
      const endOfDay = new Date(toDate + "T23:59:59.999Z");
      dateQuery.$lte = endOfDay;
      console.log("📅 To date:", endOfDay.toISOString());
    }

    query.createdAt = dateQuery;
    console.log("📅 Date range query:", dateQuery);
  }

  if (search && search.trim() !== "") {
    const escapedSearch = escapeRegex(search.trim());
    query.$or = [
      { fullName: { $regex: escapedSearch, $options: "i" } },
      { companyName: { $regex: escapedSearch, $options: "i" } },
    ];
    console.log(`🔍 Search filter applied: "${search}"`);
  }

  if (leadScore !== undefined) {
    query.leadScore = { $gte: leadScore };
  }

  if (status && status.length > 0) {
    query.status = { $in: status };
  }

  if (source && source !== "Both") {
    if (source === "Signal") {
      query.signals = { $exists: true, $ne: [] };
    } else if (source === "General") {
      if (query.$or) {
        query.$and = [
          { $or: query.$or },
          { $or: [{ signals: { $exists: false } }, { signals: { $size: 0 } }] },
        ];
        delete query.$or;
      } else {
        query.$or = [{ signals: { $exists: false } }, { signals: { $size: 0 } }];
      }
    }
  }

  if (type && type !== "All") {
    console.log("🔍 Final query before type aggregation:", JSON.stringify(query, null, 2));
    const pipeline: any[] = [
      { $match: query },
      // Lookup signals to check signalSource
      {
        $lookup: {
          from: "SignalNewKK",
          localField: "signals.signalId",
          foreignField: "_id",
          as: "signalDocs",
        },
      },
      // Add a field for the primary signal (first signal in the array)
      {
        $addFields: {
          primarySignalSource: { $arrayElemAt: ["$signalDocs.signalSource", 0] },
        },
      },
      // Filter contacts by primary signal type only
      {
        $match: {
          primarySignalSource: type, // "Person" or "Company"
        },
      },
      // Remove the temporary fields
      {
        $project: {
          signalDocs: 0,
          primarySignalSource: 0,
        },
      },
    ];

    const contacts = await Contact.aggregate(pipeline);
    console.log(`✅ Found ${contacts.length} contacts after type filter`);
    return contacts;
  }

  console.log("🔍 Final query (no type filter):", JSON.stringify(query, null, 2));

  const contacts = await Contact.find(query).lean(); // Use lean() for better performance
  console.log(`✅ Found ${contacts.length} contacts matching filter`);

  return contacts;
}

// export async function gettitleBasedContacts(title: string) {
//   const contacts = await Contact.find({
//     occupationTitle: { $regex: title, $options: "i" },
//   });
//   return contacts;........
// }

// export async function getlocationBasedContacts(title: string) {
//   const contacts = await Contact.find({
//     primaryAddress: { $regex: location, $options: "i" },
//   });
//   return contacts;
// }
