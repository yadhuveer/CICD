import mongoose, { Schema, Model } from "mongoose";
import { TContactSearch } from "../types/contactQuery.types.js";

/**
 * =====================================
 * SUB-SCHEMAS
 * =====================================
 */

// Location
const locationSchema = new Schema(
  {
    city: { type: [String] },
    state: { type: [String] },
    country: {
      type: String,
      enum: ["United States"],
      default: "United States",
    },
  },
  { _id: false },
);

// Search Params
const searchParamSchema = new Schema(
  {
    fullName: { type: String },
    jobTitle: { type: [String] },
    Company: { type: [String] },
    location: { type: locationSchema },
  },
  { _id: false },
);

// Dynamic Contact Pages like: { page1: ["id1","id2"] }
const contactPageSchema = new Schema(
  {},
  {
    _id: false,
    strict: false, // allows page1, page2 etc dynamically
  },
);

/**
 * =====================================
 * MAIN CONTACT SEARCH SCHEMA
 * =====================================
 */

const contactSearchSchema = new Schema<TContactSearch>(
  {
    searchParam: {
      type: searchParamSchema,
      required: true,
    },

    contactPages: {
      type: [contactPageSchema],
      default: [],
    },

    totalContactCount: {
      type: Number,
      default: 0,
    },

    lastVisitedPageNo: {
      type: Number,
      default: 0,
    },

    noOfSearches: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: "ContactQuearySearch",
  },
);

/**
 * =====================================
 * INDEXES
 * =====================================
 */
contactSearchSchema.index({ "searchParam.fullName": 1 });
contactSearchSchema.index({ "searchParam.jobTitle": 1 });
contactSearchSchema.index({ "searchParam.Company": 1 });
contactSearchSchema.index({ "searchParam.location.city": 1 });
contactSearchSchema.index({ lastVisitedPageNo: 1 });
contactSearchSchema.index({ createdAt: -1 });

/**
 * =====================================
 * MODEL EXPORT
 * =====================================
 * MongoDB Collection: ContactSearch
 */
export const ContactSearch: Model<TContactSearch> = mongoose.model<TContactSearch>(
  "ContactQuearySearch",
  contactSearchSchema,
);
