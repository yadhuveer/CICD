import mongoose, { Schema, Model } from "mongoose";
import {
  IForm13,
  IForm4,
  IForm8K,
  IJobPosting,
  IKeyPerson,
  IMAEvent,
  IMAKeyPerson,
  IMAParty,
  newSignal,
  IPhilanthropy,
} from "../types/newSignalTypes.js";

export const filingTypeEnum = [
  "form-4",
  "form-13d",
  "form-13da",
  "form-13g",
  "form-13ga",
  "def-14a",
  "10-k",
  "10-q",
  "form-8k",
  "form-8ka",
  "s-1",
  "s-3",
  "form-s3",
  "form-s3a",
  "form-s3-underwriter",
  "form-d",
  "10b5-1",
  "ma-event",
  "hiring-event",
  "aircraft-registration",
  "aircraft-transfer",
  "vessel-registration",
  "vessel-transfer",
  "daf-contribution",
  "nextgen-leadership",
  "k1-income",
  "philanthropy-event",
] as const;

/**
 * =====================================
 * SUB-SCHEMAS
 * =====================================
 */
const keyPeopleSchema = new Schema<IKeyPerson>(
  {
    fullName: String,
    designation: String,
    location: String,
    relationship: String,
    phoneNumber: String,
    email: String,
    address: String,
    sourceOfInformation: String,
    dateAdded: { type: Date, default: Date.now },
    lastUpdated: { type: Date, default: Date.now },
  },
  { _id: false },
);

const form4Schema = new Schema<IForm4>(
  {
    insiderName: String,
    insiderCik: String,
    insiderRole: String,
    insiderRelationship: {
      isDirector: Boolean,
      isOfficer: Boolean,
      isTenPercentOwner: Boolean,
      officerTitle: String,
    },
    transactionDate: Date,
    transactionType: String,
    numberOfShares: Number,
    pricePerShare: Number,
  },
  { _id: false },
);

const form13Schema = new Schema<IForm13>(
  {
    // Core ownership data
    percentOfClass: String,
    aggregateSharesOwned: String,
    votingPower: {
      type: String,
      enum: ["Sole", "Shared", "None", ""],
    },
    dispositivePower: {
      type: String,
      enum: ["Sole", "Shared", "None", ""],
    },
    citizenshipOrOrganization: String,
    dateOfEvent: Date,
    reportingGroup: [String],

    // Target company information (NEW - the company being invested IN)
    issuerCompany: String,
    issuerTicker: String,
    issuerCIK: String,

    // Investor information (NEW - clarify who is investing)
    primaryInvestor: String,
    investmentFirm: String,
    controllingPerson: String,

    // Transaction analysis (NEW - for liquidity tracking)
    transactionType: {
      type: String,
      enum: [
        "initial-purchase",
        "increased-stake",
        "decreased-stake",
        "full-liquidation",
        "unknown",
      ],
    },
    previousOwnership: String,
    ownershipChange: String,
    shareValueEstimate: String,

    // Item 3: Purpose and Source of Funds (NEW)
    purposeOfTransaction: String,
    sourceOfFunds: String,

    // Item 4: Plans or Proposals (NEW - for activist 13D)
    plansOrProposals: String,

    // Item 5: Interest in Securities (NEW)
    jointFilers: [String],

    // Tax planning flags (NEW)
    isLiquidityEvent: Boolean,
    potentialTaxPlanningTarget: Boolean,
    estimatedTaxableGain: String,
  },
  { _id: false },
);

const form8kSchema = new Schema<IForm8K>(
  {
    itemNumber: String,
    headline: String,
    eventDate: Date,
    summary: String,
    involvedParties: [String],
  },
  { _id: false },
);

// M&A Party sub-schema
const maPartySchema = new Schema<IMAParty>(
  {
    name: String,
    nameVariants: [String],
    industry: String,
    location: String,
    ticker: String,
    description: String,
    // Enhanced company classification
    companyType: {
      type: String,
      enum: [
        "public",
        "private",
        "private-equity-backed",
        "venture-backed",
        "family-owned",
        "startup",
      ],
    },
    companySize: {
      type: String,
      enum: ["large-cap", "mid-cap", "small-cap", "micro-cap", "startup"],
    },
    revenue: String,
    employees: String,
    fundingStage: String,
    marketCap: String,
  },
  { _id: false },
);

