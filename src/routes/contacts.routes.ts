import express from "express";
import {
  getAllContacts,
  getContactById,
  getContactsStats,
  getFilterOptions,
  getContactsBySignalId,
} from "../controllers/contacts.controller.js";

const router = express.Router();

/**
 * @route GET /api/contacts
 * @desc Get all contacts with pagination and filtering
 * @access Public (add auth middleware as needed)
 */
router.get("/", getAllContacts);

/**
 * @route GET /api/contacts/stats
 * @desc Get contact statistics
 * @access Public (add auth middleware as needed)
 */
router.get("/stats", getContactsStats);

/**
 * @route GET /api/contacts/filters/options
 * @desc Get unique filter options for dropdowns
 * @access Public (add auth middleware as needed)
 */
router.get("/filters/options", getFilterOptions);

/**
 * @route GET /api/contacts/by-signal/:signalId
 * @desc Get contacts (people) with the same signalId
 * @access Public (add auth middleware as needed)
 */
router.get("/by-signal/:signalId", getContactsBySignalId);

/**
 * @route GET /api/contacts/:id
 * @desc Get single contact by ID
 * @access Public (add auth middleware as needed)
 */
router.get("/:id", getContactById);

export default router;
