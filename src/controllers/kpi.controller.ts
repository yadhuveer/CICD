import { Request, Response } from "express";
import { KPIService } from "../services/kpi.service.js";

export const getKPIStats = async (req: Request, res: Response) => {
  try {
    const stats = await KPIService.getKPIStats();

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("Error fetching KPI stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch KPI statistics",
      error: error.message,
    });
  }
};