const maKeyPersonSchema = new Schema<IMAKeyPerson>(
  {
    name: { type: String, required: true },
    role: String,
    company: String,
    action: String,
    background: String,
  },
  { _id: false },
);

const jobPostingSchema = new Schema<IJobPosting>(
  {
    companyDomain: String,
    companyLocation: String,
    companyDescription: String,
    jobTitle: String,
    jobLevel: {
      type: String,
      enum: ["CFO", "Controller", "Director", "Manager", "Analyst", "Other"],
    },
    department: String,
    description: String,
    responsibilities: [String],
    requirements: [String],
    salaryRange: String,
    postingDate: String,
    jobUrl: String,
    familyOfficeIndicators: [String],
    hiringUrgency: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
    },
    isNewRole: Boolean,
    qualityScore: Number,
  },
  { _id: false },
);

const maEventSchema = new Schema<IMAEvent>(
  {
    eventType: {
      type: String,
      enum: ["merger", "acquisition", "divestiture", "joint-venture"],
      required: true,
    },
    status: {
      type: String,
      enum: ["announced", "pending", "completed", "terminated"],
      required: true,
    },
    announcementDate: Date,
    effectiveDate: Date,
    dealValue: String, // can hold "$18.55M", "undisclosed", etc.
    dealType: {
      type: String,
      enum: ["cash", "stock", "mixed", "undisclosed"],
    },
    dealStructure: String,
    acquiringCompany: String, // backward compatibility with your current JSON
    strategicRationale: String,
    insightSummary: String, // Crisp 1-sentence summary of the deal

    // Enhanced: Financial details
    financialDetails: {
      totalValue: String,
      cashComponent: String,
      stockComponent: String,
      earnoutStructure: String,
      paymentTerms: String,
      valuationMultiple: String,
      debtAssumed: String,
      workingCapital: String,
      targetRevenue: String,
      targetEBITDA: String,
    },

    // Enhanced: Structured insights
    insights: {
      summary: String,
      keyInsights: [String],
      strategicRationale: String,
      marketImplications: String,
      integrationConsiderations: String,
      keyRisks: String,
    },

    // Enhanced: Key people involved
    keyPeople: [maKeyPersonSchema],

    // New: fully structured parties
    parties: {
      acquirer: maPartySchema,
      targets: [maPartySchema],
    },

    stateFiling: {
      state: String,
      filingType: String,
      filingDate: Date,
      filingNumber: String,
      filingUrl: String,
    },

    sources: [
      new Schema(
        {
          url: String,
          title: String,
          publishDate: Date,
          sourceType: String,
        },
        { _id: false },
      ),
    ],
  },
  { _id: false },
);

// DAF Contribution Sub-Schema
const dafContributionSchema = new Schema(
  {
    sourceUrl: { type: String, required: true },

    entityType: {
      type: String,
      enum: ["person", "organization", "unknown"],
      default: "unknown",
    },

    organizationName: { type: String },
    personName: { type: String },

    contacts: {
      emails: [String],
      phones: [String],
      websites: [String],
    },

    contributionType: {
      type: String,
      enum: ["recurring", "burst", "multi-year", "one-time-inferred", "unspecified"],
    },

    indicators: [String],

    frequency: { type: String },
    amount: { type: String },

    contextSummary: { type: String },
    insights: { type: String },

    tags: [String],

    confidenceScore: { type: Number, min: 0, max: 1 },
  },
  { _id: false },
);

const nextGenDataSchema = new Schema(
  {
    sourceUrl: { type: String, required: true },

    entityType: {
      type: String,
      enum: ["person", "organization", "unknown"],
      default: "unknown",
    },

    eventType: {
      type: String,
      enum: [
        "leadership-change",
        "appointment",
        "succession",
        "promotion",
        "retirement",
        "board-change",
        "restructuring",
        "general-news",
        "unknown",
      ],
      default: "unknown",
    },

    roleNew: { type: String, required: true },
    roleOld: { type: String, default: null },

    evidence: { type: String, default: null },
    insights: { type: String, default: null },

    emails: [String],
    tags: [String],

    confidenceScore: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },
  },
  { _id: false },
);

