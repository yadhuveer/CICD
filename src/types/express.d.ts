// import type { User } from "better-auth";

// declare global {
//   namespace Express {
//     interface Request {
//       user?: User;
//     }
//   }
// }

// export {};

// src/types/express.d.ts
import "express";
import { User } from "./user.js";

declare global {
  namespace Express {
    // interface User {
    //   id: string;
    //   email: string;
    //   emailVerified: boolean;
    //   name: string;
    //   image?: string | null;
    //   role: "user" | "admin";
    //   createdAt: Date;
    //   updatedAt: Date;
    // }

    interface Request {
      user?: User;
    }
  }
}

export {};
