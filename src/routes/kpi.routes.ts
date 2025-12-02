import { Router } from "express";
import { getKPIStats } from "../controllers/kpi.controller.js";

const router = Router();

router.get("/", getKPIStats);

export default router;
