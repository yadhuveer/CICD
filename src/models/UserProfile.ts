import mongoose from "mongoose";

// Timezone enum
export const Timezone = {
  EST: "America/New_York",
  CST: "America/Chicago",
  MST: "America/Denver",
  MST_ARIZONA: "America/Phoenix",
  PST: "America/Los_Angeles",
  AKT: "America/Anchorage",
  HT: "Pacific/Honolulu",
};

// This extends the Better Auth user model
const userProfileSchema = new mongoose.Schema(
  {
    // Using Better Auth user _id as the _id of this document
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "user", // Reference to Better Auth's user collection
    },

    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      required: false,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    phoneNumber: {
      type: String,
      default: "",
      trim: true,
    },

    jobTitle: {
      type: String,
      default: "",
      trim: true,
    },

    companyName: {
      type: String,
      default: "",
      trim: true,
    },

    designation: {
      type: String,
      default: "",
      trim: true,
    },

    timezone: {
      type: String,
      enum: Object.values(Timezone),
      default: Timezone.EST,
    },

    profileImage: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
    _id: false, // since we’re reusing Better Auth _id
  },
);

const UserProfile = mongoose.models.UserProfile || mongoose.model("UserProfile", userProfileSchema);

export default UserProfile;
