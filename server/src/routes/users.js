import { Router } from "express";
import { adminAuth, db } from "../firebase.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();

const BOOTSTRAP_EMAIL = "kiran.p@nxtwave.tech";

// GET /api/users/me — current user profile + allowed pages (no profile-existence check yet)
router.get("/me", requireAuth, async (req, res) => {
  try {
    let pages = [];
    const { role } = req.userProfile;
    if (role) {
      const roleSnap = await db.collection("roles").doc(role).get();
      if (roleSnap.exists) pages = roleSnap.data().pages || [];
    }
    res.json({ profile: { id: req.uid, ...req.userProfile }, pages });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/users — create profile after Firebase Auth signup
// Does NOT use requireAuth middleware because user profile may not exist yet.
router.post("/", async (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = await adminAuth.verifyIdToken(header.slice(7));
    const { displayName, email } = req.body;

    const existing = await db.collection("users").doc(decoded.uid).get();
    if (existing.exists) return res.json({ created: false, status: existing.data().status });

    const isBootstrap = (decoded.email || "").toLowerCase() === BOOTSTRAP_EMAIL.toLowerCase();
    await db.collection("users").doc(decoded.uid).set({
      email: decoded.email || email || "",
      displayName: displayName || decoded.name || (decoded.email || "").split("@")[0],
      role: isBootstrap ? "admin" : null,
      status: isBootstrap ? "active" : "pending",
      createdAt: new Date().toISOString(),
    });
    res.json({ created: true, status: isBootstrap ? "active" : "pending" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/users — list all users (admin)
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection("users").get();
    res.json({ users: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/users/:id — update role/status (admin)
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const update = {};
    const allowed = ["role", "status", "displayName"];
    for (const key of allowed) { if (req.body[key] !== undefined) update[key] = req.body[key]; }
    if (req.body.status === "active" && !req.body.approvedAt) {
      update.approvedAt = new Date().toISOString();
      update.approvedBy = req.email;
    }
    await db.collection("users").doc(req.params.id).update(update);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/users/:id (admin)
router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.collection("users").doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
