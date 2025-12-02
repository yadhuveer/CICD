import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
import { Company } from "../models/Company.model.js";
import { Contact } from "../models/Contacts.model.js";
import { Signal } from "../models/Signals.model.js";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/companies
 * Get all companies with pagination
 */
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    const [companies, total] = await Promise.all([
      Company.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("contacts", "fullName emailAddress occupationTitle")
        .populate("signals", "signalType filingDate"),
      Company.countDocuments(),
    ]);

    return res.json({
      success: true,
      data: {
        companies,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error("❌ Error fetching companies:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/companies/:id
 * Get a single company by ID with all related data
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const company = await Company.findById(id)
      .populate("contacts", "fullName emailAddress occupationTitle linkedinUrl companies")
      .populate("keyPeople", "fullName emailAddress occupationTitle")
      .populate("signals", "signalType filingDate fullName companyTicker");

    if (!company) {
      return res.status(404).json({
        success: false,
        error: "Company not found",
      });
    }

    return res.json({
      success: true,
      data: company,
    });
  } catch (error: any) {
    console.error("❌ Error fetching company:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/companies/:id/contacts
 * Get all contacts associated with a company
 */
router.get("/:id/contacts", async (req, res) => {
  try {
    const { id } = req.params;

    const company = await Company.findById(id);
    if (!company) {
      return res.status(404).json({
        success: false,
        error: "Company not found",
      });
    }

    const contacts = await Contact.find({
      companies: id,
    }).populate("signals", "signalType filingDate");

    return res.json({
      success: true,
      data: {
        companyName: company.companyName,
        contactCount: contacts.length,
        contacts,
      },
    });
  } catch (error: any) {
    console.error("❌ Error fetching company contacts:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/companies/:id/signals
 * Get all signals associated with a company
 */
router.get("/:id/signals", async (req, res) => {
  try {
    const { id } = req.params;

    const company = await Company.findById(id);
    if (!company) {
      return res.status(404).json({
        success: false,
        error: "Company not found",
      });
    }

    const signals = await Signal.find({
      companyId: id,
    }).sort({ filingDate: -1 });

    return res.json({
      success: true,
      data: {
        companyName: company.companyName,
        signalCount: signals.length,
        signals,
      },
    });
  } catch (error: any) {
    console.error("❌ Error fetching company signals:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/companies/stats
 * Get statistics about companies
 */
router.get("/stats", async (req, res) => {
  try {
    const [totalCompanies, companiesWithContacts, recentCompanies] = await Promise.all([
      Company.countDocuments(),
      Company.countDocuments({ contacts: { $exists: true, $ne: [] } }),
      Company.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select("name stockSymbol createdAt contacts signals"),
    ]);

    return res.json({
      success: true,
      data: {
        totalCompanies,
        companiesWithContacts,
        companiesWithoutContacts: totalCompanies - companiesWithContacts,
        recentCompanies,
      },
    });
  } catch (error: any) {
    console.error("❌ Error fetching company stats:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/companies/search
 * Search companies by name or ticker
 */
router.get("/search", async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== "string") {
      return res.status(400).json({
        success: false,
        error: "Search query 'q' is required",
      });
    }

    const companies = await Company.find({
      $or: [
        { name: { $regex: q, $options: "i" } },
        { stockSymbol: { $regex: q, $options: "i" } },
        { cik: q },
      ],
    })
      .limit(20)
      .populate("contacts", "fullName")
      .sort({ name: 1 });

    return res.json({
      success: true,
      data: {
        query: q,
        count: companies.length,
        companies,
      },
    });
  } catch (error: any) {
    console.error("❌ Error searching companies:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
