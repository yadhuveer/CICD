import express from "express";
import { authenticate } from "../middlewares/authMiddleware.js";
const router = express.Router();

router.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

//  as of now using better auth which does not needs api setup as it handles automatically

router.get("/api/protected", authenticate, (req, res) => {
  res.json({ message: "This is a protected route", user: req.user });
});

export default router;
