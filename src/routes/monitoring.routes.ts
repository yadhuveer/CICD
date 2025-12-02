/**
 * Monitoring Routes
 * API endpoints for signal statistics and monitoring
 */

import { Router, Request, Response } from "express";
import { getDuplicateStats } from "../utils/deduplication.util.js";
import { getQualityStats } from "../utils/signalQuality.util.js";
import { SignalNew } from "../models/newSignal.model.js";

const router = Router();

/**
 * GET /api/monitoring/status
 * Get system status (simplified after scheduler removal)
 */
router.get("/status", async (req: Request, res: Response) => {
  try {
    const totalSignals = await SignalNew.countDocuments();
    const maSignals = await SignalNew.countDocuments({ filingType: "ma-event" });

    res.json({
      success: true,
      data: {
        systemStatus: "active",
        totalSignals,
        maSignals,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/monitoring/stats
 * Get statistics about monitored signals
 */
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const timeframeDays = parseInt(req.query.days as string) || 7;

    const startDate = new Date(Date.now() - timeframeDays * 24 * 60 * 60 * 1000);
    const signals = await SignalNew.find({
      createdAt: { $gte: startDate },
    }).select("signalType companyName filingDate createdAt maEventData location");

    const signalTypeCounts: Record<string, number> = {};
    signals.forEach((signal) => {
      const signalType = signal.signalType || "unknown";
      signalTypeCounts[signalType] = (signalTypeCounts[signalType] || 0) + 1;
    });

    const dailyCounts: Record<string, number> = {};
    signals.forEach((signal) => {
      const createdAt = (signal as any).createdAt;
      if (createdAt) {
        const date = new Date(createdAt).toISOString().split("T")[0];
        dailyCounts[date] = (dailyCounts[date] || 0) + 1;
      }
    });

    const qualityStats = getQualityStats(signals);

    // Get duplicate
    const duplicateStats = await getDuplicateStats(timeframeDays);

    res.json({
      success: true,
      data: {
        timeframeDays,
        totalSignals: signals.length,
        signalTypeCounts,
        dailyCounts,
        qualityStats,
        duplicateStats,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/monitoring/recent
 * Get recent signals from the last 24 hours
 */
router.get("/recent", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentSignals = await SignalNew.find({
      createdAt: { $gte: oneDayAgo },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("signalType companyName fullName location filingDate createdAt insights");

    res.json({
      success: true,
      data: {
        count: recentSignals.length,
        signals: recentSignals,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/monitoring/health
 * Health check endpoint
 */
router.get("/health", async (req: Request, res: Response) => {
  try {
    // Simple health check - verify database connection
    const dbHealthy = await SignalNew.countDocuments()
      .then(() => true)
      .catch(() => false);

    res.json({
      success: true,
      healthy: dbHealthy,
      data: {
        database: dbHealthy ? "connected" : "disconnected",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      healthy: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/monitoring/signals/by-category
 * Get signals grouped by category
 */
router.get("/signals/by-category", async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const categoryBreakdown = await SignalNew.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: "$signalType",
          count: { $sum: 1 },
          latestDate: { $max: "$filingDate" },
        },
      },
      {
        $sort: { count: -1 },
      },
    ]);

    res.json({
      success: true,
      data: {
        timeframeDays: days,
        categories: categoryBreakdown,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
