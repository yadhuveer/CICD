import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import mongoSanitize from "express-mongo-sanitize";
import compression from "compression";
import { toNodeHandler } from "better-auth/node";

// Local Imports
import routes from "./routes/index.js";
import { auth } from "./config/auth.js";

const app: Application = express();

// Environment
const isProduction = process.env.NODE_ENV === "production";

// Get trusted origins
// enable cors

let allowedOrigins: string[] = [];

if (process.env.CORS_ALLOWED) {
  try {
    allowedOrigins = JSON.parse(process.env.CORS_ALLOWED);
  } catch {
    allowedOrigins = [process.env.CORS_ALLOWED];
  }
}

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: isProduction ? undefined : false,
    crossOriginEmbedderPolicy: false, // Required for some OAuth flows
  }),
);

// Cookie parser
app.use(cookieParser());

// Compression
app.use(compression());

//  BETTER AUTH HANDLER - MUST BE BEFORE JSON PARSERS
// app.all("/api/auth/*splat", toNodeHandler(auth));
app.all("/api/auth/{*any}", toNodeHandler(auth));

// Parse JSON request body
app.use(express.json());

// Parse urlencoded request body
app.use(express.urlencoded({ extended: true }));

// Sanitize request data
// app.use(mongoSanitize());

// Root route
app.use("/v1", routes);

app.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "Welcome to the LongWall API",
  });
});

// Health check endpoint
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    auth: "Better Auth enabled",
  });
});

export default app;
