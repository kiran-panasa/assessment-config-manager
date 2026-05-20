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
import { getFirestore, collection, getDocs, doc, updateDoc, addDoc } from "firebase/firestore";

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

const DEFAULT_TOPIN_LOGIN_URL =
  "https://accounts.ccbp.in/login?client_id=topin_config&auth_client_id=topin&call_back_url=https://config.topin.tech/&mode=otp&WINDOW_MODE=IN_APP";

app.post("/publish", async (req, res) => {
  const { mobile, otp, date, topinLoginUrl } = req.body;
  if (!mobile || !otp) return res.status(400).json({ error: "mobile and otp are required" });
  res.json({ started: true });
  // Small delay so the browser's EventSource connection is established first
  await new Promise(r => setTimeout(r, 400));
  runPublish(mobile, otp, date || null, topinLoginUrl || DEFAULT_TOPIN_LOGIN_URL).catch(err =>
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

async function trySelector(page, selectors, timeout = 8000) {
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout });
      return sel;
    } catch { /* try next */ }
  }
  return null;
}

async function loginToTopin(page, mobile, otp, loginUrl) {
  broadcast("info", "Navigating to Topin login…");
  await page.goto(loginUrl, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(3000);

  const currentUrl = page.url();
  broadcast("info", `  Page URL: ${currentUrl}`);

  // Wait for any input to appear, then log all of them for debugging
  try { await page.waitForSelector("input", { timeout: 10000 }); } catch { /* none found */ }
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll("input")].map(el => ({
      type: el.type, name: el.name || "—",
      placeholder: el.placeholder || "—", id: el.id || "—",
      visible: el.offsetWidth > 0 && el.offsetHeight > 0,
    }))
  );
  broadcast("info", `  Inputs found (${inputs.length}): ${JSON.stringify(inputs)}`);

  // Phone input — try multiple possible selectors
  const phoneSel = await trySelector(page, [
    'input[name="phone"]',
    'input[name="mobile"]',
    'input[type="tel"]',
    'input[placeholder*="phone" i]',
    'input[placeholder*="mobile" i]',
    'input[placeholder*="number" i]',
    'input[placeholder*="enter" i]',
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
  ], 12000);
  if (!phoneSel) throw new Error("Could not find phone/mobile input on Topin login page. Check the 'Inputs found' log line above.");
  await page.fill(phoneSel, mobile);
  broadcast("info", "  Entered phone number");

  // Get OTP button
  const otpBtnSel = await trySelector(page, [
    'button[data-testid="getOTPButton"]',
    'button:has-text("Get OTP")',
    'button:has-text("Send OTP")',
    'button:has-text("Request OTP")',
    'button[type="submit"]',
  ], 5000);
  if (!otpBtnSel) throw new Error("Could not find Get OTP button on Topin login page.");
  await page.click(otpBtnSel);
  await page.waitForTimeout(2500);

  // OTP input — split boxes or single field
  const otpInputSel = await trySelector(page, [
    'input[autocomplete="one-time-code"]',
    'input[name="otp"]',
    'input[placeholder*="otp" i]',
    'input[placeholder*="code" i]',
    'input[placeholder*="enter" i]',
  ], 12000);
  if (!otpInputSel) throw new Error("Could not find OTP input on Topin login page.");
  await page.click(otpInputSel);
  await page.keyboard.type(otp);
  broadcast("info", "  Entered OTP");

  // Verify OTP button
  const verifyBtnSel = await trySelector(page, [
    'button[data-testid="multi-step-verify-otp-button"]',
    'button:has-text("Verify OTP")',
    'button:has-text("Verify")',
    'button:has-text("Login")',
    'button:has-text("Sign In")',
    'button[type="submit"]',
  ], 5000);
  if (!verifyBtnSel) throw new Error("Could not find Verify OTP button on Topin login page.");
  await page.click(verifyBtnSel);
  await page.waitForNavigation({ waitUntil: "load", timeout: 30000 }).catch(() => {});

  broadcast("success", "Logged in to Topin");
}

// ── Publish: clone, fill, publish one session ─────────────────────────────────

// ── Date-time picker helper ───────────────────────────────────────────────────
// Handles the custom calendar + time-list picker on the Final Review page.
// dateStr = "YYYY-MM-DD", timeStr = "4:00 PM" (12-hr, no leading zero on hour)

// react-datepicker with scroll-type month/year dropdowns.
// dateStr = "YYYY-MM-DD", timeStr = "4:00 PM" (12-hr, no leading zero on hour)
async function selectDateTimePicker(page, labelText, dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const targetMonth = MONTHS[month - 1];

  // Open the picker by clicking the input (located below its label)
  await page.locator(`text="${labelText}"`).locator('xpath=..').locator('input').click();
  await page.waitForTimeout(500);

  // Check current month/year in header (e.g. "May 2026")
  const currentHeader = await page.locator('.react-datepicker__current-month').first().textContent();

  if (!currentHeader.includes(targetMonth) || !currentHeader.includes(String(year))) {
    // Open month scroll-dropdown and click the target month
    await page.locator('.react-datepicker__month-read-view').click();
    await page.waitForTimeout(300);
    await page.locator(`.react-datepicker__month-option:has-text("${targetMonth}")`).click();
    await page.waitForTimeout(200);

    // Open year scroll-dropdown and click the target year if still wrong
    const afterMonth = await page.locator('.react-datepicker__current-month').first().textContent();
    if (!afterMonth.includes(String(year))) {
      await page.locator('.react-datepicker__year-read-view').click();
      await page.waitForTimeout(300);
      await page.locator(`.react-datepicker__year-option:has-text("${year}")`).click();
      await page.waitForTimeout(200);
    }
  }

  // Click the correct day — exclude greyed-out outside-month days
  await page.locator(
    `.react-datepicker__day:not(.react-datepicker__day--outside-month):text-is("${day}")`
  ).first().click();
  await page.waitForTimeout(300);

  // Click the matching time in the time list (e.g. "4:00 PM")
  await page.locator(`.react-datepicker__time-list-item:has-text("${timeStr}")`).first().click();
  await page.waitForTimeout(300);
}

