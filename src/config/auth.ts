import { betterAuth, Auth } from "better-auth";
import { MongoClient, Db } from "mongodb";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import * as dotenv from "dotenv";
import { sendEmail } from "../services/email.service.js";
import {
  getEmailVerificationTemplate,
  getPasswordResetSuccessEmail,
  resetPassWordTemplate,
} from "../helpers/email-templates/authTemplates.js";
import UserInvites from "../models/UserInvites.js";
import { inviteAfterHook } from "../helpers/betterAuthHook.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI!;
const client = new MongoClient(MONGO_URI);

await client.connect();
const db: Db = client.db();
const isProduction = process.env.NODE_ENV === "production";

const baseURL = isProduction
  ? "https://longwall.trao.ai"
  : process.env.BETTER_AUTH_URL || "http://localhost:5001";

const frontendURL = isProduction
  ? process.env.FRONTEND_URL || "https://longwall.trao.ai"
  : "http://localhost:3000";

const getTrustedOrigins = (): string[] => {
  if (process.env.FRONTEND_URL) {
    return process.env.FRONTEND_URL.split(",").map((url) => url.trim());
  }

  return isProduction
    ? ["https://longwall.trao.ai"]
    : ["https://longwall.trao.ai", "http://localhost:3000", "http://localhost:3001"];
};

const trustedOrigins = getTrustedOrigins();

// console.log("trusted Origins", trustedOrigins);

export const auth: Auth = betterAuth({
  //give database connection to store users in provided local database (not on better auth server)
  baseURL,
  database: mongodbAdapter(db, { client }),

  trustedOrigins,

  // extend user schema with additional fields
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
      },
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true, // enforce email verified before login
    autoSignIn: true,

    sendResetPassword: async ({ user, url, token }, request) => {
      // url is the full link the user clicks which contains token
      const resetLink = `${frontendURL}/reset-password?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: "Reset your password",
        text: `Click here to reset your password: ${url}`,
        // html: `<p>Click the link to reset your password:</p><a href="${url}">${url}</a>`,
        html: resetPassWordTemplate(resetLink),
      });
    },

    onPasswordReset: async ({ user }, request) => {
      // optional hook after password successfully reset
      console.log("Password reset for user:", user.email);
      await sendEmail({
        to: user.email,
        subject: "Your password has been changed",
        text: `Your password has been successfully changed.`,
        html: getPasswordResetSuccessEmail(user.email, frontendURL),
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true, // automatically send verification email when user signs up
    autoSignInAfterVerification: true, // after verifying, auto sign
    sendVerificationEmail: async ({ user, url, token }, request) => {
      // url is the backend url sent to email for verification. it will start withe better auth domain set in env
      // Construct the verification link using frontend URL and the token
      const verificationLink = `${frontendURL}/verify-email?token=${token}`;

      await sendEmail({
        to: user.email,
        subject: "Verify your email",
        text: `Click to verify your email: ${verificationLink}`,
        html: getEmailVerificationTemplate(verificationLink), // Pass the frontend URL, not backend
      });
    },
  },

  socialProviders: {
    // Enable Google OAuth
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
    // Enable Microsoft OAuth
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID as string,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET as string,
      // Optional
      tenantId: "common", // Use "common" for multi-tenant applications
      authority: "https://login.microsoftonline.com", // Authentication authority URL
      prompt: "select_account", // Forces account selection
    },
  },

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60 * 24 * 7,
    },
  },

  cookies: {
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction,
    httpOnly: true,
    domain: isProduction ? ".trao.ai" : undefined,
    path: "/",
  },

  advanced: {
    useSecureCookies: isProduction,
    csrfProtection: {
      enabled: isProduction,
      origins: trustedOrigins,
    },
    crossSubDomainCookies: {
      enabled: isProduction,
      domain: isProduction ? ".trao.ai" : undefined,
    },
  },

  // To manage after effects such as processing invites
  hooks: {
    after: inviteAfterHook(db),
  },
});
