import mongoose, { Schema, Types } from "mongoose";

//Types
import { ICompany } from "../types/contacts.js";

//  Sub-schemas
const headquartersSchema = new Schema({
  address: String,
  city: String,
  state: String,
  country: String,
});

const insightSchema = new Schema({
  informative: { type: String },
  actionable: { type: String },
});

const signalTypeSchema = new Schema({
  category: { type: String },
  source: { type: String },
});

const lastFundingRoundSchema = new Schema({
  date: Date,
  amount: Number,
  investors: { type: [String], default: [] },
});

// Company Schema
const companySchema = new Schema<ICompany>(
  {
    //  Basic Info

    //////////////////////////////
    // must needed data (bare minimum)
    //////////////////////////////

    companyName: { type: String, required: true },
    legalName: { type: String },
    ticker: { type: String }, // Stock ticker symbol (alias for stockSymbol for compatibility)
    website: { type: String },
    sector: { type: String },
    locations: { type: [String], default: [] },

    // AI-generated insights from scraped documents
    insight: { type: insightSchema },
    signalType: { type: signalTypeSchema },

    // Legacy signal types (keeping for backward compatibility)
    signalTypes: [{ type: String }],

    /////////////////////////////////////

    industry: { type: String },
    description: { type: String },
    headquarters: { type: headquartersSchema },
    yearFounded: { type: Number },
    registrationNumber: { type: String },
    exchange: { type: String },
    entityType: { type: String },
    cik: { type: String }, // SEC CIK number for deduplication

    // Financial Data
    revenueRange: { type: String },
    estAnnualRevenue: { type: Number },
    employeeCount: { type: Number },
    valuation: { type: Number },
    ownershipStructure: { type: String },
    fundingStage: { type: String },
    lastFundingRound: { type: lastFundingRoundSchema },

    //peoples associated
    // Relationships (Important)
    keyPeople: [
      {
        type: Schema.Types.ObjectId,
        ref: "Contact",
        required: true,
      },
    ],
    contacts: [{ type: Schema.Types.ObjectId, ref: "Contact" }], // Many-to-many relationship with Contacts
    boardMembers: [{ type: Schema.Types.ObjectId, ref: "Contact" }],
    advisors: [{ type: Schema.Types.ObjectId, ref: "Contact" }],

    // Sub companies (umbrella company)
    parentCompany: { type: Schema.Types.ObjectId, ref: "Company" },
    subsidiaries: [{ type: Schema.Types.ObjectId, ref: "Company" }],
    partners: { type: [String], default: [] },

    //  Operations
    productsOrServices: { type: [String], default: [] },
    competitors: { type: [String], default: [] },
    majorClients: { type: [String], default: [] },

    // Metadata

    signals: [
      {
        signalId: { type: Schema.Types.ObjectId, ref: "SignalNew", required: true },
        signalType: {
          type: String,
          required: true,
          // Removed enum restriction to avoid conflicts with Signal model
          // Signal types are validated at the Signal model level
        },
        linkedAt: { type: Date, default: Date.now },
      },
    ],
    lastUpdated: { type: Date },
  },
  { timestamps: true },
);

// Indexes for query performance and deduplication
companySchema.index({ stockSymbol: 1 }, { unique: true, sparse: true }); // Primary deduplication key
companySchema.index({ ticker: 1 }, { sparse: true }); // Ticker lookup
companySchema.index({ cik: 1 }, { sparse: true }); // Secondary lookup key
companySchema.index({ name: 1 }); // Company name search
companySchema.index({ "signals.signalId": 1 }); // Query companies by signal
companySchema.index({ "signals.signalType": 1 }); // Query companies by signal type

export const Company = mongoose.model<ICompany>("Company", companySchema);
