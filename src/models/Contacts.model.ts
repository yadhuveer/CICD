import mongoose, { Schema } from "mongoose";
import { IContact } from "../types/contacts.js";

/**
 * -------------------------
 * Sub-schemas
 * -------------------------
 */
const spousePartnerSchema = new Schema({
  name: String,
  age: Number,
  occupation: String,
  income: Number,
  financialPreferences: String,
});

const childrenSchema = new Schema({
  name: String,
  age: Number,
  notes: String,
});

const taxRateSchema = new Schema({
  federal: Number,
  state: Number,
  capitalGains: Number,
  niit: Number,
});

const insightSchema = new Schema({
  informativeInsight: { type: String },
  actionableInsight: { type: String },
});

const signalTypeSchema = new Schema({
  category: { type: String },
  source: { type: String },
});

const contactSchema = new Schema<IContact>(
  {
    // Basic Personal & Demographic Information
    ////////////////////////////////////////////
    // Key things needed (bare minimum)
    ////////////////////////////////////////////
    fullName: { type: String, required: true },
    emailAddress: {
      personal: { type: [String], default: [] },
      business: { type: [String], default: [] },
    },
    phoneNumber: {
      personal: { type: [String], default: [] },
      business: { type: [String], default: [] },
    },
    linkedinUrl: { type: String }, // LinkedIn profile URL
    companyName: { type: String }, // Primary company name for quick access
    dateOfBirth: { type: Date },
    age: { type: Number },

    // Relationships - Many-to-many with Companies
    companies: [
      {
        companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
        designation: { type: String },
      },
    ],

    contactCache: [
      {
        _id: false,
        contactcacheId: { type: mongoose.Schema.Types.ObjectId, ref: "ContactOutCache" },
      },
    ],

    // AI Enrichment Status Tracking
    aiEnrichmentStatus: {
      type: String,
      enum: ["pending", "in_progress", "completed", "failed"],
      default: "pending",
    },
    aiEnrichmentDate: { type: Date },
    aiEnrichmentError: { type: String },

    leadScore: { type: Number, default: 0 },

    // AI-generated insight from scraped documents (single object for latest analysis)
    insight: { type: insightSchema },
    signalType: { type: signalTypeSchema },

    // Legacy signal types (keeping for backward compatibility)
    signalTypes: [{ type: String, default: undefined }],

    ///////////////////////////////////
    // rest of the things
    ///////////////////////////////////

    // personal life
    maritalStatus: { type: [String], default: [] },
    spousePartnerDetails: { type: [spousePartnerSchema], default: [] },
    childrenDependents: { type: [childrenSchema], default: [] },
    citizenshipResidency: { type: [String], default: [] },
    primaryAddress: { type: [String], default: [] },

    // Professional & Income Data

    occupationTitle: { type: [String], default: [] },
    employerBusinessOwnership: { type: [String], default: [] },
    annualEarnedIncome: { type: Number },
    otherIncome: { type: [String], default: [] },
    expectedFutureIncomeEvents: { type: [String], default: [] },

    // Net Worth & Balance Sheet

    totalNetWorth: { type: Number },
    liquidNetWorth: { type: [Number], default: [] },
    allAssets: { type: [String], default: [] },
    allLiabilities: { type: [String], default: [] },
    assetLocations: { type: [String], default: [] },

    // Portfolio Details

    currentPortfolioHoldings: { type: [String], default: [] },
    concentratedPositions: { type: [String], default: [] },
    costBasisInformation: { type: [String], default: [] },
    portfolioGapsOrUnderexposure: { type: [String], default: [] },
    investmentVehiclesUsed: { type: [String], default: [] },

    //Behavioral & Investment Preferences

    riskTolerance: { type: [String], default: [] },
    riskCapacity: { type: [String], default: [] },
    investmentInterests: { type: [String], default: [] },
    pastInvestmentExperience: { type: [String], default: [] },
    liquidityPreferences: { type: [String], default: [] },
    emotionalBiases: { type: [String], default: [] },

    //  Tax & Legal
    taxFilingStatus: { type: [String], default: [] },
    stateOfResidence: { type: [String], default: [] },
    topMarginalTaxRates: { type: [taxRateSchema], default: [] },
    carryforwardLosses: { type: [String], default: [] },
    taxBracketProjections: { type: [String], default: [] },
    trustStructures: { type: [String], default: [] },
    businessEntities: { type: [String], default: [] },
    legalConstraints: { type: [String], default: [] },

    //Real Estate & Lifestyle Assets👀

    primaryResidence: { type: [String], default: [] },
    otherProperties: { type: [String], default: [] },
    luxuryAssets: { type: [String], default: [] },
    insuranceCoverage: { type: [String], default: [] },

    //Planning Horizons & Goals

    retirementGoals: { type: [String], default: [] },
    philanthropicGoals: { type: [String], default: [] },
    wealthTransferGoals: { type: [String], default: [] },
    majorUpcomingEvents: { type: [String], default: [] },
    liquidityEventTimeline: { type: [String], default: [] },

    //Administrative & Advisor Relationships

    currentAdvisors: { type: [String], default: [] },
    custodiansPlatforms: { type: [String], default: [] },
    legalEntities: { type: [String], default: [] },
    familyOfficeInvolvement: { type: [String], default: [] },
    complianceConstraints: { type: [String], default: [] },

    //Optional but Highly Valuable Data

    healthLongevityConcerns: { type: [String], default: [] },
    personalValuesOrImpactGoals: { type: [String], default: [] },
    familyDynamics: { type: [String], default: [] },
    behavioralFinanceProfile: { type: [String], default: [] },
    digitalAssetsOrCrypto: { type: [String], default: [] },

    //Metadata

    sourceOfInformation: { type: String, required: true },

    //Signals - Array of linked signals with their types
    signals: [
      {
        signalId: { type: mongoose.Schema.Types.ObjectId, ref: "SignalNew", required: true },
        signalType: {
          type: String,
          required: true,
          // Removed enum restriction to avoid conflicts with Signal model
          // Signal types are validated at the Signal model level
        },
        linkedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

/**
 * =====================================
 * INDEXES for Performance Optimization
 * =====================================
 */
contactSchema.index({ fullName: 1 }); // Match by name
contactSchema.index({ linkedinUrl: 1 }, { unique: true, sparse: true }); // External ID match
contactSchema.index({ "emailAddress.personal": 1 }); // Email match
contactSchema.index({ "emailAddress.business": 1 }); // Email match
contactSchema.index({ "companies.companyId": 1 }); // Company relationship queries
contactSchema.index({ "signals.signalId": 1 }); // Signal relationship queries
contactSchema.index({ createdAt: -1 }); // Recent contacts

export const Contact = mongoose.model<IContact>("Contact", contactSchema);