// ── Publish one session (3-step flow) ────────────────────────────────────────

async function publishOneSession(page, session, assessments) {
  const config = assessments.find(
    a => a.skill === session.skill && a.level === `L${session.level}`,
  );
  if (!config?.url) throw new Error(`No config URL for ${session.skill} - L${session.level}`);

  // ── 1. Open config URL and clone ──────────────────────────────────────────
  broadcast("info", "  Opening config URL…");
  await page.goto(config.url, { waitUntil: "load", timeout: 30000 });
  await page.click('button[aria-label="clone-assessment"]');
  await page.waitForNavigation({ waitUntil: "load", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  broadcast("info", "  Cloned — on Section Details");

  // ── 2. Section Details: no changes, just Save & Next ─────────────────────
  await page.click('button:has-text("Save & Next")');
  await page.waitForNavigation({ waitUntil: "load", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  broadcast("info", "  On Final Review — filling details…");

  // ── 3. Final Review: Name of Assessment ───────────────────────────────────
  const nameInput = page.locator('input[placeholder*="Name of Assessment" i], input[name*="title" i], input[name*="name" i]').first();
  await nameInput.click({ clickCount: 3 });
  await nameInput.fill(session.assessmentTitle);

  // ── 4. Final Review: Tags — add Unique Exam ID ────────────────────────────
  await page.click('[placeholder="Add Tags"]');
  await page.keyboard.type(session.uniqueExamId);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // ── 5. Final Review: Start Date & Time ───────────────────────────────────
  await selectDateTimePicker(page, 'Start Date & Time', session.dateOfAssessment, session.startTimeSlot);

  // ── 6. Final Review: End Date & Time ─────────────────────────────────────
  await selectDateTimePicker(page, 'End Date & Time', session.dateOfAssessment, session.endTimeSlot);

  // ── 7. Final Review: Exit Password (under Internal Admin Options) ─────────
  const exitInput = page.getByLabel('Exit Password');
  await exitInput.scrollIntoViewIfNeeded();
  await exitInput.click({ clickCount: 3 });
  await exitInput.fill(session.exitPin);

  // ── 8. Save & Next → Publish & Invite page ───────────────────────────────
  await page.click('button:has-text("Save & Next")');
  await page.waitForNavigation({ waitUntil: "load", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  broadcast("info", "  On Publish & Invite page…");

  await page.click('button:has-text("Publish Assessment")');

  // Confirmation modal appears — click "Yes, I Agree"
  await page.waitForSelector('button[data-testid="agree-button"]', { timeout: 10000 });
  await page.click('button[data-testid="agree-button"]');
  await page.waitForTimeout(3000);
  broadcast("info", "  Published — extracting Assessment ID…");

  // Extract org_id from the Assessment Link box.
  // Tries input.value (DOM property) first, then text content of any element.
  const assessmentId = await page.evaluate(() => {
    // Check inputs — value property (not HTML attribute) holds the live value
    for (const el of document.querySelectorAll("input")) {
      if (el.value && el.value.includes("org_id=")) {
        try { return new URL(el.value).searchParams.get("org_id"); } catch {}
      }
    }
    // Fallback: scan all text nodes for the URL pattern
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (t.includes("org_id=") && t.includes("assessment.topin.tech")) {
        const m = t.match(/org_id=([0-9a-f-]{36})/i);
        if (m) return m[1];
      }
    }
    return null;
  });

  if (!assessmentId) throw new Error("Could not find Assessment Link on page after publishing.");
  return assessmentId;
}

// ── Job logger (writes duration to Firestore for credit tracking) ─────────────

async function logJob(type, startMs, stats) {
  const durationMinutes = parseFloat(((Date.now() - startMs) / 60000).toFixed(2));
  const month = new Date().toISOString().slice(0, 7); // "2026-05"
  await addDoc(collection(db, "jobLogs"), {
    type, durationMinutes, month,
    loggedAt: new Date().toISOString(),
    ...stats,
  }).catch(() => {});
}

// ── Publish: main loop ────────────────────────────────────────────────────────

async function runPublish(mobile, otp, date, loginUrl) {
  const startMs = Date.now();
  broadcast("info", "Fetching sessions from Firestore…");
  const { assessments, sessions } = await fetchPublishData(date);

  if (sessions.length === 0) {
    broadcast("success", "All sessions are already published. Nothing to do.");
    broadcast("done", "Publish complete — 0 sessions to process", { passed: 0, failed: 0 });
    return;
  }

  broadcast("info", `Found ${sessions.length} unpublished session(s)${date ? ` for ${date}` : ""}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const page    = await browser.newPage();
  page.setDefaultTimeout(20000);

  let passed = 0, failed = 0;

  try {
    await loginToTopin(page, mobile, otp, loginUrl);

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

  await logJob("publish", startMs, { passed, failed });
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
  const startMs = Date.now();
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

  await logJob("invite", startMs, { sent, failed });
  broadcast("done", `Invite complete — ${sent} sent, ${failed} failed`, { sent, failed });
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Automation server running at http://localhost:${PORT}`);
  console.log(`   GET  /health    — status check`);
  console.log(`   GET  /progress  — SSE progress stream`);
  console.log(`   POST /publish   — run Playwright publish`);
  console.log(`   POST /invite    — run API invites\n`);
});
