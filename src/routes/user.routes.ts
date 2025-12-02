import express from "express";
import { getUserProfile, updateUserProfile } from "../controllers/user.controller.js";
import { authorize } from "../middlewares/authMiddleware.js";
import { createInvite } from "../controllers/invites.controller.js";

const router = express.Router();

router.get("/profile", getUserProfile);
router.patch("/profile", updateUserProfile);

router.post("/send-invite", createInvite);

// test route for authorization
// works only if user is admin
// router.post("/test-auth", authorize("admin"), (req, res) => {
//   res.status(200).json({ message: "Authorized access to admin route" });
// });
export default router;
