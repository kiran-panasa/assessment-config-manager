// ─────────────────────────────────────────────────────────────────────────────
// HOW TO SET UP
// 1. Copy this file:  cp config.example.js config.js
// 2. Fill in your actual values in config.js
// 3. config.js is gitignored — it will never be committed
// ─────────────────────────────────────────────────────────────────────────────

// ── Topin login credentials ──────────────────────────────────────────────────
export const TOPIN_LOGIN_URL = "https://topin.tech";        // adjust if needed
export const TOPIN_MOBILE    = "ENTER_YOUR_MOBILE_NUMBER";  // e.g. "9876543210"
export const TOPIN_OTP       = "ENTER_YOUR_FIXED_OTP";      // e.g. "123456"

// ── Topin Invite API ─────────────────────────────────────────────────────────
export const INVITE_API_ENDPOINT = "ENTER_INVITE_API_ENDPOINT";
export const INVITE_API_TOKEN    = "ENTER_YOUR_API_TOKEN";

// Edit this function to match the exact payload the Topin invite API expects.
// Parameters:
//   studentUid   — from Student UID column in User Mapping table
//   assessmentId — the org_id UUID from the published Topin assessment URL
export function buildInvitePayload(studentUid, assessmentId) {
  return {
    // TODO: replace field names with the actual ones from Topin API docs
    student_uid:   studentUid,
    assessment_id: assessmentId,
  };
}

// ── Firebase config (same as src/firebase.js — do not change) ────────────────
export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDCKw2EE9RJ1-oPo1sdbgsU47ra3LbbpQc",
  authDomain:        "assessment-config-manager.firebaseapp.com",
  projectId:         "assessment-config-manager",
  storageBucket:     "assessment-config-manager.firebasestorage.app",
  messagingSenderId: "567558097768",
  appId:             "1:567558097768:web:aad46b095e48359fdf24dd",
};
