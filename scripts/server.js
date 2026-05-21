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

// Keep SSE connections alive — cloud proxies drop silent connections after ~30s
setInterval(() => {
  for (const res of clients) res.write(": heartbeat\n\n");
}, 15000);

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

  // Wait up to 15s for any input to appear (React SPA — renders after JS)
  try { await page.waitForSelector("input", { timeout: 15000 }); } catch { /* none found in main doc */ }

  // Check main document inputs
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll("input")].map(el => ({
      type: el.type, name: el.name || "—",
      placeholder: el.placeholder || "—", id: el.id || "—",
      visible: el.offsetWidth > 0 && el.offsetHeight > 0,
    }))
  );
  broadcast("info", `  Main doc inputs (${inputs.length}): ${JSON.stringify(inputs)}`);

  // Check for iframes — CCBP login might render inside one
  const frames = page.frames();
  broadcast("info", `  Frames found: ${frames.length} — ${frames.map(f => f.url()).join(" | ")}`);
  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    try {
      const frameInputs = await frame.evaluate(() =>
        [...document.querySelectorAll("input")].map(el => ({
          type: el.type, name: el.name || "—",
          placeholder: el.placeholder || "—", id: el.id || "—",
        }))
      );
      if (frameInputs.length > 0)
        broadcast("info", `  Inputs in frame (${frame.url().slice(0, 60)}): ${JSON.stringify(frameInputs)}`);
    } catch { /* cross-origin frame */ }
  }

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
  await page.waitForTimeout(4000);

  // Warm up the config.topin.tech domain so auth cookies are set before we
  // navigate to individual assessment URLs — prevents the ?auth_code= redirect
  // from interrupting each assessment page load.
  broadcast("info", "  Initialising session on config.topin.tech…");
  await page.goto("https://config.topin.tech", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  broadcast("success", "Logged in to Topin");
}

// ── Date/time helpers ─────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function ordinalSuffix(day) {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function buildDateButtonName(date) {
  return `Choose ${WEEKDAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}${ordinalSuffix(date.getDate())}, ${date.getFullYear()}`;
}

