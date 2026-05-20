/**
 * invite-students.js
 *
 * For each student in the User Mapping table whose invite hasn't been sent yet:
 *   1. Looks up their Topin Assessment ID from the matching Unique Assessment row
 *   2. Calls the Topin invite API with Student UID + Assessment ID
 *   3. Writes invite status ("sent" / "failed") back to Firestore
 *
 * Prerequisites:
 *   - publish-sessions.js must have run first (all sessions need Topin Assessment IDs)
 *   - config.js must have INVITE_API_ENDPOINT, INVITE_API_TOKEN, and buildInvitePayload filled in
 *
 * HOW TO RUN
 *   cd scripts
 *   npm install         (if not already done)
 *   node invite-students.js
 *
 * The script is safe to re-run — it skips students whose status is already "sent".
 * Re-run it to retry any that failed.
 */

import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";
import * as config from "./config.js";

// ── Config validation ─────────────────────────────────────────────────────────

function validateConfig() {
  const checks = [
    [config.INVITE_API_ENDPOINT, "INVITE_API_ENDPOINT"],
    [config.INVITE_API_TOKEN,    "INVITE_API_TOKEN"],
  ];
  const missing = checks
    .filter(([v]) => typeof v !== "string" || v.startsWith("ENTER_"))
    .map(([, k]) => k);

  if (missing.length) {
    console.error("❌ Missing values in config.js:", missing.join(", "));
    console.error("   Fill them in scripts/config.js before running.");
    process.exit(1);
  }
  if (typeof config.buildInvitePayload !== "function") {
    console.error("❌ buildInvitePayload is not a function in config.js.");
    process.exit(1);
  }
}

// ── Firestore ─────────────────────────────────────────────────────────────────

async function fetchData() {
  const app = initializeApp(config.FIREBASE_CONFIG, "invite-script");
  const db  = getFirestore(app);

  const [bookingsSnap, sessionsSnap] = await Promise.all([
    getDocs(collection(db, "bookingRows")),
    getDocs(collection(db, "examSessions")),
  ]);

  const bookings = bookingsSnap.docs.map(d => ({ firestoreId: d.id, db, ...d.data() }));

  // Build a map: sessionKey → { topinAssessmentId }
  const sessionMap = new Map();
  sessionsSnap.docs.forEach(d => {
    const s = d.data();
    if (s.sessionKey && s.topinAssessmentId) {
      sessionMap.set(s.sessionKey, { topinAssessmentId: s.topinAssessmentId });
    }
  });

  return { bookings, sessionMap, db };
}

// ── Invite API call (with retry) ──────────────────────────────────────────────

const MAX_RETRIES   = 3;
const RATE_LIMIT_MS = 200; // 5 requests/second — adjust if Topin has stricter limits

async function callInviteAPI(studentUid, assessmentId, attempt = 1) {
  const payload = config.buildInvitePayload(studentUid, assessmentId);

  const res = await fetch(config.INVITE_API_ENDPOINT, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${config.INVITE_API_TOKEN}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) return res.json().catch(() => ({}));

  const text = await res.text().catch(() => "");
  if (attempt < MAX_RETRIES) {
    const delay = 1000 * attempt;
    console.log(`    ↻ Retry ${attempt}/${MAX_RETRIES - 1} in ${delay}ms...`);
    await new Promise(r => setTimeout(r, delay));
    return callInviteAPI(studentUid, assessmentId, attempt + 1);
  }

  throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  validateConfig();

  console.log("📡 Fetching data from Firestore...");
  const { bookings, sessionMap, db } = await fetchData();

  // Students to invite: not yet sent + have a matching published session
  const toInvite = bookings.filter(b =>
    b.inviteStatus !== "sent" &&
    b.sessionKey &&
    sessionMap.has(b.sessionKey),
  );

  // Students blocked because their session isn't published yet
  const blocked = bookings.filter(b =>
    b.inviteStatus !== "sent" &&
    b.sessionKey &&
    !sessionMap.has(b.sessionKey),
  );

  if (blocked.length > 0) {
    console.warn(
      `\n⚠ ${blocked.length} student(s) skipped — their session has no Topin Assessment ID yet.` +
      `\n  Run publish-sessions.js first, then re-run this script.\n`,
    );
  }

  if (toInvite.length === 0) {
    console.log("✅ All eligible students already invited. Nothing to do.");
    process.exit(0);
  }

  console.log(`\n📬 Sending ${toInvite.length} invite(s)...\n`);

  let sent = 0, failed = 0;

  for (const booking of toInvite) {
    const { firestoreId, studentName, studentUid, sessionKey } = booking;
    const { topinAssessmentId } = sessionMap.get(sessionKey);
    const num = sent + failed + 1;

    process.stdout.write(`[${num}/${toInvite.length}] ${studentName || studentUid} → `);

    try {
      await callInviteAPI(studentUid, topinAssessmentId);

      await updateDoc(doc(db, "bookingRows", firestoreId), {
        inviteStatus: "sent",
        invitedAt:    new Date().toISOString(),
        inviteError:  null,
      });

      console.log("✅ Sent");
      sent++;
    } catch (err) {
      console.log(`❌ Failed: ${err.message}`);

      await updateDoc(doc(db, "bookingRows", firestoreId), {
        inviteStatus: "failed",
        inviteError:   err.message,
      }).catch(() => {});

      failed++;
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`✅ Sent: ${sent}   ❌ Failed: ${failed}`);
  if (failed > 0) {
    console.log(`\nRe-run the script to retry failed invites.`);
    console.log(`Check the Invite column in the app (User Mapping tab).`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("\n💥 Fatal error:", err.message);
  process.exit(1);
});
