import httpStatus from "http-status";
import express from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import inviteRoutes from "./invite.routes.js";
import testRoutes from "./test.routes.js";
import campaignRoutes from "./campaign.routes.js";
import pipelineRoutes from "./pipeline.routes.js";
import signalsRoutes from "./signals.routes.js";
import contactsRoutes from "./contacts.routes.js";
import companyRoutes from "./company.routes.js";
import monitoringRoutes from "./monitoring.routes.js";
import institutionalRoutes from "./institutional.routes.js";
import institutionalV2Routes from "./institutional-v2.routes.js";
import enrichmentRoutes from "./enrichment.routes.js";
import fullPipelineRoutes from "./fullPipelineProcess.routes.js";
import lifeInsuranceLiquidityRoutes from "./lifeinc.routes.js";
import kpiRoutes from "./kpi.routes.js";
import contactWrapper from "./megaAI.routes.js";
//if anyone see remove
import { authenticate } from "../middlewares/authMiddleware.js";
import filterRoutes from "./filter.routes.js";
import insightsRoutes from "./insights.routes.js";

const router = express.Router();

router.get("/health", (req, res) => {
  res.status(httpStatus.OK).json({ status: "OK" });
});

// fine
router.use("/auth", authRoutes);
router.use("/user", authenticate, userRoutes);
router.use("/invites", authenticate, inviteRoutes);

// change it later to automated queue system
router.use("/pipeline", pipelineRoutes);

// Signals Routes (Signals with enriched contacts)
router.use("/signals", signalsRoutes);

// Contacts Routes (Direct access to contacts collection)
router.use("/contacts", contactsRoutes);

// Company Routes (Companies created from Schedule 13D/G signals)
router.use("/companies", companyRoutes);

// Monitoring Routes (M&A monitoring system dashboard and controls)
router.use("/monitoring", monitoringRoutes);

// Institutional Routes (13F institutional filers and holdings)
router.use("/institutional", institutionalRoutes);

// Institutional V2 Routes (New 13F pipeline with improved architecture)
router.use("/institutional-v2", institutionalV2Routes);

// campaign Routes
router.use("/campaigns", campaignRoutes);

//Testing Routes
router.use("/test", testRoutes);

// Signal to Contact Enrichment Pipeline
router.use("/enrichment", enrichmentRoutes);

// Insights Analysis Routes (AI-powered insights from ContactOut cache data)
router.use("/insights", insightsRoutes);

//filter Routes
router.use("/filters", filterRoutes);

// Remove after test
router.use("/life-insurance-liquidity", lifeInsuranceLiquidityRoutes);

// kpi Routes
router.use("/kpi", kpiRoutes);

//remove after test
/**
 * This section aggregates all steps of the full pipeline process
 * scrape signal -> enrich contacts
 */

router.use("/full-pipeline", fullPipelineRoutes);

//get contacts from contatout API
router.use("/mega-ai", contactWrapper);

export default router;
