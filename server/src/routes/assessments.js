import { Router } from "express";
import { db } from "../firebase.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const snap = await db.collection("assessments").orderBy("createdAt", "asc").get();
    res.json({ assessments: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/", async (req, res) => {
  try {
    const { skill, level, url, duration } = req.body;
    if (!skill || !level || !url) return res.status(400).json({ error: "skill, level, url required" });
    const ref = await db.collection("assessments").add({
      skill, level, url: url.trim(),
      duration: parseInt(duration) || 0,
      createdAt: new Date().toISOString(),
    });
    res.json({ id: ref.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/:id", async (req, res) => {
  try {
    const { skill, level, url, duration } = req.body;
    await db.collection("assessments").doc(req.params.id).update({
      skill, level, url: url?.trim(), duration: parseInt(duration) || 0,
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/:id", async (req, res) => {
  try {
    await db.collection("assessments").doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
