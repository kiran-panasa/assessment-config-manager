import { adminAuth, db } from "../firebase.js";

// Cache user profiles for 5 minutes — avoids 1 Firestore read per API request.
const profileCache = new Map(); // uid → { profile, expiresAt }
const PROFILE_TTL  = 5 * 60 * 1000;

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = await adminAuth.verifyIdToken(header.slice(7));
    const uid = decoded.uid;

    const cached = profileCache.get(uid);
    if (cached && cached.expiresAt > Date.now()) {
      req.uid = uid;
      req.email = (decoded.email || "").toLowerCase();
      req.userProfile = cached.profile;
      return next();
    }

    const snap = await db.collection("users").doc(uid).get();
    if (!snap.exists) return res.status(403).json({ error: "User profile not found" });
    const profile = snap.data();
    if (profile.status !== "active") return res.status(403).json({ error: "Account not active" });

    profileCache.set(uid, { profile, expiresAt: Date.now() + PROFILE_TTL });
    req.uid = uid;
    req.email = (decoded.email || "").toLowerCase();
    req.userProfile = profile;
    next();
  } catch (err) {
    console.error("[auth] verifyIdToken failed:", err.code || err.message);
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
