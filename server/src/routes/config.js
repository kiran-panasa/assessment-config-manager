import { Router } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firebase.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const snap = await db.collection("config").doc("main").get();
    const data = snap.exists ? snap.data() : {};
    res.json({ skills: data.skills || [], levels: data.levels || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/skills", requireAdmin, async (req, res) => {
  try {
    const { skill } = req.body;
    if (!skill?.trim()) return res.status(400).json({ error: "skill required" });
    await db.collection("config").doc("main").update({ skills: FieldValue.arrayUnion(skill.trim()) });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/skills/:skill", requireAdmin, async (req, res) => {
  try {
    await db.collection("config").doc("main").update({
      skills: FieldValue.arrayRemove(decodeURIComponent(req.params.skill)),
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/levels", requireAdmin, async (req, res) => {
  try {
    const { level } = req.body;
    if (!level?.trim()) return res.status(400).json({ error: "level required" });
    await db.collection("config").doc("main").update({ levels: FieldValue.arrayUnion(level.trim().toUpperCase()) });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/levels/:level", requireAdmin, async (req, res) => {
  try {
    await db.collection("config").doc("main").update({
      levels: FieldValue.arrayRemove(decodeURIComponent(req.params.level)),
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
