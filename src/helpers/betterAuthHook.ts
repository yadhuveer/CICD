import { createAuthMiddleware } from "better-auth/api";
import UserInvites from "../models/UserInvites.js";
import { Db, ObjectId } from "mongodb";

export const inviteAfterHook = (db: Db) =>
  createAuthMiddleware(async (ctx) => {
    try {
      if (ctx.path !== "/sign-up/email" || ctx.method !== "POST") return;

      const body = ctx.body as { email: string; password: string; inviteToken?: string };
      if (!body?.inviteToken) return;

      const invite = await UserInvites.findOne({ token: body.inviteToken });
      //   console.log("invite", invite);
      if (!invite) return;

      if (invite.status !== "pending") return;
      if (invite.email.toLowerCase() !== body.email.toLowerCase()) return;

      // Update the user's role directly in the users collection
      await db
        .collection("user")
        .updateOne({ email: body.email.toLowerCase() }, { $set: { role: invite.role } });

      // Mark invite as accepted
      await UserInvites.updateOne({ token: body.inviteToken }, { $set: { status: "accepted" } });

      console.log("✅ Role assigned and invite accepted successfully");
    } catch (error) {
      console.error("❌ Invite after-hook error:", error);
    }
  });
