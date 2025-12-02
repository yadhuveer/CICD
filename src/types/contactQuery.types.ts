// Fixed country type
export type TCountry = "United States";

// Location object
export type TLocation = {
  city?: string[];
  state?: string[];
  country: TCountry;
};

// Search parameters
export type TSearchParam = {
  fullName?: string;
  jobTitle?: string[];
  location?: TLocation;
  Company?: string[];
};

// Each page structure like { page1: ["id1","id2"] }
export type TContactPage = {
  [pageKey: string]: string[]; // array of cacheIds
};

// Main Schema
export type TContactSearch = {
  searchParam: TSearchParam;
  contactPages: TContactPage[];
  totalContactCount: number;
  lastVisitedPageNo: number;
  noOfSearches: number;
};
