/**
 * US States Configuration for M&A Monitoring
 * All 50 states with major cities and regional groupings
 */

export type StateInfo = {
  code: string;
  name: string;
  majorCities: string[];
  region: "Northeast" | "Southeast" | "Midwest" | "Southwest" | "West";
  businessJournals?: string[];
};

export const US_STATES: StateInfo[] = [
  // Northeast Region
  {
    code: "CT",
    name: "Connecticut",
    majorCities: ["Hartford", "New Haven", "Stamford"],
    region: "Northeast",
  },
  {
    code: "DE",
    name: "Delaware",
    majorCities: ["Wilmington", "Dover"],
    region: "Northeast",
  },
  {
    code: "ME",
    name: "Maine",
    majorCities: ["Portland", "Lewiston"],
    region: "Northeast",
  },
  {
    code: "MA",
    name: "Massachusetts",
    majorCities: ["Boston", "Worcester", "Springfield", "Cambridge"],
    region: "Northeast",
  },
  {
    code: "NH",
    name: "New Hampshire",
    majorCities: ["Manchester", "Nashua"],
    region: "Northeast",
  },
  {
    code: "NJ",
    name: "New Jersey",
    majorCities: ["Newark", "Jersey City", "Paterson"],
    region: "Northeast",
  },
  {
    code: "NY",
    name: "New York",
    majorCities: ["New York City", "Buffalo", "Rochester", "Albany"],
    region: "Northeast",
  },
  {
    code: "PA",
    name: "Pennsylvania",
    majorCities: ["Philadelphia", "Pittsburgh", "Allentown"],
    region: "Northeast",
  },
  {
    code: "RI",
    name: "Rhode Island",
    majorCities: ["Providence"],
    region: "Northeast",
  },
  {
    code: "VT",
    name: "Vermont",
    majorCities: ["Burlington"],
    region: "Northeast",
  },

  // Southeast Region
  {
    code: "AL",
    name: "Alabama",
    majorCities: ["Birmingham", "Montgomery", "Mobile"],
    region: "Southeast",
  },
  {
    code: "AR",
    name: "Arkansas",
    majorCities: ["Little Rock", "Fayetteville"],
    region: "Southeast",
  },
  {
    code: "FL",
    name: "Florida",
    majorCities: ["Miami", "Tampa", "Orlando", "Jacksonville"],
    region: "Southeast",
  },
  {
    code: "GA",
    name: "Georgia",
    majorCities: ["Atlanta", "Savannah", "Augusta"],
    region: "Southeast",
  },
  {
    code: "KY",
    name: "Kentucky",
    majorCities: ["Louisville", "Lexington"],
    region: "Southeast",
  },
  {
    code: "LA",
    name: "Louisiana",
    majorCities: ["New Orleans", "Baton Rouge"],
    region: "Southeast",
  },
  {
    code: "MS",
    name: "Mississippi",
    majorCities: ["Jackson"],
    region: "Southeast",
  },
  {
    code: "NC",
    name: "North Carolina",
    majorCities: ["Charlotte", "Raleigh", "Durham"],
    region: "Southeast",
  },
  {
    code: "SC",
    name: "South Carolina",
    majorCities: ["Charleston", "Columbia"],
    region: "Southeast",
  },
  {
    code: "TN",
    name: "Tennessee",
    majorCities: ["Nashville", "Memphis", "Knoxville"],
    region: "Southeast",
  },
  {
    code: "VA",
    name: "Virginia",
    majorCities: ["Virginia Beach", "Richmond", "Norfolk"],
    region: "Southeast",
  },
  {
    code: "WV",
    name: "West Virginia",
    majorCities: ["Charleston"],
    region: "Southeast",
  },

  // Midwest Region
  {
    code: "IL",
    name: "Illinois",
    majorCities: ["Chicago", "Springfield", "Rockford"],
    region: "Midwest",
  },
  {
    code: "IN",
    name: "Indiana",
    majorCities: ["Indianapolis", "Fort Wayne"],
    region: "Midwest",
  },
  {
    code: "IA",
    name: "Iowa",
    majorCities: ["Des Moines", "Cedar Rapids"],
    region: "Midwest",
  },
  {
    code: "KS",
    name: "Kansas",
    majorCities: ["Wichita", "Kansas City"],
    region: "Midwest",
  },
  {
    code: "MI",
    name: "Michigan",
    majorCities: ["Detroit", "Grand Rapids", "Ann Arbor"],
    region: "Midwest",
  },
  {
    code: "MN",
    name: "Minnesota",
    majorCities: ["Minneapolis", "St. Paul"],
    region: "Midwest",
  },
  {
    code: "MO",
    name: "Missouri",
    majorCities: ["Kansas City", "St. Louis"],
    region: "Midwest",
  },
  {
    code: "NE",
    name: "Nebraska",
    majorCities: ["Omaha", "Lincoln"],
    region: "Midwest",
  },
  {
    code: "ND",
    name: "North Dakota",
    majorCities: ["Fargo", "Bismarck"],
    region: "Midwest",
  },
  {
    code: "OH",
    name: "Ohio",
    majorCities: ["Columbus", "Cleveland", "Cincinnati"],
    region: "Midwest",
  },
  {
    code: "SD",
    name: "South Dakota",
    majorCities: ["Sioux Falls"],
    region: "Midwest",
  },
  {
    code: "WI",
    name: "Wisconsin",
    majorCities: ["Milwaukee", "Madison"],
    region: "Midwest",
  },

  // Southwest Region
  {
    code: "AZ",
    name: "Arizona",
    majorCities: ["Phoenix", "Tucson"],
    region: "Southwest",
  },
  {
    code: "NM",
    name: "New Mexico",
    majorCities: ["Albuquerque", "Santa Fe"],
    region: "Southwest",
  },
  {
    code: "OK",
    name: "Oklahoma",
    majorCities: ["Oklahoma City", "Tulsa"],
    region: "Southwest",
  },
  {
    code: "TX",
    name: "Texas",
    majorCities: ["Houston", "Dallas", "Austin", "San Antonio"],
    region: "Southwest",
  },

  // West Region
  {
    code: "AK",
    name: "Alaska",
    majorCities: ["Anchorage"],
    region: "West",
  },
  {
    code: "CA",
    name: "California",
    majorCities: ["Los Angeles", "San Francisco", "San Diego", "San Jose"],
    region: "West",
  },
  {
    code: "CO",
    name: "Colorado",
    majorCities: ["Denver", "Colorado Springs"],
    region: "West",
  },
  {
    code: "HI",
    name: "Hawaii",
    majorCities: ["Honolulu"],
    region: "West",
  },
  {
    code: "ID",
    name: "Idaho",
    majorCities: ["Boise"],
    region: "West",
  },
  {
    code: "MT",
    name: "Montana",
    majorCities: ["Billings"],
    region: "West",
  },
  {
    code: "NV",
    name: "Nevada",
    majorCities: ["Las Vegas", "Reno"],
    region: "West",
  },
  {
    code: "OR",
    name: "Oregon",
    majorCities: ["Portland", "Salem"],
    region: "West",
  },
  {
    code: "UT",
    name: "Utah",
    majorCities: ["Salt Lake City"],
    region: "West",
  },
  {
    code: "WA",
    name: "Washington",
    majorCities: ["Seattle", "Spokane", "Tacoma"],
    region: "West",
  },
  {
    code: "WY",
    name: "Wyoming",
    majorCities: ["Cheyenne"],
    region: "West",
  },
];

