import express from "express";
import LifeInsuranceLiquidityService from "../services/scraping/nonLiquidity/lifeInsurence.service.js";

const router = express.Router();

function getService() {
  return new LifeInsuranceLiquidityService(process.env.FIRECRAWL_API_KEY || "");
}
router.get("/run", async (req, res) => {
  try {
    const svc = getService();

    const totalLimit = parseInt((req.query.totalLimit as string) || "20", 10);
    const perQuery = parseInt((req.query.perQuery as string) || "2", 10);
    const maxQueries = req.query.maxQueries
      ? parseInt(req.query.maxQueries as string, 10)
      : undefined;
    const concurrency = parseInt((req.query.concurrency as string) || "3", 10);

    const results = await svc.runOnce({
      totalLimit,
      perQuery,
      maxQueries,
      concurrency,
    });

    return res.json({
      success: true,
      urlCount: results.length,
      results,
    });
  } catch (err) {
    console.error("LifeInsurance /run error:", err);
    return res.status(500).json({ success: false, error: String(err) });
  }
});

/**
 * Manual single-URL test
 * No DB saving — returns parsed result only
 */
router.post("/process", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, error: "URL is required" });
    }

    const svc = getService();
    const result = await svc.processUrl(url);

    return res.json({
      success: true,
      result,
    });
  } catch (err) {
    console.error("LifeInsurance /process error:", err);
    return res.status(500).json({ success: false, error: String(err) });
  }
});

export default router;
