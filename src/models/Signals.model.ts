import mongoose from "mongoose";

const signalSchema = new mongoose.Schema(
  {
    // ===================================
    // CORE ENTITY FIELDS (Always populated)
    // ===================================

    signalSource: {
      type: String,
      enum: ["Person", "Company"],
      required: true,
    },

    fullName: { type: String, required: true },
    designation: { type: String },
    location: { type: String },

    // ===================================
    // FILING INFORMATION (Form 4, Schedule 13D/G, Form 13F, etc.)
    // ===================================

    signalType: {
      type: String,
      enum: [
        // Form 4 - Insider Trading
        "form-4",
        // Schedule 13D/G - Beneficial Ownership
        "form-13d",
        "form-13da", // Amendment
        "form-13g",
        "form-13ga", // Amendment
        // Form 13F - Institutional Investment Manager Holdings
        "form-13f",
        "form-13fa", // Amendment
        // DEF 14A - Proxy Statement
        "def-14a",
        // Form 10-K - Annual Report
        "10-k",
        // Form 10-Q - Quarterly Report
        "10-q",
        // Form 8-K - Current Report (Material Events)
        "form-8k",
        "form-8ka", // Amendment
        // S-1/S-3 - IPO/Secondary Offerings (future)
        "s-1",
        "s-3",
        "form-s3",
        "form-s3a",
        "form-s3-underwriter",
        // Other forms (expandable)
        "form-d",
        "10b5-1",
      ],
      required: true,
    },
    filingType: { type: String }, // Form 4, SC 13D, SC 13G, SC 13D/A, SC 13G/A
    companyName: { type: String },
    companyNameVariants: [{ type: String }], // Array of company name variations for ContactOut matching
    companyTicker: { type: String },
    companyCik: { type: String }, // Changed from 'cik' for clarity - this is the issuer/company CIK
    companyCusip: { type: String }, // For Schedule 13D/G filings
    cik: { type: String }, // This is the reporting person/filer CIK
    accession: { type: String, sparse: true }, // Removed unique - using compound index below
    prevAccession: { type: String }, // Previous accession for amendments (13D/A, 13G/A)
    filingDate: { type: Date },
    periodOfReport: { type: Date },
    dateOfEvent: { type: Date }, // For Schedule 13D/G - when 5% threshold was crossed
    filingLink: { type: String },
    sourceUrl: { type: String },

    // ===================================
    // INSIDER RELATIONSHIP (Person signals only)
    // ===================================

    insiderName: { type: String },
    insiderCik: { type: String },
    insiderRole: { type: String },
    insiderRelationship: {
      isDirector: { type: Boolean },
      isOfficer: { type: Boolean },
      isTenPercentOwner: { type: Boolean },
      officerTitle: { type: String },
    },

    // ===================================
    // KEY PEOPLE (Company signals only)
    // ===================================

    keyPeople: [
      {
        fullName: { type: String },
        designation: { type: String },
        location: { type: String },
        relationship: { type: String }, // e.g., "Authorized Representative", "Managing Partner", "Signer"
        phoneNumber: { type: String }, // Contact phone if available
        email: { type: String }, // Contact email if available
        address: { type: String }, // Full address if available
        sourceOfInformation: { type: String },
        dateAdded: { type: Date, default: Date.now },
        lastUpdated: { type: Date, default: Date.now },
      },
    ],

    // ===================================
    // SCHEDULE 13D/G OWNERSHIP DATA
    // ===================================

    percentOfClass: { type: String }, // Percentage ownership (e.g., "6.2%")
    aggregateSharesOwned: { type: String }, // Total shares owned
    votingPower: {
      type: String,
      enum: ["Sole", "Shared", "None", ""],
    }, // Sole or Shared voting authority
    citizenshipOrOrganization: { type: String }, // State/country of citizenship or organization

    // ===================================
    // FORM 13F DATA - Institutional Investment Manager Holdings
    // ===================================

    portfolioSummary: {
      totalHoldings: { type: String },
      totalValue: { type: String },
      reportingPeriod: { type: String },
    },
    topHoldings: [
      {
        issuerName: { type: String },
        cusip: { type: String },
        value: { type: String },
        shares: { type: String },
        votingAuthority: { type: String },
        investmentDiscretion: { type: String },
      },
    ],
    reportContactName: { type: String }, // Contact person for Form 13F
    amendmentNumber: { type: String },
    amendmentType: { type: String },

    // ===================================
    // CONTACT INFORMATION (for lead generation)
    // ===================================

    phoneNumber: { type: String },
    email: { type: String },
    city: { type: String },
    state: { type: String },
    zipCode: { type: String },

    // ===================================
    // CONTACT ENRICHMENT (for pipeline)
    // ===================================

    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" }, // For Company signals - links to Company record
    enrichedContacts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Contact" }],
    contactEnrichmentStatus: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    contactEnrichmentDate: { type: Date },
    contactEnrichmentError: { type: String },

    processingStatus: {
      type: String,
      enum: ["Pending", "Processed", "Failed"],
      default: "Processed",
    },
    aiModelUsed: { type: String, default: "gpt-4o-mini" },
    sourceOfInformation: { type: String, default: "SEC EDGAR - Form 4" },
    filerType: { type: String },
    scrapingId: { type: mongoose.Schema.Types.ObjectId, ref: "Form4Filing" },
  },
  { timestamps: true },
);

// Indexes for query performance
signalSchema.index({ signalSource: 1, createdAt: -1 });
signalSchema.index({ fullName: 1 });
signalSchema.index({ companyName: 1, createdAt: -1 });
signalSchema.index({ companyTicker: 1, createdAt: -1 });
signalSchema.index({ accession: 1, fullName: 1 }, { unique: true }); // Compound unique index
signalSchema.index({ designation: 1 });
signalSchema.index({ filerType: 1 });
signalSchema.index({ "keyPeople.fullName": 1 });
signalSchema.index({ contactEnrichmentStatus: 1 });
signalSchema.index({ companyId: 1 }); // Query signals by company

export const Signal = mongoose.model("SignalNew", signalSchema);
