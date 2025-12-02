import { Types } from "mongoose";

export type IContact = {
  // Basic Info
  fullName: string;
  dateOfBirth?: Date;
  age?: number;
  maritalStatus?: string;
  spousePartnerDetails?: {
    name?: string;
    age?: number;
    occupation?: string;
    income?: number;
    financialPreferences?: string;
  };
  childrenDependents?: {
    name?: string;
    age?: number;
    notes?: string;
  }[];
  citizenshipResidency?: string;
  primaryAddress?: string;
  emailAddress: {
    personal?: string[];
    business?: string[];
  };
  phoneNumber: {
    personal?: string[];
    business?: string[];
  };
  // AI-generated insight from scraped documents (single object for latest analysis)
  insight?: {
    informativeInsight?: string;
    actionableInsight?: string;
  };
  signalType?: {
    category?: string;
    source?: string;
  };

  // Legacy signal types (keeping for backward compatibility)
  signalTypes?: string[];
  linkedinUrl?: string; // LinkedIn profile URL
  companyName?: string; // Primary company name for quick access

  // Professional & Income Data
  occupationTitle?: string;
  employerBusinessOwnership?: string;
  annualEarnedIncome: number;
  otherIncome?: string;
  expectedFutureIncomeEvents?: string;

  // Net Worth & Balance Sheet
  totalNetWorth: number;
  liquidNetWorth?: number;
  allAssets?: string[];
  allLiabilities?: string[];
  assetLocations?: string[];

  // Portfolio Details
  currentPortfolioHoldings?: string;
  concentratedPositions?: string;
  costBasisInformation?: string;
  portfolioGapsOrUnderexposure?: string;
  investmentVehiclesUsed?: string;

  // Behavioral & Investment Preferences
  riskTolerance?: string;
  riskCapacity?: string;
  investmentInterests?: string;
  pastInvestmentExperience?: string;
  liquidityPreferences?: string;
  emotionalBiases?: string;

  // Tax & Legal
  taxFilingStatus?: string;
  stateOfResidence?: string;
  topMarginalTaxRates?: {
    federal?: number;
    state?: number;
    capitalGains?: number;
    niit?: number;
  };
  carryforwardLosses?: string;
  taxBracketProjections?: string;
  trustStructures?: string;
  businessEntities?: string;
  legalConstraints?: string;

  // Real Estate & Lifestyle Assets
  primaryResidence?: string;
  otherProperties?: string[];
  luxuryAssets?: string[];
  insuranceCoverage?: string;

  // Planning Horizons & Goals
  retirementGoals?: string;
  philanthropicGoals?: string;
  wealthTransferGoals?: string;
  majorUpcomingEvents?: string;
  liquidityEventTimeline?: string;

  // Administrative & Advisor Relationships
  currentAdvisors?: string[];
  custodiansPlatforms?: string[];
  legalEntities?: string[];
  familyOfficeInvolvement?: string;
  complianceConstraints?: string;

  // Optional but Highly Valuable Data
  healthLongevityConcerns?: string;
  personalValuesOrImpactGoals?: string;
  familyDynamics?: string;
  behavioralFinanceProfile?: string;
  digitalAssetsOrCrypto?: string;

  // Meta
  sourceOfInformation: string;
  leadScore?: number;
  outreachScore?: number;

  // Relationships - Many-to-many with Companies
  companies?: Types.ObjectId[];

  //Relationships - One-One with Contact Cache
  contactCache?: {
    contactcacheId: Types.ObjectId;
  }[];

  // AI Enrichment Status
  aiEnrichmentStatus?: "pending" | "in_progress" | "completed" | "failed";
  aiEnrichmentDate?: Date;
  aiEnrichmentError?: string;

  // Signals - Array of linked signals with their types
  signals?: {
    signalId: Types.ObjectId;
    signalType:
      | "form_4"
      | "13d_13g"
      | "s1_s3"
      | "10b5_1"
      | "rsu_option_vest"
      | "ma_secondary"
      | "ma_private"
      | "property_sale"
      | "board_role_change"
      | "def_14a"
      | "10k"
      | "10q"
      | "8k"
      | "foundation_990"
      | "form_d"
      | "aircraft_registry"
      | "vessel"
      | "luxury_property"
      | "art_collection"
      | "museum_board"
      | "university_gift"
      | "political_donation"
      | "vc_investment"
      | "philanthropy-sponsorship"
      | "hiring";
    linkedAt?: Date;
  }[];

  createdAt: Date;
  updatedAt: Date;
};

