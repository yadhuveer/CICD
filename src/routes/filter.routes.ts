import { Router, Request, Response } from "express";
import {
  getFilteredContacts,
  // getTitleBasedContacts
} from "../controllers/filter.controller.js";

const router = Router();

router.post("/filter", getFilteredContacts);

// router.get("/Jobtitle/:title", getTitleBasedContacts);................

export default router;
