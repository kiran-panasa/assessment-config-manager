import { Router } from "express";
import { db } from "../firebase.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.post("/", async (req, res) => {
  try {
    await db.collection("logs").add({
      ...req.body,
      uid: req.uid,
      timestamp: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
