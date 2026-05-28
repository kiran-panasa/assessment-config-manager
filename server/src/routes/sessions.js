import { Router } from "express";
import { db } from "../firebase.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

function cutoffDate() {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

router.get("/", async (req, res) => {
  try {
    const snap = await db.collection("examSessions")
      .where("dateOfAssessment", ">=", cutoffDate())
      .orderBy("dateOfAssessment", "asc")
      .get();
    res.json({ sessions: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/:id", async (req, res) => {
  try {
    await db.collection("examSessions").doc(req.params.id).update(req.body);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/:id", async (req, res) => {
  try {
    await db.collection("examSessions").doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/bulk-delete", async (req, res) => {
  try {
    const { ids } = req.body;
    for (let i = 0; i < ids.length; i += 499) {
      const batch = db.batch();
      for (const id of ids.slice(i, i + 499)) {
        batch.delete(db.collection("examSessions").doc(id));
      }
      await batch.commit();
    }
    res.json({ ok: true, count: ids.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
