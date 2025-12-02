import { Request, Response } from "express";
import UserProfile from "../models/UserProfile.js";
import { updateUserProfileSchema } from "../validators/userProfile.validator.js";
import logger from "../utils/logger.js";

// ---------------------------------------------------------------------
// GET USER PROFILE
// ---------------------------------------------------------------------
export const getUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id; // from Better Auth middleware
    console.log("Authenticated user ID:", req.user);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized: missing user ID" });
    }

    // Try finding existing profile
    let profile = await UserProfile.findOne({ _id: userId });

    // If not found, create one using Better Auth user data
    if (!profile) {
      const betterUser = req.user; // Better Auth user object

      // console.log("Creating new profile for user:", betterUser);

      const newProfileData = {
        _id: userId, // Use Better Auth user ID as _id
        firstName: betterUser?.name.split(" ")[0] || "New",
        lastName: betterUser?.name.split(" ")[1] || "",
        email: betterUser?.email,
        phoneNumber: "",
        jobTitle: "",
        companyName: "Longwall LLP",
        designation: "",
        timezone: "America/New_York",
        profileImage: "",
      };

      // TODO: validate newProfileData type in future
      profile = new UserProfile(newProfileData);
      await profile.save();

      logger?.info?.(`Created new profile for user ID: ${userId}`);
    }

    return res.status(200).json({ success: true, data: profile });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error fetching/creating user profile:", message);
    return res.status(500).json({ success: false, message: "Server error", error: message });
  }
};

// ---------------------------------------------------------------------
// UPDATE USER PROFILE
// ---------------------------------------------------------------------
export const updateUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id; // handle either format

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized: missing user ID" });
    }

    // Validate request body using Joi
    const { error, value } = updateUserProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    // Prevent updates to restricted fields
    const restrictedFields = ["_id", "email"];
    restrictedFields.forEach((field) => delete value[field]);

    // Update user profile
    const updatedProfile = await UserProfile.findByIdAndUpdate(
      userId, // since _id = Better Auth userId
      { $set: value },
      { new: true, runValidators: true },
    );

    if (!updatedProfile) {
      return res.status(404).json({ success: false, message: "Profile not found" });
    }

    logger?.info?.(`Updated profile for user ID: ${userId}`);

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: updatedProfile,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error fetching/creating user profile:", message);
    return res.status(500).json({ success: false, message: "Server error", error: message });
  }
};

// ---------------------------------------------------------------------
// Invite User With Role (Admin only)
// ---------------------------------------------------------------------
