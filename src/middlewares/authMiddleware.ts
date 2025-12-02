import { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../config/auth.js";
import logger from "../utils/logger.js";

// --------------------------------------
// AUTHENTICATE: attach user from session
// --------------------------------------
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (session?.user) {
      req.user = {
        ...session.user,
        role: (session.user as { role?: "user" | "admin" }).role ?? "user",
      };
      return next();
    }

    res.status(401).json({ message: "Unauthorized" });
  } catch (error) {
    logger.error("Authentication error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// -----------------------------------------
// AUTHORIZE: restrict routes based on role
// -----------------------------------------
export const authorize = (...allowedRoles: ("user" | "admin")[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized: no user found" });
      return;
    }

    const userRole = req.user.role ?? "user";

    if (allowedRoles.includes(userRole)) {
      return next(); // ✅ authorized
    }

    res.status(403).json({
      message: `Forbidden: you are not authorized to access this resource.`,
    });
  };
};
