import { filingTypeEnum } from "../models/newSignal.model.ts";

export type IKeyPerson = {
  fullName?: string;
  designation?: string;
  location?: string;
  relationship?: string;
  phoneNumber?: string;
  email?: string;

  address?: string;
  sourceOfInformation?: string;
  dateAdded?: Date;
  lastUpdated?: Date;

  // ContactOut optimization fields (for auto-discovered executives)
  hasContactData?: boolean;
  _contactOutData?: {
    emails?: { personal: string[]; business: string[] };
    phones?: { personal: string[]; business: string[] };
    linkedinUrl?: string;
    location?: string;
    title?: string;
    fullContactOutPerson?: any; // Full ContactOutPerson object
  };
};

export type IForm4 = {
  insiderName?: string;
  insiderCik?: string;
  insiderRole?: string;
  insiderRelationship?: {
    isDirector?: boolean;
    isOfficer?: boolean;
    isTenPercentOwner?: boolean;
    officerTitle?: string;
  };
  transactionDate?: Date;
  transactionType?: string;
  numberOfShares?: number;
  pricePerShare?: number;
};

export type IForm13 = {
  // Core ownership data
  percentOfClass?: string;
  aggregateSharesOwned?: string;
  votingPower?: "Sole" | "Shared" | "None" | "";
  dispositivePower?: "Sole" | "Shared" | "None" | "";
  citizenshipOrOrganization?: string;
  dateOfEvent?: Date;
  reportingGroup?: string[];

  // Target company information (NEW - the company being invested IN)
  issuerCompany?: string; // The company being invested in (e.g., "Inventiva S.A.")
  issuerTicker?: string; // Ticker symbol of target company (e.g., "IVA")
  issuerCIK?: string; // CIK of target company

  // Investor information (NEW - clarify who is investing)
  primaryInvestor?: string; // Primary decision-maker (person or lead fund)
  investmentFirm?: string; // The firm/fund making the investment
  controllingPerson?: string; // Person who controls the investment decisions

  // Transaction analysis (NEW - for liquidity tracking)
  transactionType?:
    | "initial-purchase"
    | "increased-stake"
    | "decreased-stake"
    | "full-liquidation"
    | "unknown";
  previousOwnership?: string; // Previous % for amendments
  ownershipChange?: string; // "+5.2%" or "-12.3%"
  shareValueEstimate?: string; // Estimated dollar value of holdings

  // Item 3: Purpose and Source of Funds (NEW)
  purposeOfTransaction?: string; // Why they're buying/selling
  sourceOfFunds?: string; // Where money came from

  // Item 4: Plans or Proposals (NEW - for activist 13D)
  plansOrProposals?: string; // Activist intentions (M&A, board seats, etc.)

  // Item 5: Interest in Securities (NEW)
  jointFilers?: string[]; // Group members acting together

  // Tax planning flags (NEW)
  isLiquidityEvent?: boolean; // True if selling/decreasing position
  potentialTaxPlanningTarget?: boolean; // High-priority lead flag
  estimatedTaxableGain?: string; // Rough estimate if available
};

export type IForm8K = {
  itemNumber?: string;
  headline?: string;
  eventDate?: Date;
  summary?: string;
  involvedParties?: string[];
};

export type IMAParty = {
  name?: string;
  nameVariants?: string[];
  industry?: string;
  location?: string;
  ticker?: string;
  description?: string;
  // Enhanced company classification
  companyType?:
    | "public"
    | "private"
    | "private-equity-backed"
    | "venture-backed"
    | "family-owned"
    | "startup";
  companySize?: "large-cap" | "mid-cap" | "small-cap" | "micro-cap" | "startup";
  revenue?: string;
  employees?: string;
  fundingStage?: string;
  marketCap?: string;
};

export type IMAFinancialDetails = {
  totalValue?: string;
  cashComponent?: string;
  stockComponent?: string;
  earnoutStructure?: string;
  paymentTerms?: string;
  valuationMultiple?: string;
  debtAssumed?: string;
  workingCapital?: string;
  targetRevenue?: string;
  targetEBITDA?: string;
};

export type IMAInsights = {
  summary?: string;
  keyInsights?: string[];
  strategicRationale?: string;
  marketImplications?: string;
  integrationConsiderations?: string;
  keyRisks?: string;
};

export type IMAKeyPerson = {
  name: string;
  role?: string;
  company?: string;
  action?: string;
  background?: string;
};

export type IJobPosting = {
  companyDomain?: string;
  companyLocation?: string;
  companyDescription?: string;
  jobTitle?: string;
  jobLevel?: "CFO" | "Controller" | "Director" | "Manager" | "Analyst" | "Other";
  department?: string;
  description?: string;
  responsibilities?: string[];
  requirements?: string[];
  salaryRange?: string;
  postingDate?: string;
  jobUrl?: string;
  familyOfficeIndicators?: string[];
  hiringUrgency?: "low" | "medium" | "high" | "urgent";
  isNewRole?: boolean;
  qualityScore?: number;
};

