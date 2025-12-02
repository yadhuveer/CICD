import mongoose, { Schema } from "mongoose";

const individualHoldingSchema = new Schema(
  {
    issuerName: { type: String, trim: true, required: true },
    cusip: { type: String, required: true },
    titleOfClass: { type: String },
    ticker: { type: String },
    sector: { type: String },

    value: { type: Number, required: true },
    shares: { type: Number, required: true },
    shareType: { type: String, default: "SH" },
    percentOfPortfolio: { type: Number },

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
  { _id: false },
);

const quarterlyHoldingsSchema = new Schema(
  {
    cik: { type: String, required: true },
    filerName: { type: String, required: true },
    quarter: { type: String, required: true },
    accessionNumber: { type: String, required: true },

    holdings: [individualHoldingSchema],
  },
  { timestamps: true },
);

quarterlyHoldingsSchema.index({ cik: 1, quarter: 1 }, { unique: true });

export const Holding = mongoose.model("Holding", quarterlyHoldingsSchema);
