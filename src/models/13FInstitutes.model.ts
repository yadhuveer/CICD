import mongoose, { Schema } from "mongoose";

const holdingSchema = new Schema(
  {
    issuerName: { type: String, trim: true, required: true },
    // Removed "index: true" here to rely on the compound index below
    cusip: { type: String, required: true },
    titleOfClass: { type: String },
    ticker: { type: String },
    sector: { type: String }, // Removed index: true to save space (add back if querying by sector often)

    value: { type: Number, required: true },
    shares: { type: Number, required: true },
    shareType: { type: String, default: "SH" },
    percentOfPortfolio: { type: Number },

    // Change Data
    changeType: {
      type: String,
      enum: ["NEW", "INCREASED", "DECREASED", "UNCHANGED", "EXITED"],
      default: "NEW",
    },
    valueChange: { type: Number },
    valueChangePct: { type: Number },
    sharesChange: { type: Number },

    investmentDiscretion: { type: String },
    votingAuthority: {
      sole: Number,
      shared: Number,
      none: Number,
    },
  },
  { _id: false }, // Keep _id false for subdocs
);

const quarterlyReportSchema = new Schema(
  {
    // Removed "index: true" here to rely on the explicit index below
    quarter: { type: String, required: true },
    periodOfReport: { type: Date, required: true },
    filingDate: { type: Date, required: true },
    accessionNumber: { type: String, unique: true, sparse: true },

    summary: {
      totalHoldingsCount: { type: Number, required: true },
      totalMarketValue: { type: Number, required: true },
    },

    sectorBreakdown: [
      {
        sector: String,
        value: Number,
        percentage: Number,
      },
    ],

    portfolioChanges: {
      newPositions: { type: Number, default: 0 },
      increasedPositions: { type: Number, default: 0 },
      decreasedPositions: { type: Number, default: 0 },
      exitedPositions: { type: Number, default: 0 },
      unchangedPositions: { type: Number, default: 0 },
      totalValueChange: { type: Number, default: 0 },
      totalValueChangePct: { type: Number, default: 0 },
    },

    // MIGRATION NOTE: Holdings moved to separate collection (13FHoldings.model.ts)
    // Keep this temporarily for backward compatibility during migration
    holdings: { type: [holdingSchema], default: undefined },
  },
  { _id: true },
);

const institutionalFilerSchema = new Schema(
  {
    cik: {
      type: String,
      required: true,
      unique: true,
      // Keep index here for main CIK lookups, or move to bottom
      index: true,
    },

    filerName: {
      type: String,
      required: true,
      trim: true,
    },

    address: {
      street1: String,
      city: String,
      state: String,
      zip: String,
    },

    latestActivity: {
      lastReportedQuarter: String,
      lastFilingDate: Date,
      lastUpdated: { type: Date, default: Date.now },
      currentHoldingsCount: Number,
      currentMarketValue: Number,
    },

    quarterlyReports: [quarterlyReportSchema],

    // AI-generated overall insight for this filer
    overallInsight: { type: String },
  },
  { timestamps: true },
);

// Explicit Indexes (These caused the duplicates when combined with inline index:true)
institutionalFilerSchema.index({ "quarterlyReports.quarter": 1 });
institutionalFilerSchema.index({ "quarterlyReports.holdings.cusip": 1 });
institutionalFilerSchema.index({ "latestActivity.lastReportedQuarter": -1 });
institutionalFilerSchema.index({ filerName: "text" }); // Optional: Text search for filer name

export const InstitutionalFiler = mongoose.model("InstitutionalFilerKK", institutionalFilerSchema);
