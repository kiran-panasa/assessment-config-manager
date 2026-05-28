import { Router } from "express";
import { db } from "../firebase.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const snap = await db.collection("roles").get();
    res.json({ roles: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/", requireAdmin, async (req, res) => {
  try {
    const { key, name, pages } = req.body;
    if (!key?.trim() || !name?.trim()) return res.status(400).json({ error: "key and name required" });
    await db.collection("roles").doc(key.trim()).set({
      key: key.trim(), name: name.trim(),
      pages: pages || [],
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const update = {};
    if (req.body.name  !== undefined) update.name  = req.body.name;
    if (req.body.pages !== undefined) update.pages = req.body.pages;
    await db.collection("roles").doc(req.params.id).update(update);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection("roles").doc(req.params.id).get();
    if (snap.exists && snap.data().isSystem) {
      return res.status(400).json({ error: "Cannot delete a system role" });
    }
    await db.collection("roles").doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
