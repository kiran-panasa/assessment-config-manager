import { Router } from "express";
import { db } from "../firebase.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const { role } = req.userProfile;
    const isAdmin = role === "admin" || role === "super-admin";
    const snap = isAdmin
      ? await db.collection("scheduledInterviews").get()
      : await db.collection("scheduledInterviews").where("panelistEmail", "==", req.email).get();

    const interviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    interviews.sort((a, b) =>
      (a.interviewDate || "").localeCompare(b.interviewDate || "") ||
      (a.interviewTime || "").localeCompare(b.interviewTime || ""),
    );
    res.json({ interviews });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/bulk", requireAdmin, async (req, res) => {
  try {
    const { rows } = req.body;
    const now = new Date().toISOString();
    for (let i = 0; i < rows.length; i += 499) {
      const batch = db.batch();
      for (const row of rows.slice(i, i + 499)) {
        batch.set(db.collection("scheduledInterviews").doc(), { ...row, uploadedAt: now });
      }
      await batch.commit();
    }
    res.json({ ok: true, count: rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await db.collection("scheduledInterviews").doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
