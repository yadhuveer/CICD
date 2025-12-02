import { Request, Response } from "express";
import crypto from "crypto";

import { sendEmail } from "../services/email.service.js";
import UserInvites from "../models/UserInvites.js";
import { getInvitationEmailTemplate } from "../helpers/email-templates/authTemplates.js";

//-------------------------------------------------
// Create Invite Controller and Send Email
// ------------------------------------------------
export const createInvite = async (req: Request, res: Response) => {
  try {
    const user = req.user; // from Better Auth middleware

    if (!user) {
      return res.status(403).json({ message: "Only admins can send invites." });
    }

    const { name, email, role } = req.body;
    if (!name || !email || !role) {
      return res.status(400).json({ message: "Name, email, and role are required." });
    }

    // Check for duplicate pending invites
    const existing = await UserInvites.findOne({ email, status: "pending" });
    if (existing) {
      return res.status(400).json({ message: "User already has a pending invite." });
    }
    // Check for duplicate accepted invites
    const existingAccepted = await UserInvites.findOne({ email, status: "accepted" });
    if (existingAccepted) {
      return res.status(400).json({ message: "User already has a accepted invite." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // expires in 24h

    const invite = await UserInvites.create({
      name,
      email,
      role,
      token,
      invitedBy: user.name || user.id,
      invitedByEmail: user.email,
      expiresAt,
    });

    const inviteLink = `${process.env.FRONTEND_URL}/signup?token=${token}&invitedEmail=${email}`;
    await sendEmail({
      to: email,
      subject: `You're invited to join as ${role}`,
      // html: `
      //   <p>Hi ${name},</p>
      //   <p>You’ve been invited to join the platform as a <b>${role}</b>.</p>
      //   <p>Click below to accept the invite:</p>
      //   <a href="${inviteLink}">${inviteLink}</a>
      //   <p>This invite will expire in 24 hours.</p>
      // `,
      html: getInvitationEmailTemplate(name, role, inviteLink),
    });

    res.status(201).json({
      success: true,
      message: "Invite created and email sent.",
      invite,
    });
  } catch (err) {
    console.error("Error creating invite:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

// GET /invites
// export const getInvites = async (req: Request, res: Response) => {
//   try {
//     const invites = await UserInvites.find().sort({ createdAt: -1 });
//     res.status(200).json({ success: true, invites });
//   } catch (err) {
//     console.error("Error fetching invites:", err);
//     res.status(500).json({ success: false, message: "Internal server error" });
//   }
// };

export const getInvites = async (req: Request, res: Response) => {
  try {
    const { status } = req.query; //api/invites?status=accepted

    const validStatuses = ["pending", "active", "accepted"];
    const filter: Record<string, string> = {};

    if (status) {
      const normalizedStatus = (status as string).toLowerCase();
      if (!validStatuses.includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status. Use 'pending', 'active', or 'accepted'.",
        });
      }
      filter.status = status as string;
    }

    const invites = await UserInvites.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ success: true, invites });
  } catch (err) {
    console.error("Error fetching invites:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// PATCH /invites/:id
export const changeInviteRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role) return res.status(400).json({ message: "Role is required" });

    const invite = await UserInvites.findByIdAndUpdate(id, { role }, { new: true });

    if (!invite) return res.status(404).json({ message: "Invite not found" });

    res.status(200).json({ success: true, invite });
  } catch (err) {
    console.error("Error updating invite role:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

// DELETE /invites/:id
export const deleteInvite = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await UserInvites.findByIdAndDelete(id);

    if (!deleted) return res.status(404).json({ message: "Invite not found" });

    res.status(200).json({ success: true, message: "Invite deleted" });
  } catch (err) {
    console.error("Error deleting invite:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

// POST /invites/:id/resend
export const resendInvite = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const invite = await UserInvites.findById(id);
    if (!invite) return res.status(404).json({ message: "Invite not found" });

    // Regenerate token & expiry
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

    invite.token = token;
    invite.expiresAt = expiresAt;
    invite.status = "pending";
    await invite.save();

    const inviteLink = `${process.env.FRONTEND_URL}/signup?token=${token}&invitedEmail=${invite.email}`;
    await sendEmail({
      to: invite.email,
      subject: `You're invited to join as ${invite.role}`,
      html: `
        <p>Hi ${invite.name},</p>
        <p>You’ve been invited to join the platform as a <b>${invite.role}</b>.</p>
        <p>Click below to accept the invite:</p>
        <a href="${inviteLink}">${inviteLink}</a>
        <p>This invite will expire in 24 hours.</p>
      `,
    });

    res.status(200).json({ success: true, message: "Invite resent", invite });
  } catch (err) {
    console.error("Error resending invite:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};