function formatTimeSlot(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const twelveHour = hours % 12 || 12;
  return `${twelveHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

function parseDateTime(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const m = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) throw new Error(`Invalid time format: ${timeStr}`);
  let hour = parseInt(m[1]);
  const min = parseInt(m[2]);
  const period = m[3].toUpperCase();
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  const d = new Date(year, month - 1, day, hour, min, 0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
  return d;
}

async function ensureMonth(page, targetDate) {
  const picker = page.locator('.react-datepicker').last();
  const targetMonthYear = `${MONTH_NAMES[targetDate.getMonth()]} ${targetDate.getFullYear()}`;
  for (let attempt = 0; attempt < 24; attempt++) {
    const current = ((await picker.locator('.react-datepicker__current-month').textContent()) || '').replace(/\s+/g, ' ').trim();
    if (current === targetMonthYear) return;
    const [monthName, yearText] = current.split(' ');
    const currentKey = Number(yearText) * 12 + MONTH_NAMES.indexOf(monthName);
    const targetKey = targetDate.getFullYear() * 12 + targetDate.getMonth();
    if (currentKey < targetKey) {
      await picker.getByRole('button', { name: 'Next Month' }).click();
    } else {
      await picker.getByRole('button', { name: 'Previous Month' }).click();
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`Unable to navigate date picker to ${targetMonthYear}`);
}

async function setDateTimeField(page, testId, dateStr, timeStr) {
  const targetDate = parseDateTime(dateStr, timeStr);
  const timeText = formatTimeSlot(targetDate);

  const wrapper = page.locator(`[data-testid="${testId}"]`);
  await wrapper.locator('input[placeholder="Select Date & Time"]').click();
  await page.locator('.react-datepicker').last().waitFor({ state: 'visible' });

  await ensureMonth(page, targetDate);
  await page.locator('.react-datepicker').last()
    .getByRole('button', { name: buildDateButtonName(targetDate) }).click();
  await page.waitForTimeout(300);

  const pickerEl = page.locator('.react-datepicker').last();
  const scrollResult = await pickerEl.evaluate((el, targetText) => {
    const list = el.querySelector('.react-datepicker__time-list');
    const items = Array.from(el.querySelectorAll('.react-datepicker__time-list-item'));
    const index = items.findIndex(item => (item.textContent || '').trim() === targetText);
    if (index === -1 || !list) return null;
    list.scrollTop = items[index].offsetTop;
    return { found: true };
  }, timeText);
  if (!scrollResult) throw new Error(`Time option "${timeText}" not found in picker for ${testId}`);

  await page.waitForTimeout(150);
  const timeHandle = await pickerEl.evaluateHandle((el, targetText) => {
    const items = Array.from(el.querySelectorAll('.react-datepicker__time-list-item'));
    return items.find(item => (item.textContent || '').trim() === targetText) || null;
  }, timeText);
  const el = timeHandle.asElement();
  if (!el) throw new Error(`Time option "${timeText}" could not be located for clicking`);
  await el.click();
  await timeHandle.dispose();
  await page.waitForTimeout(300);
}

// ── Internal Admin helpers ────────────────────────────────────────────────────

async function ensureInternalAdminOpen(page) {
  const secureButton = page.getByRole('button', { name: 'Enable Secure Browser' });
  if (!(await secureButton.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Internal Admin Options' }).click();
  }
}

async function setExitPin(page, exitPin) {
  await ensureInternalAdminOpen(page);
  const container = page.locator('[data-testid="ao-exam-environment-option"]');
  const exitInput = container.locator('input[placeholder="Custom Exit Password (if any)"]');
  if (!(await exitInput.isVisible().catch(() => false))) {
    await container.getByRole('button', { name: 'Enable Secure Browser' }).click();
  }
  const yesRadio = container.locator('input[data-testid="Yes"]').first();
  if ((await yesRadio.count()) && !(await yesRadio.isChecked().catch(() => false))) {
    await container.locator('span', { hasText: 'Yes' }).first().click();
  }
  await exitInput.fill('');
  await exitInput.fill(exitPin);
}

// ── Publish one session ───────────────────────────────────────────────────────

async function publishOneSession(page, session, assessments) {
  const config = assessments.find(
    a => a.skill === session.skill && a.level === `L${session.level}`,
  );
  if (!config?.url) throw new Error(`No config URL for ${session.skill} - L${session.level}`);

  // ── 1. Open config URL — wait for auth redirect to settle ────────────────
  broadcast("info", "  Opening config URL…");
  await page.goto(config.url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  try {
    await page.waitForURL(/config\.topin\.tech/, { timeout: 30000 });
  } catch {
    broadcast("info", `  Auth redirect incomplete — still on ${page.url()}`);
  }
  await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(6000);

  // ── 2. Clone button — text-based locator, retry with re-navigation ────────
  const cloneLocator = page.locator('button, a, [role="button"]').filter({ hasText: /clone/i }).first();
  let cloneFound = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await cloneLocator.waitFor({ timeout: 30000 });
      cloneFound = true;
      break;
    } catch {
      if (attempt === 1) {
        broadcast("info", "  Clone button not ready, re-navigating…");
        await page.goto(config.url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        try { await page.waitForURL(/config\.topin\.tech/, { timeout: 30000 }); } catch { /* proceed */ }
        await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(6000);
      }
    }
  }
  if (!cloneFound) throw new Error("Clone button not found after 2 attempts.");

  await cloneLocator.click();
  await page.waitForURL(/create-assessment|edit-assessment/, { timeout: 30000 });
  broadcast("info", "  Cloned — on Section Details");

  // ── 3. Section Details: Save & Next ──────────────────────────────────────
  await page.locator('button, a, [role="button"]').filter({ hasText: /save\s*&\s*next/i }).first().click();
  await page.waitForURL(/edit-assessment/, { timeout: 30000 });
  await page.locator('input[placeholder="Enter Assessment Name"]').waitFor({ timeout: 30000 });
  broadcast("info", "  On Final Review — filling details…");

  // ── 4. Assessment Name ────────────────────────────────────────────────────
  await page.locator('input[placeholder="Enter Assessment Name"]').fill(session.assessmentTitle);

  // ── 5. Tags — clear existing, fill Unique Exam ID ────────────────────────
  await page.evaluate(() => {
    const chips = Array.from(
      document.querySelectorAll('[data-testid="bscd-assess-categories-input"] .Select__multi-value'),
    );
    chips.forEach(chip => {
      const remove = chip.querySelector('.Select__multi-value__remove');
      if (remove) {
        remove.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        remove.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
  });
  await page.waitForTimeout(300);
  const tagsInput = page.locator('[data-testid="bscd-assess-categories-input"] input').first();
  await tagsInput.fill(session.uniqueExamId);
  await tagsInput.press('Enter');
  await page.waitForTimeout(300);
  broadcast("info", "  Tags set");

  // ── 6. Start Date & Time ──────────────────────────────────────────────────
  await setDateTimeField(page, 'bscd-start-date-time-input', session.dateOfAssessment, session.startTimeSlot);
  broadcast("info", "  Start date/time set");

  // ── 7. End Date & Time ────────────────────────────────────────────────────
  await setDateTimeField(page, 'bscd-end-date-time-input', session.dateOfAssessment, session.endTimeSlot);
  broadcast("info", "  End date/time set");

  // ── 8. Exit PIN ───────────────────────────────────────────────────────────
  await setExitPin(page, session.exitPin);
  broadcast("info", "  Exit PIN set");

  // ── 9. Save & Next → Publish page ────────────────────────────────────────
  await page.locator('button, a, [role="button"]').filter({ hasText: /save\s*&\s*next/i }).first().click();
  await page.waitForTimeout(3000);
  broadcast("info", "  On Publish & Invite page…");

  // ── 10. Publish ───────────────────────────────────────────────────────────
  const publishLocator = page.locator('button, a, [role="button"]').filter({ hasText: /^publish assessment$/i }).first();
  await publishLocator.waitFor({ timeout: 30000 });
  await publishLocator.click();
  await page.getByRole('button', { name: 'Yes, I agree' }).click();

  const copyLinkButton = page.getByRole('button', { name: 'Copy Link' });
  await copyLinkButton.waitFor({ timeout: 60000 });
  broadcast("info", "  Published — extracting Assessment Link…");

  // Try clipboard first, fall back to DOM scan
  let assessmentLink = null;
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'https://config.topin.tech',
    });
    await copyLinkButton.click();
    const clipText = await page.evaluate(async () => navigator.clipboard.readText());
    if (clipText && clipText.includes('assessment.topin.tech')) assessmentLink = clipText;
  } catch { /* fall through to DOM scan */ }

  if (!assessmentLink) {
    assessmentLink = await page.evaluate(() => {
      for (const el of document.querySelectorAll('input')) {
        if (el.value && el.value.includes('org_id=')) return el.value;
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim();
        if (t.includes('org_id=') && t.includes('assessment.topin.tech')) return t;
      }
      return null;
    });
  }

  if (!assessmentLink) throw new Error('Could not find Assessment Link after publishing.');

  let assessmentId;
  try {
    assessmentId = new URL(assessmentLink).searchParams.get('org_id');
  } catch {
    const m = assessmentLink.match(/org_id=([0-9a-f-]{36})/i);
    assessmentId = m ? m[1] : null;
  }
  if (!assessmentId) throw new Error(`Could not extract org_id from link: ${assessmentLink}`);
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
