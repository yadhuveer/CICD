import mongoose, { Schema, Document } from "mongoose";

// ------------------------------------------------------------
// EMAIL SCHEMA
// ------------------------------------------------------------
const emailSchema = new Schema(
  {
    type: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    day: { type: Number, required: true },
    delay_hours: { type: Number, required: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// ------------------------------------------------------------
// USER SCHEMA — Each contact the campaign targets
// ------------------------------------------------------------
const campaignUserSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact", // Reference to existing Contact model
      required: true,
    },
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    emails: {
      type: Map,
      of: emailSchema,
      required: true,
    },
  },
  { _id: false },
);

// ------------------------------------------------------------
// MAIN EMAIL CAMPAIGN SCHEMA
// ------------------------------------------------------------
const emailCampaignSchema = new Schema(
  {
    name: { type: String, required: true },
    users: { type: [campaignUserSchema], default: [] },
  },
  { timestamps: true },
);

export const EmailCampaign = mongoose.model("EmailCampaign", emailCampaignSchema);