/* -----------------------------
 * K-1 income sub-schema
 * ----------------------------- */
const k1IncomeDataSchema = new Schema(
  {
    sourceUrl: { type: String },
    personName: { type: String },
    organizationName: { type: String },
    roleTitle: { type: String },
    contacts: {
      emails: [String],
      phones: [String],
    },

    partnerType: {
      type: String,
      enum: [
        "equity-partner",
        "senior-partner",
        "managing-partner",
        "general-partner",
        "income-partner",
        "non-equity-partner",
        "unknown",
      ],
    },

    modeledK1Income: {
      type: String,
      enum: ["50k-150k", "150k-300k", "300k-750k", "750k-1.5m", "1.5m-5m", "5m+"],
    },

    industry: {
      type: String,
      enum: ["law", "private-equity", "venture-capital", "consulting", "accounting", "other"],
    },

    insights: { type: String, default: "" },
    confidenceScore: { type: Number, min: 0, max: 1, default: 0 },
  },
  { _id: false },
);

const philanthropySchema = new Schema<IPhilanthropy>({
  role: {
    type: String,
    trim: true,
  },
  institutionName: {
    type: String,
    trim: true,
    index: true,
  },
  institutionType: {
    type: String,
    default: "other",
  },
  sponsorshipLevel: {
    type: String,
    default: "board-member",
  },
  wealthIndicators: [
    {
      type: String,
      trim: true,
    },
  ],
  sourceTitle: {
    type: String,
  },
});

/**
 * =====================================
 * MAIN CONTACT SCHEMA
 * =====================================
 */

const newSignalSchema = new Schema<newSignal>(
  {
    signalSource: {
      type: String,
      enum: ["Person", "Company"],
      required: true,
    },
    signalType: String,
    filingType: {
      type: String,
      enum: filingTypeEnum,
      required: true,
    },
    filingLink: String,
    filingDate: Date,

    //Ai Insights on the scraping
    insights: String,
    aiModelUsed: String,

    // data for person type
    fullName: { type: String, required: true },
    designation: String,
    location: String,

    // data for company type
    companyName: String,
    companyNameVariants: [String],
    companyTicker: String,
    keyPeople: [keyPeopleSchema],
    companyAddress: String,

    processingStatus: {
      type: String,
      enum: ["Pending", "Processed", "Failed"],
      default: "Processed",
    },
    contactEnrichmentStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    contactEnrichmentDate: Date,
    contactEnrichmentError: String,
    contactId: {
      type: Schema.Types.ObjectId,
      ref: "Contact",
    },

    // User feedback for M&A signals
    userFeedback: {
      type: String,
      enum: ["liked", "disliked"],
      default: null,
    },

    form4Data: form4Schema,
    form13Data: form13Schema,
    form8kData: form8kSchema,
    maEventData: maEventSchema,
    jobPostingData: jobPostingSchema,
    dafContributionData: dafContributionSchema,
    nextGenData: nextGenDataSchema,
    k1IncomeData: k1IncomeDataSchema,
    PhilanthropyData: philanthropySchema,
  },
  { timestamps: true, collection: "SignalNewKK" },
);

/**
 *
 * =====================================
 * INDEXES
 * =====================================
 */
newSignalSchema.index({ fullName: 1 });
newSignalSchema.index({ companyName: 1 });
newSignalSchema.index({ filingType: 1 });
newSignalSchema.index({ "keyPeople.fullName": 1 });
newSignalSchema.index({ contactEnrichmentStatus: 1 });
newSignalSchema.index({ createdAt: -1 });

/**
 * =====================================
 * MODEL EXPORT
 * =====================================
 * MongoDB Collection: SignalNewKK
 */
export const SignalNew: Model<newSignal> =
  mongoose.models.SignalNewKK || mongoose.model<newSignal>("SignalNewKK", newSignalSchema);
