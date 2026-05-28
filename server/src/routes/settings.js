import { Router } from "express";
import { db } from "../firebase.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const snap = await db.collection("settings").doc("automation").get();
    res.json(snap.exists ? snap.data() : {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/", requireAdmin, async (req, res) => {
  try {
    await db.collection("settings").doc("automation").set(req.body, { merge: true });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
