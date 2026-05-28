import { Router } from "express";
import { db } from "../firebase.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

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

// Batch-generate TinyURLs for published sessions that don't have one yet
router.post("/tiny-urls", requireAdmin, async (req, res) => {
  const token = process.env.TINYURL_API_TOKEN;
  if (!token) return res.status(500).json({ error: "TINYURL_API_TOKEN not configured on server" });

  try {
    const snap = await db.collection("examSessions")
      .where("publishStatus", "==", "published")
      .get();

    const missing = snap.docs.filter(d => !d.data().tinyUrl && d.data().assessmentLink);

    let updated = 0, failed = 0;
    for (const doc of missing) {
      let userUrl = doc.data().assessmentLink;
      try { const u = new URL(userUrl); u.searchParams.delete("a_t"); userUrl = u.toString(); } catch {}
      try {
        const r = await fetch("https://api.tinyurl.com/create", {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: userUrl, domain: "tinyurl.com" }),
        });
        const data = await r.json();
        const tinyUrl = data?.data?.tiny_url;
        if (tinyUrl) { await doc.ref.update({ tinyUrl }); updated++; }
        else failed++;
      } catch { failed++; }
      await new Promise(r => setTimeout(r, 150));
    }

    res.json({ ok: true, updated, failed, skipped: snap.docs.length - missing.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