export type ICompany = {
  // Basic Info
  companyName: string;
  legalName?: string;
  industry?: string;
  sector?: string;
  website?: string;
  description?: string;
  headquarters?: {
    address?: string;
    city?: string;
    state?: string;
    country?: string;
  };

  // AI-generated insights from scraped documents
  insight?: {
    informative?: string;
    actionable?: string;
  };
  signalType?: {
    category?: string;
    source?: string;
  };

  // Legacy signal types (keeping for backward compatibility)
  signalTypes?: string[];

  yearFounded?: number;
  registrationNumber?: string;
  stockSymbol?: string;
  ticker?: string; // Stock ticker symbol (alias for stockSymbol for compatibility)
  exchange?: string;
  entityType?: string; // LLC, C-Corp, S-Corp, Private, etc.
  cik?: string; // SEC CIK number for deduplication
  cusip?: string; // CUSIP identifier from Schedule 13D/G filings

  // Financial Data
  revenueRange?: string;
  estAnnualRevenue?: number;
  employeeCount?: number;
  valuation?: number;
  ownershipStructure?: string; // Public, Private, PE-backed, etc.
  fundingStage?: string; // Seed, Series A, IPO, etc.
  lastFundingRound?: {
    date?: Date;
    amount?: number;
    investors?: string[];
  };

  // Relationships
  keyPeople: Types.ObjectId[]; // Refs to Contact documents
  contacts?: Types.ObjectId[]; // Many-to-many relationship with Contacts
  boardMembers?: Types.ObjectId[];
  advisors?: Types.ObjectId[];
  parentCompany?: Types.ObjectId;
  subsidiaries?: Types.ObjectId[];

  // Operations
  locations?: string[];
  businessLines?: string[];
  productsOrServices?: string[];
  competitors?: string[];
  majorClients?: string[];
  partners?: string[];

  // Metadata
  signals?: {
    signalId: Types.ObjectId;
    signalType:
      | "form_4"
      | "13d_13g"
      | "s1_s3"
      | "10b5_1"
      | "rsu_option_vest"
      | "ma_secondary"
      | "ma_private"
      | "property_sale"
      | "board_role_change"
      | "def_14a"
      | "10k"
      | "10q"
      | "8k"
      | "foundation_990"
      | "form_d"
      | "aircraft_registry"
      | "vessel"
      | "luxury_property"
      | "art_collection"
      | "museum_board"
      | "university_gift"
      | "political_donation"
      | "vc_investment"
      | "philanthropy-sponsorship"
      | "hiring";
    linkedAt?: Date;
  }[];
  sourceOfInformation: string;
  lastUpdated?: Date;
  createdAt: Date;
  updatedAt: Date;
};

type ContactOutPerson = {
  full_name?: string;
  title?: string;
  headline?: string;
  location?: string;
  country?: string;
  industry?: string;
  profile_picture_url?: string;
  li_vanity?: string;
  job_function?: string;
  seniority?: string;
  summary?: string; // LinkedIn summary/bio
  followers?: number;
  updated_at?: string;
  work_status?: string | null;
  company?: {
    name?: string;
    domain?: string;
    email_domain?: string;
    url?: string;
    linkedin_company_id?: number;
    overview?: string;
    type?: string; // "Non Profit", "Public Company", etc.
    size?: number;
    country?: string;
    revenue?: number;
    founded_at?: number;
    industry?: string;
    headquarter?: string;
    website?: string;
    logo_url?: string;
    specialties?: string[];
    locations?: string[];
    [key: string]: any;
  };
  experience?: Array<string>; // Array of experience strings like "Title at Company in StartYear - EndYear"
  education?: Array<string>; // Array of education strings
  skills?: Array<string>;
  certifications?: Array<any>;
  publications?: Array<{
    url?: string | null;
    title?: string;
    description?: string;
    publisher?: string;
    authors?: Array<any>;
    published_on_year?: number | null;
    published_on_month?: number | null;
    published_on_day?: number | null;
  }>;
  projects?: Array<any>;
  languages?: Array<any>;
  contact_info?: {
    emails?: string[];
    work_emails?: string[];
    personal_emails?: string[];
    phones?: string[];
  };
  contact_availability?: {
    work_email?: boolean;
    personal_email?: boolean;
    phone?: boolean;
  };
  // Legacy fields for backward compatibility
  email?: string;
  work_email?: string;
  personal_email?: string;
  phone?: string;
  company_name?: string;
  linkedin_url?: string;
};

type ContactOutResponse = {
  results?: ContactOutPerson[];
  data?: ContactOutPerson | ContactOutPerson[];
  [key: string]: any;
};
