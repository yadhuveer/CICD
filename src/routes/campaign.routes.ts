import express, { Request, Response } from "express";
import { generateCampaign } from "../tools/AiAgents/EmailCampaignAgent.js";
import { Contact } from "../models/Contacts.model.js";
import { EmailCampaign } from "../models/EmailCampaign.model.js";

const router = express.Router();

/**
 * ------------------------------------------------------------
 * POST /v1/campaigns/generate
 * Generate a new campaign for one or multiple contacts
 * ------------------------------------------------------------
 */
router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { userIds, campaignName } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one userId must be provided",
      });
    }

    // ✅ Fetch contacts from DB
    const users = await Contact.find({ _id: { $in: userIds } });

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No contacts found for the given userIds",
      });
    }

    const finalCampaignName = campaignName || `Custom Campaign - ${new Date().toISOString()}`;
    const campaignUsers: any[] = [];

    // ✅ Generate AI campaign emails for each user
    for (const userDoc of users) {
      const user = userDoc.toObject(); // Convert from Mongoose Document to plain JS object
      const aiOutput = await generateCampaign(finalCampaignName, user);

      const primaryEmail =
        user.emailAddress?.personal?.[0] ||
        user.emailAddress?.business?.[0] ||
        "unknown@example.com";

      // ✅ Use fullName (not firstName)
      campaignUsers.push({
        userId: user._id,
        fullName: user.fullName,
        email: primaryEmail,
        emails: aiOutput.emails, // keep as key-value map for dynamic types
      });
    }

    // ✅ Save campaign in MongoDB
    const newCampaign = await EmailCampaign.create({
      name: finalCampaignName,
      users: campaignUsers,
    });

    return res.status(201).json({
      success: true,
      message: `Campaign generated successfully for ${campaignUsers.length} user(s)`,
      campaign: newCampaign,
    });
  } catch (error: any) {
    console.error("❌ Error generating AI campaign:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate AI campaign",
      error: error?.message,
    });
  }
});

/**
 * ------------------------------------------------------------
 * GET /v1/campaigns
 * Fetch all campaigns (summary)
 * ------------------------------------------------------------
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const campaigns = await EmailCampaign.find()
      .sort({ createdAt: -1 })
      .select("name createdAt users");

    return res.status(200).json({
      success: true,
      count: campaigns.length,
      campaigns: campaigns.map((c) => ({
        id: c._id,
        name: c.name,
        createdAt: c.createdAt,
        userCount: c.users.length,
      })),
    });
  } catch (error: any) {
    console.error("❌ Error fetching campaigns:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * ------------------------------------------------------------
 * GET /v1/campaigns/:id
 * Fetch one full campaign
 * ------------------------------------------------------------
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const campaign = await EmailCampaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    return res.status(200).json({ success: true, campaign });
  } catch (error: any) {
    console.error("❌ Error fetching campaign:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching campaign",
      error: error?.message,
    });
  }
});

/**
 * ------------------------------------------------------------
 * GET /v1/campaigns/:campaignId/user/:userId
 * Fetch all emails for a specific user in a campaign
 * ------------------------------------------------------------
 */
router.get("/:campaignId/user/:userId", async (req: Request, res: Response) => {
  try {
    const { campaignId, userId } = req.params;

    const campaign = await EmailCampaign.findById(campaignId);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    const user = campaign.users.find((u: any) => u.userId.toString() === userId.toString());
    if (!user)
      return res.status(404).json({ success: false, message: "User not found in campaign" });

    return res.status(200).json({
      success: true,
      userId,
      userName: user.fullName,
      emails: Object.fromEntries(user.emails), // Convert Map → JSON object
    });
  } catch (error: any) {
    console.error("❌ Error fetching user emails:", error);
    return res.status(500).json({ success: false, message: error?.message });
  }
});

/**
 * ------------------------------------------------------------
 * GET /v1/campaigns/:campaignId/user/:userId/email/:type
 * Fetch one specific email type for a user
 * ------------------------------------------------------------
 */
router.get("/:campaignId/user/:userId/email/:type", async (req: Request, res: Response) => {
  try {
    const { campaignId, userId, type } = req.params;

    const campaign = await EmailCampaign.findById(campaignId);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    const user = campaign.users.find((u: any) => u.userId.toString() === userId.toString());
    if (!user)
      return res.status(404).json({ success: false, message: "User not found in campaign" });

    // ✅ Fixed — use Map’s .get() method
    const email = user.emails.get(type);
    if (!email)
      return res.status(404).json({
        success: false,
        message: `Email type '${type}' not found for this user`,
      });

    return res.status(200).json({ success: true, email });
  } catch (error: any) {
    console.error("❌ Error fetching specific email:", error);
    return res.status(500).json({ success: false, message: error?.message });
  }
});

/**
 * ------------------------------------------------------------
 * PUT /v1/campaigns/:campaignId/user/:userId/email/:type
 * Update a specific email for a user
 * ------------------------------------------------------------
 */
router.put("/:campaignId/user/:userId/email/:type", async (req: Request, res: Response) => {
  try {
    const { campaignId, userId, type } = req.params;
    const updates = req.body;

    const campaign = await EmailCampaign.findById(campaignId);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    const user = campaign.users.find((u: any) => u.userId.toString() === userId.toString());
    if (!user)
      return res.status(404).json({ success: false, message: "User not found in campaign" });

    // ✅ Fixed — Map version of update
    const email = user.emails.get(type);
    if (!email)
      return res.status(404).json({ success: false, message: `Email type '${type}' not found` });

    user.emails.set(type, { ...email, ...updates, updatedAt: new Date() });
    await campaign.save();

    return res.status(200).json({
      success: true,
      message: `Email '${type}' updated successfully for ${user.fullName}`,
      email: user.emails.get(type),
    });
  } catch (error: any) {
    console.error("❌ Error updating email:", error);
    return res.status(500).json({ success: false, message: error?.message });
  }
});

/**
 * ------------------------------------------------------------
 * DELETE /v1/campaigns/:id
 * Delete a campaign
 * ------------------------------------------------------------
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await EmailCampaign.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Campaign not found" });

    return res.status(200).json({
      success: true,
      message: "Campaign deleted successfully",
    });
  } catch (error: any) {
    console.error("❌ Error deleting campaign:", error);
    return res.status(500).json({ success: false, message: error?.message });
  }
});

export default router;