export type IMAEvent = {
  eventType: "merger" | "acquisition" | "divestiture" | "joint-venture";
  status: "announced" | "pending" | "completed" | "terminated";
  announcementDate?: Date;
  effectiveDate?: Date;
  dealValue?: string; // "$18.55M", "undisclosed", etc.
  dealType?: "cash" | "stock" | "mixed" | "undisclosed";
  dealStructure?: string;
  acquiringCompany?: string; // backward compatibility
  strategicRationale?: string;
  insightSummary?: string; // Crisp 1-sentence summary of the deal

  // Enhanced: Financial details
  financialDetails?: IMAFinancialDetails;

  // Enhanced: Structured insights
  insights?: IMAInsights;

  // Enhanced: Key people involved in the transaction
  keyPeople?: IMAKeyPerson[];

  // New: fully structured parties
  parties?: {
    acquirer?: IMAParty;
    targets?: IMAParty[];
  };

  stateFiling?: {
    state?: string;
    filingType?: string;
    filingDate?: Date;
    filingNumber?: string;
    filingUrl?: string;
  };

  sources?: Array<{
    url?: string;
    title?: string;
    publishDate?: Date;
    sourceType?: string;
  }>;
};

export type IDAFContribution = {
  sourceUrl: string;

  entityType?: "person" | "organization" | "unknown";

  organizationName?: string;
  personName?: string;

  contacts?: {
    emails?: string[];
    phones?: string[];
    websites?: string[];
  };

  contributionType?: "recurring" | "burst" | "multi-year" | "one-time-inferred" | "unspecified";

  indicators?: string[];

  frequency?: string;
  amount?: string;

  contextSummary?: string;
  insights?: string;

  tags?: string[];

  confidenceScore?: number;
};
export type INextGenLeadership = {
  sourceUrl: string;

  entityType?: "person" | "organization" | "unknown";

  eventType?:
    | "leadership-change"
    | "appointment"
    | "succession"
    | "promotion"
    | "retirement"
    | "board-change"
    | "restructuring"
    | "general-news"
    | "unknown";

  roleNew: string;
  roleOld?: string | null;

  evidence?: string | null;
  insights?: string | null;

  emails?: string[];
  tags?: string[];

  confidenceScore?: number | null;
};
/* -----------------------------------------------------------
 * NEW: K-1 Income Structured Type (matches schema exactly)
 * ----------------------------------------------------------- */
export type IK1IncomeData = {
  sourceUrl: string;
  personName: string;
  organizationName: string;
  roleTitle: string;

  contacts?: {
    emails?: string[];
    phones?: string[];
  };

  partnerType?:
    | "equity-partner"
    | "senior-partner"
    | "managing-partner"
    | "general-partner"
    | "income-partner"
    | "non-equity-partner"
    | "unknown";

  modeledK1Income?: "50k-150k" | "150k-300k" | "300k-750k" | "750k-1.5m" | "1.5m-5m" | "5m+";

  industry?: "law" | "private-equity" | "venture-capital" | "consulting" | "accounting" | "other";

  insights?: string;
  confidenceScore?: number;
};

export type IPhilanthropy = {
  role?: string;
  institutionName?: string;
  institutionType?: string;
  sponsorshipLevel?: string;
  wealthIndicators?: string[];
  sourceTitle?: string;
};

export type newSignal = {
  signalSource: "Person" | "Company";
  signalType?: string;
  filingType: (typeof filingTypeEnum)[number];
  filingLink?: string;
  filingDate?: Date;

  insights?: string;
  aiModelUsed?: string;

  fullName: string;
  designation?: string;
  location?: string;

  companyName?: string;
  companyNameVariants?: string[];
  companyTicker?: string;
  keyPeople?: IKeyPerson[];
  companyAddress?: string;

  processingStatus?: "Pending" | "Processed" | "Failed";
  contactEnrichmentStatus?: "pending" | "processing" | "completed" | "failed";
  contactEnrichmentDate?: Date;
  contactEnrichmentError?: string;
  contactId?: string;

  // User feedback for M&A signals
  userFeedback?: "liked" | "disliked" | null;

  form4Data?: IForm4;
  form13Data?: IForm13;
  form8kData?: IForm8K;
  maEventData?: IMAEvent;
  dafContributionData?: IDAFContribution;
  jobPostingData?: IJobPosting;
  nextGenData?: INextGenLeadership;
  k1IncomeData?: IK1IncomeData;
  PhilanthropyData?: IPhilanthropy;
};