/**
 * Regional groupings for efficient Parallel.ai searching
 */
export const REGIONS = {
  Northeast: US_STATES.filter((s) => s.region === "Northeast"),
  Southeast: US_STATES.filter((s) => s.region === "Southeast"),
  Midwest: US_STATES.filter((s) => s.region === "Midwest"),
  Southwest: US_STATES.filter((s) => s.region === "Southwest"),
  West: US_STATES.filter((s) => s.region === "West"),
};

/**
 * State Filing Keywords (13 items) - EXACT match only
 */
export const STATE_FILING_KEYWORDS = [
  "Articles of Merger",
  "Certificate of Merger",
  "Plan of Merger",
  "Articles of Dissolution",
  "Certificate of Dissolution",
  "Voluntary Dissolution",
  "Articles of Conversion",
  "Certificate of Conversion",
  "Change of Control",
  "Entity Conversion",
  "UCC-3 Termination",
  "Release of Lien",
  "Termination Statement",
];

/**
 * Press/News Keywords (11 items) - EXACT match only
 */
export const PRESS_NEWS_KEYWORDS = [
  "Acquired by",
  "Acquisition completed",
  "Merger agreement",
  "Sale of business",
  "Company sold",
  "Strategic transaction",
  "Private equity acquisition",
  "Portfolio company exit",
  "Buyout",
  "Majority stake acquired",
  "Minority stake acquired",
];

/**
 * Role Change Keywords (5 items) - EXACT match only
 */
export const ROLE_CHANGE_KEYWORDS = [
  "Founder exited",
  "CEO transition",
  "Leadership change",
  "Board restructuring",
  "Management buyout",
];

/**
 * Public Filings Keywords (4 items) - EXACT match only
 */
export const PUBLIC_FILING_KEYWORDS = [
  "Item 2.01 Completion of Acquisition",
  "Item 1.01 Entry into Material Agreement",
  "Merger Agreement",
  "Purchase Agreement",
];

/**
 * After-Effects Keywords (6 items) - EXACT match only
 */
export const AFTER_EFFECTS_KEYWORDS = [
  "Domain transfer",
  "Trademark assignment",
  "Asset sale",
  "Property divestiture",
  "Donation to DAF",
  "990-PF filing",
];

/**
 * ALL M&A Keywords combined (for general RSS filtering)
 */
export const MA_KEYWORDS = [
  ...STATE_FILING_KEYWORDS,
  ...PRESS_NEWS_KEYWORDS,
  ...ROLE_CHANGE_KEYWORDS,
  ...PUBLIC_FILING_KEYWORDS,
  ...AFTER_EFFECTS_KEYWORDS,
];
