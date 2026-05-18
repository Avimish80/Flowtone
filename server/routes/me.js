import { Router } from "express";
import { requireAuthenticatedUser } from "../lib/auth.js";
import { getAccessStateForUser } from "../lib/access.js";

const router = Router();

router.get("/access", requireAuthenticatedUser, async (req, res) => {
  try {
    const access = await getAccessStateForUser(req.flowtoneUser);
    res.json(access);
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load access state" });
  }
});

export default router;

