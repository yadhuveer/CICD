import mongoose, { Schema } from "mongoose";

const contactOutCacheSchema = new Schema(
  {
    searchKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    //  Identity fields for flexible search & de-duplication

    fullName: { type: String, index: true },
    normalizedName: { type: String, index: true }, // e.g. "johnsmith"
    nameVariations: [{ type: String, index: true }], // alternate spellings, initials, etc.

    primaryEmail: { type: String, lowercase: true, trim: true, index: true },
    allEmails: [{ type: String, lowercase: true, trim: true, index: true }],

    linkedinUrl: { type: String, unique: true, sparse: true, index: true },

    companyName: { type: String, index: true },
    companyDomain: { type: String, lowercase: true, index: true },

    //Raw ContactOut API response
    rawResponse: {
      type: Schema.Types.Mixed,
      required: true,
    },

    //DeleteLater
    mark: { type: String },

    contacts: [{ _id: false, contactId: { type: mongoose.Schema.Types.ObjectId, ref: "contact" } }],

    // Metadata

    statusCode: Number,
    totalResults: Number,
    createdAt: { type: Date, default: Date.now },
    lastCheckedAt: Date,
    expiresAt: Date,
  },
  { timestamps: true },
);

/**
 * Pre-save normalization hook
 * Ensures all identifiers are lowercase and normalized for matching.
 */
contactOutCacheSchema.pre("save", function (next) {
  if (this.fullName) {
    this.normalizedName = this.fullName.toLowerCase().replace(/[^a-z]/g, "");
  }
  if (this.companyName) this.companyName = this.companyName.trim().toLowerCase();

  if (this.primaryEmail) this.primaryEmail = this.primaryEmail.trim().toLowerCase();

  if (Array.isArray(this.allEmails))
    this.allEmails = this.allEmails.map((e) => e.trim().toLowerCase());

  if (!this.searchKey && this.fullName && this.companyName) {
    this.searchKey = `${this.fullName.toLowerCase()}|${this.companyName.toLowerCase()}`;
  }

  next();
});

/**
 *  Compound indexes for powerful search
 */
contactOutCacheSchema.index(
  { normalizedName: 1, companyDomain: 1 },
  { name: "name_company_index" },
);
contactOutCacheSchema.index({ primaryEmail: 1 }, { name: "email_index" });
contactOutCacheSchema.index({ allEmails: 1 }, { name: "all_emails_index" });
contactOutCacheSchema.index(
  { normalizedName: "text", companyName: "text" },
  { name: "text_search_index" },
);

contactOutCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ContactOutCache = mongoose.model("ContactOutCache", contactOutCacheSchema);
