import express from "express";
// import { createInvite } from "../controllers/invites.controller.js";
import {
  createInvite,
  getInvites,
  changeInviteRole,
  deleteInvite,
  resendInvite,
} from "../controllers/invites.controller.js";

const router = express.Router();

router.post("/", createInvite); // Create invite
router.get("/", getInvites); // List invites
router.patch("/:id", changeInviteRole); // Update role
router.delete("/:id", deleteInvite); // Delete invite
router.post("/:id/resend", resendInvite); // Resend invite email

export default router;
