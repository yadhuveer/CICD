import express from "express";
import {
  naturalLanguageSearch,
  extractEmail,
  generateInsights,
} from "../controllers/megaAI.controller.js";
import { generateSearchQuery } from "../tools/AiAgents/SearchQueryGenerator.agent.js";

const router = express.Router();

// test apis
// router.post("/contacts", getContactoutData);

// main apis to use
router.post("/natural-search", naturalLanguageSearch);

router.get("/extractEmail/:cacheId", extractEmail);

router.get("/generate-insights/:contactId", generateInsights);

//tes api
router.post("/test-queryAgent", async (req, res) => {
  try {
    // get the request body
    const query = req.body.searchQuery;

    // call the generateSearchQuery function
    const result = await generateSearchQuery(query);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
