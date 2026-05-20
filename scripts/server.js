/**
 * server.js
 *
 * Local Express server that the "Create Assessments" page talks to.
 * Runs Playwright (publish) and the invite API call loop, streaming
 * real-time progress back to the browser via Server-Sent Events.
 *
 * HOW TO RUN
 *   cd scripts
 *   npm install       (adds express, cors, playwright, firebase)
 *   node server.js
 *
 * Then open the app and go to "Create Assessments".
 */

import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";

// ── Firebase ──────────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDCKw2EE9RJ1-oPo1sdbgsU47ra3LbbpQc",
  authDomain:        "assessment-config-manager.firebaseapp.com",
  projectId:         "assessment-config-manager",
  storageBucket:     "assessment-config-manager.firebasestorage.app",
  messagingSenderId: "567558097768",
  appId:             "1:567558097768:web:aad46b095e48359fdf24dd",
};

const fbApp = initializeApp(FIREBASE_CONFIG, "automation-server");
const db    = getFirestore(fbApp);

// ── Express setup ─────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// ── SSE broadcast ─────────────────────────────────────────────────────────────

const clients = new Set();

function broadcast(type, message, extra = {}) {
  const data = JSON.stringify({ type, message, ts: Date.now(), ...extra });
  for (const res of clients) res.write(`data: ${data}\n\n`);
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

app.post("/publish", async (req, res) => {
  const { mobile, otp, date } = req.body;
  if (!mobile || !otp) return res.status(400).json({ error: "mobile and otp are required" });
  res.json({ started: true });
  // Small delay so the browser's EventSource connection is established first
  await new Promise(r => setTimeout(r, 400));
  runPublish(mobile, otp, date || null).catch(err =>
    broadcast("error", `Fatal error: ${err.message}`),
  );
});

app.post("/invite", async (req, res) => {
  const { apiEndpoint, apiToken, uidField, assessIdField, date } = req.body;
  if (!apiEndpoint || !apiToken) return res.status(400).json({ error: "apiEndpoint and apiToken are required" });
  res.json({ started: true });
  await new Promise(r => setTimeout(r, 400));
  runInvite(apiEndpoint, apiToken, uidField || "student_uid", assessIdField || "assessment_id", date || null)
    .catch(err => broadcast("error", `Fatal error: ${err.message}`));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function to24Hr(timeStr) {
  const m = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return timeStr;
  let h = parseInt(m[1]);
  const mins = m[2], period = m[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${mins}`;
}

// ── Publish: Firestore fetch ──────────────────────────────────────────────────

async function fetchPublishData(date) {
  const [assessmentsSnap, sessionsSnap] = await Promise.all([
    getDocs(collection(db, "assessments")),
    getDocs(collection(db, "examSessions")),
  ]);

  const assessments = assessmentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  let sessions = sessionsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.publishStatus !== "published");

  if (date) sessions = sessions.filter(s => s.dateOfAssessment === date);

  return { assessments, sessions };
}

// ── Publish: Topin browser login ──────────────────────────────────────────────

async function loginToTopin(page, mobile, otp) {
  broadcast("info", "Navigating to Topin login…");
  await page.goto("https://topin.tech", { waitUntil: "networkidle" });

  // TODO: adjust selectors to match the actual Topin login page
  await page.waitForSelector(
    'input[type="tel"], input[name*="mobile" i], input[placeholder*="mobile" i], input[placeholder*="phone" i]',
    { timeout: 15000 },
  );
  await page.fill(
    'input[type="tel"], input[name*="mobile" i], input[placeholder*="mobile" i], input[placeholder*="phone" i]',
    mobile,
  );

  await page.click(
    'button:has-text("Send OTP"), button:has-text("Get OTP"), button:has-text("Request OTP"), button:has-text("Continue")',
  );
  await page.waitForTimeout(2000);

  await page.waitForSelector(
    'input[name*="otp" i], input[placeholder*="otp" i], input[placeholder*="code" i]',
    { timeout: 15000 },
  );
  await page.fill(
    'input[name*="otp" i], input[placeholder*="otp" i], input[placeholder*="code" i]',
    otp,
  );

  await page.click(
    'button:has-text("Verify"), button:has-text("Login"), button:has-text("Submit"), button[type="submit"]',
  );
  await page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {});

  broadcast("success", "Logged in to Topin");
}

// ── Publish: clone, fill, publish one session ─────────────────────────────────

async function publishOneSession(page, session, assessments) {
  const config = assessments.find(
    a => a.skill === session.skill && a.level === `L${session.level}`,
  );
  if (!config?.url) throw new Error(`No config URL for ${session.skill} - L${session.level}`);

  broadcast("info", `  Opening config URL…`);
  await page.goto(config.url, { waitUntil: "networkidle" });

  // TODO: adjust Clone selector to match actual Topin UI
  await page.click(
    'button:has-text("Clone"), button:has-text("Duplicate"), a:has-text("Clone"), [data-action="clone"]',
  );
  await page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1500);
  broadcast("info", "  Cloned");

  // TODO: adjust field selectors if needed
  await page.fill(
    'input[name*="title" i], input[name*="name" i], input[placeholder*="title" i], input[placeholder*="assessment name" i]',
    session.assessmentTitle,
  );
  await page.fill('input[type="date"], input[name*="date" i]', session.dateOfAssessment);
  await page.fill('input[name*="start" i], input[placeholder*="start time" i]', to24Hr(session.startTimeSlot));
  await page.fill('input[name*="end" i], input[placeholder*="end time" i]',     to24Hr(session.endTimeSlot));
  await page.fill('input[name*="pin" i], input[name*="exit" i], input[placeholder*="pin" i]', session.exitPin);

  await page.click(
    'button:has-text("Publish"), button:has-text("Save & Publish"), button[type="submit"]:has-text("Publish")',
  );
  await page.waitForTimeout(2500);
  broadcast("info", "  Published — extracting Assessment ID…");

  // TODO: adjust selector to find the Assessment Link element
  const linkEl = await page.$(
    'a[href*="org_id"], input[value*="org_id"], [class*="assessment-link"] a, [class*="share"] a[href*="assessment.topin"]',
  );
  if (!linkEl) throw new Error("Could not find Assessment Link on page. Adjust the selector in server.js.");

  const href = (await linkEl.getAttribute("href")) || (await linkEl.getAttribute("value")) || "";
  const assessmentId = new URL(href).searchParams.get("org_id");
  if (!assessmentId) throw new Error(`Could not extract org_id from: ${href}`);

  return assessmentId;
}

// ── Publish: main loop ────────────────────────────────────────────────────────

async function runPublish(mobile, otp, date) {
  broadcast("info", "Fetching sessions from Firestore…");
  const { assessments, sessions } = await fetchPublishData(date);

  if (sessions.length === 0) {
    broadcast("success", "All sessions are already published. Nothing to do.");
    broadcast("done", "Publish complete — 0 sessions to process", { passed: 0, failed: 0 });
    return;
  }

  broadcast("info", `Found ${sessions.length} unpublished session(s)${date ? ` for ${date}` : ""}`);

  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const page    = await browser.newPage();
  page.setDefaultTimeout(20000);

  let passed = 0, failed = 0;

  try {
    await loginToTopin(page, mobile, otp);

    for (const session of sessions) {
      const num = passed + failed + 1;
      broadcast("info", `\n[${num}/${sessions.length}] ${session.assessmentTitle} — ${session.dateOfAssessment} ${session.startTimeSlot}`);

      try {
        const assessmentId = await publishOneSession(page, session, assessments);
        await updateDoc(doc(db, "examSessions", session.id), {
          topinAssessmentId: assessmentId,
          publishStatus:     "published",
          publishedAt:       new Date().toISOString(),
        });
        broadcast("success", `  Assessment ID: ${assessmentId}`);
        passed++;
      } catch (err) {
        broadcast("error", `  Failed: ${err.message}`);
        await updateDoc(doc(db, "examSessions", session.id), {
          publishStatus: "failed",
          publishError:  err.message,
        }).catch(() => {});
        failed++;
      }

      await page.waitForTimeout(800);
    }
  } finally {
    await browser.close();
  }

  broadcast("done", `Publish complete — ${passed} published, ${failed} failed`, { passed, failed });
}

// ── Invite: Firestore fetch ───────────────────────────────────────────────────

async function fetchInviteData(date) {
  const [bookingsSnap, sessionsSnap] = await Promise.all([
    getDocs(collection(db, "bookingRows")),
    getDocs(collection(db, "examSessions")),
  ]);

  let bookings = bookingsSnap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  if (date) bookings = bookings.filter(b => b.contestDate === date);

  const sessionMap = new Map();
  sessionsSnap.docs.forEach(d => {
    const s = d.data();
    if (s.sessionKey && s.topinAssessmentId) sessionMap.set(s.sessionKey, s.topinAssessmentId);
  });

  return { bookings, sessionMap };
}

// ── Invite: single API call with retry ───────────────────────────────────────

const MAX_RETRIES   = 3;
const RATE_LIMIT_MS = 200;

async function callInviteAPI(endpoint, token, uidField, assessIdField, studentUid, assessmentId, attempt = 1) {
  const payload = { [uidField]: studentUid, [assessIdField]: assessmentId };

  const res = await fetch(endpoint, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });

  if (res.ok) return res.json().catch(() => ({}));

  const text = await res.text().catch(() => "");
  if (attempt < MAX_RETRIES) {
    const delay = 1000 * attempt;
    broadcast("warn", `    Retry ${attempt}/${MAX_RETRIES - 1} in ${delay}ms…`);
    await new Promise(r => setTimeout(r, delay));
    return callInviteAPI(endpoint, token, uidField, assessIdField, studentUid, assessmentId, attempt + 1);
  }

  throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
}

// ── Invite: main loop ─────────────────────────────────────────────────────────

async function runInvite(apiEndpoint, apiToken, uidField, assessIdField, date) {
  broadcast("info", "Fetching bookings from Firestore…");
  const { bookings, sessionMap } = await fetchInviteData(date);

  const toInvite = bookings.filter(b =>
    b.inviteStatus !== "sent" && b.sessionKey && sessionMap.has(b.sessionKey),
  );
  const blocked = bookings.filter(b =>
    b.inviteStatus !== "sent" && b.sessionKey && !sessionMap.has(b.sessionKey),
  );

  if (blocked.length > 0) {
    broadcast("warn", `${blocked.length} student(s) skipped — session not yet published`);
  }

  if (toInvite.length === 0) {
    broadcast("success", "All eligible students already invited. Nothing to do.");
    broadcast("done", "Invite complete — 0 invites to send", { sent: 0, failed: 0 });
    return;
  }

  broadcast("info", `Sending ${toInvite.length} invite(s)…\n`);

  let sent = 0, failed = 0;

  for (const booking of toInvite) {
    const { firestoreId, studentName, studentUid, sessionKey } = booking;
    const assessmentId = sessionMap.get(sessionKey);
    const num = sent + failed + 1;

    broadcast("info", `[${num}/${toInvite.length}] ${studentName || studentUid}`);

    try {
      await callInviteAPI(apiEndpoint, apiToken, uidField, assessIdField, studentUid, assessmentId);
      await updateDoc(doc(db, "bookingRows", firestoreId), {
        inviteStatus: "sent",
        invitedAt:    new Date().toISOString(),
        inviteError:  null,
      });
      broadcast("success", "  Sent");
      sent++;
    } catch (err) {
      broadcast("error", `  Failed: ${err.message}`);
      await updateDoc(doc(db, "bookingRows", firestoreId), {
        inviteStatus: "failed",
        inviteError:  err.message,
      }).catch(() => {});
      failed++;
    }

    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }

  broadcast("done", `Invite complete — ${sent} sent, ${failed} failed`, { sent, failed });
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Automation server running at http://localhost:${PORT}`);
  console.log(`   GET  /health    — status check`);
  console.log(`   GET  /progress  — SSE progress stream`);
  console.log(`   POST /publish   — run Playwright publish`);
  console.log(`   POST /invite    — run API invites\n`);
});
