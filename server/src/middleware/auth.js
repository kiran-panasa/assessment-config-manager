import { adminAuth, db } from "../firebase.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = await adminAuth.verifyIdToken(header.slice(7));
    const snap = await db.collection("users").doc(decoded.uid).get();
    if (!snap.exists) return res.status(403).json({ error: "User profile not found" });
    const profile = snap.data();
    if (profile.status !== "active") return res.status(403).json({ error: "Account not active" });
    req.uid = decoded.uid;
    req.email = (decoded.email || "").toLowerCase();
    req.userProfile = profile;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(req, res, next) {
  const { role } = req.userProfile;
  if (role !== "admin" && role !== "super-admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
