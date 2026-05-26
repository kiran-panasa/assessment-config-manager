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
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import pg from "pg";
const { Client } = pg;
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc, addDoc, writeBatch, query, where } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

// ── Firebase ──────────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDCKw2EE9RJ1-oPo1sdbgsU47ra3LbbpQc",
  authDomain:        "assessment-config-manager.firebaseapp.com",
  projectId:         "assessment-config-manager",
  storageBucket:     "assessment-config-manager.firebasestorage.app",
  messagingSenderId: "567558097768",
  appId:             "1:567558097768:web:aad46b095e48359fdf24dd",
};

const fbApp  = initializeApp(FIREBASE_CONFIG, "automation-server");
const db     = getFirestore(fbApp);
const fbAuth = getAuth(fbApp);

// ── Express setup ─────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// ── SSE broadcast ─────────────────────────────────────────────────────────────

const clients = new Set();
let jobRunning = false;
let cancelRequested = false;

// Keep SSE connections alive — cloud proxies drop silent connections after ~30s
setInterval(() => {
  for (const res of clients) {
    try { res.write(": heartbeat\n\n"); }
    catch { clients.delete(res); }
  }
}, 15000);

function broadcast(type, message, extra = {}) {
  const data = JSON.stringify({ type, message, ts: Date.now(), ...extra });
  for (const res of clients) res.write(`data: ${data}\n\n`);
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// ── Session cookie persistence ────────────────────────────────────────────────
// Saves Topin browser cookies after a successful OTP login so subsequent runs
// can skip the OTP flow entirely (saves ~1–2 min per publish run).

const COOKIES_FILE     = "./topin-session.json";
const NETWORK_LOG_FILE = "./topin-network-log.json";
const HAR_FILE         = "./topin-network.har";

// Uses Playwright's built-in HAR recording (recordHar on newContext).
// The HAR file is written when context.close() is called in runPublish,
// then parsed into a clean JSON format for the /network-log endpoint.

function parseHarToLog() {
  if (!existsSync(HAR_FILE)) {
    broadcast("warn", "[INTERCEPTOR] HAR file not found — nothing was captured.");
    return;
  }
  try {
    const har = JSON.parse(readFileSync(HAR_FILE, "utf8"));
    const SKIP = /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|otf|ico|map|webp)(\?|$)/i;
    const entries = (har.log?.entries || [])
      .filter(e => !SKIP.test(e.request.url))
      .map(e => {
        let reqBody = null;
        if (e.request.postData?.text) {
          try { reqBody = JSON.parse(e.request.postData.text); }
          catch { reqBody = e.request.postData.text; }
        }
        let resBody = null;
        const rawText = e.response.content?.text;
        if (rawText) {
          const enc = e.response.content?.encoding;
          const decoded = enc === "base64"
            ? Buffer.from(rawText, "base64").toString("utf8")
            : rawText;
          try { resBody = JSON.parse(decoded); }
          catch { resBody = decoded.slice(0, 2000); }
        }
        return {
          timestamp:   e.startedDateTime,
          method:      e.request.method,
          url:         e.request.url,
          status:      e.response.status,
          mimeType:    e.response.content?.mimeType || null,
          requestBody: reqBody,
          responseBody: resBody,
        };
      });
    writeFileSync(NETWORK_LOG_FILE, JSON.stringify(entries, null, 2));
    broadcast("info", `[INTERCEPTOR] ${entries.length} API call(s) captured → topin-network-log.json`);
    console.log(`[INTERCEPTOR] Saved ${entries.length} entries from HAR`);
  } catch (err) {
    broadcast("error", `[INTERCEPTOR] HAR parse failed: ${err.message}`);
    console.error("[INTERCEPTOR] HAR parse error:", err);
  }
}

async function saveSession(context) {
  try {
    await context.storageState({ path: COOKIES_FILE });
    broadcast("info", "[SESSION] Session saved — next run will skip OTP login.");
  } catch { /* non-fatal */ }
}

async function tryRestoreSession(context, page) {
  if (!existsSync(COOKIES_FILE)) return false;
  try {
    // storageState is passed at context creation time; here we verify the saved
    // state is still valid by navigating to Topin and checking the URL
    await page.goto("https://config.topin.tech", { waitUntil: "domcontentloaded", timeout: 20000 });
    const url = page.url();
    const valid = url.includes("config.topin.tech") && !url.includes("accounts.ccbp.in");
    if (valid) {
      broadcast("success", "[SESSION] Restored saved session — skipping OTP login.");
      return true;
    }
    broadcast("info", "[SESSION] Saved session expired — falling back to OTP login.");
    return false;
  } catch {
    broadcast("info", "[SESSION] Could not restore session — falling back to OTP login.");
    return false;
  }
}

// ── Auth middleware ───────────────────────────────────────────────────────────

function requireSecret(req, res, next) {
  const secret = process.env.SERVER_SECRET;
  if (!secret) return next(); // no secret set → open (local dev)
  if (req.headers["x-server-token"] !== secret)
    return res.status(401).json({ error: "Unauthorized" });
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/health",      (_req, res) => res.json({ status: "ok" }));
app.get("/status",      (_req, res) => res.json({ jobRunning }));
app.get("/network-log", requireSecret, (_req, res) => {
  if (!existsSync(NETWORK_LOG_FILE))
    return res.status(404).json({ error: "No log yet — run a publish first." });
  try {
    const entries = JSON.parse(readFileSync(NETWORK_LOG_FILE, "utf8"));
    // Return a summary by default; pass ?full=1 for the raw log
    if (res.req.query.full === "1") return res.json({ count: entries.length, entries });
    const summary = entries.map(e => ({
      phase:  e.phase,
      method: e.method,
      url:    e.url,
      status: e.status,
      reqBody:  e.requestBody  ? "(present)" : null,
      resBody:  e.responseBody ? "(present)" : null,
    }));
    res.json({ count: entries.length, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/cancel", requireSecret, (_req, res) => {
  if (jobRunning) {
    cancelRequested = true;
    broadcast("warn", "Cancel requested — stopping after current step…");
  }
  res.json({ ok: true });
});

// ── Replit DB: fetch bookings by date ─────────────────────────────────────────

app.get("/fetch-bookings", requireSecret, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });

  const rawConn = process.env.CONTEST_BOOKINGS_DB_URL;
  if (!rawConn) return res.status(500).json({ error: "CONTEST_BOOKINGS_DB_URL env var not set on server" });

  // Strip query string — Neon's SSL params can be malformed; apply SSL explicitly instead
  const connStr = rawConn.replace(/\?.*$/, "");
  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const result = await client.query(
      `SELECT
         cr.booking_id,
         cr.student_uid,
         cr.skill,
         cr.skill_level::text AS skill_level,
         cr.contest_link,
         cr.classroom_details,
         cr.registered_at,
         cs.campus,
         cs.contest_date,
         cs.time_slot
       FROM contest_registrations cr
       JOIN contest_slots cs ON cr.contest_slot_id = cs.id
       WHERE cs.contest_date = $1
         AND cr.is_cancelled = false
         AND cs.is_active    = true
         AND cs.is_deleted   = false
       ORDER BY cs.time_slot, cr.booking_id`,
      [date],
    );
    res.json({
      rows: result.rows,
      columns: result.fields.map(f => f.name),
      count: result.rowCount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.end().catch(() => {});
  }
});

app.get("/progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

app.post("/publish", requireSecret, async (req, res) => {
  if (jobRunning) return res.status(409).json({ error: "A job is already running. Wait for it to finish before starting another." });
  const { mobile, otp, date } = req.body;
  if (!mobile || !otp) return res.status(400).json({ error: "mobile and otp are required" });
  jobRunning = true;
  res.json({ started: true });
  // Small delay so the browser's EventSource connection is established first
  await new Promise(r => setTimeout(r, 400));
  runPublish(mobile, otp, date || null)
    .catch(err => broadcast("error", `Fatal error: ${err.message}`))
    .finally(() => { jobRunning = false; });
});

app.post("/invite", requireSecret, async (req, res) => {
  if (jobRunning) return res.status(409).json({ error: "A job is already running. Wait for it to finish before starting another." });
  const { apiEndpoint, apiToken, date } = req.body;
  if (!apiEndpoint || !apiToken) return res.status(400).json({ error: "apiEndpoint and apiToken are required" });
  jobRunning = true;
  res.json({ started: true });
  await new Promise(r => setTimeout(r, 400));
  runInvite(apiEndpoint, apiToken, date || null)
    .catch(err => broadcast("error", `Fatal error: ${err.message}`))
    .finally(() => { jobRunning = false; });
});

// ── Publish: Firestore fetch ──────────────────────────────────────────────────

async function fetchPublishData(date) {
  let sessionsQuery = collection(db, "examSessions");
  if (date) sessionsQuery = query(sessionsQuery, where("dateOfAssessment", "==", date));

  const [assessmentsSnap, sessionsSnap] = await Promise.all([
    getDocs(collection(db, "assessments")),
    getDocs(sessionsQuery),
  ]);

  const assessments = assessmentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const sessions = sessionsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.publishStatus !== "published");

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

async function waitForPageSettled(page, timeout = 15000) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
}

const TOPIN_BASE_URL = 'https://config.topin.tech/';

async function loginToTopin(page, mobile, otp) {
  broadcast("info", "Navigating to Topin…");

  // Navigate directly to config.topin.tech — it will redirect to accounts.ccbp.in/login
  // as the main page URL when there is no valid session. This is different from navigating
  // to the accounts URL with WINDOW_MODE=IN_APP, which bounces back to config.topin.tech
  // immediately with the login embedded as an iframe (breaking the waitForURL check).
  await page.goto(TOPIN_BASE_URL, { waitUntil: 'domcontentloaded' });
  await waitForPageSettled(page);

  broadcast("info", `  Page URL: ${page.url()}`);

  // If not redirected to login (e.g. stale session cookie), clear and retry
  if (!page.url().includes('accounts.ccbp.in/login')) {
    broadcast("info", "  Not on login page — clearing cookies and retrying…");
    await page.context().clearCookies();
    await page.goto(TOPIN_BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForPageSettled(page);
    broadcast("info", `  Page URL after retry: ${page.url()}`);
  }

  if (!page.url().includes('accounts.ccbp.in/login')) {
    throw new Error(`Could not reach Topin login page. Current URL: ${page.url()}`);
  }

  // Phone number
  await page.locator('input[placeholder="Enter Number"]').fill(mobile);
  await page.getByRole('button', { name: 'GET OTP' }).click();
  await page.waitForTimeout(2000);
  broadcast("info", "  OTP requested");

  // OTP — split digit boxes
  const digits = otp.replace(/\D/g, '');
  if (digits.length !== 6) throw new Error('OTP must be exactly 6 digits.');
  const otpInputs = page.locator('input[aria-label*="Digit"], input[aria-label*="verification code"]');
  await otpInputs.first().waitFor({ timeout: 10000 });
  for (let i = 0; i < 6; i++) {
    await otpInputs.nth(i).fill(digits[i]);
    await page.waitForTimeout(100);
  }
  broadcast("info", "  OTP entered");

  await page.getByRole('button', { name: /Verify & Login/i }).click();
  broadcast("info", "  Waiting for login redirect…");

  // Wait for redirect from accounts.ccbp.in back to config.topin.tech after successful OTP.
  await page.waitForURL(/config\.topin\.tech/, { timeout: 90000 });
  broadcast("info", `  Redirected — URL: ${page.url()}`);

  await page.waitForTimeout(2000);
  await waitForPageSettled(page);

  // After redirect, the URL contains ?auth_code=... The SPA exchanges it for tokens
  // (via an API call to accounts.ccbp.in) then removes it from the URL.
  // Navigating away before this exchange completes leaves localStorage empty → login redirect.
  if (page.url().includes('auth_code')) {
    broadcast("info", "  Waiting for SPA to exchange auth code for tokens…");
    try {
      await page.waitForURL(
        u => u.toString().includes('config.topin.tech') && !u.toString().includes('auth_code'),
        { timeout: 30000 }
      );
      await waitForPageSettled(page);
      broadcast("info", `  Auth code exchanged — URL: ${page.url()}`);
    } catch {
      broadcast("warn", `  Auth code still in URL after 30s — URL: ${page.url()}`);
    }
  }

  // Log localStorage keys for diagnostics
  const lsKeys = await page.evaluate(() => Object.keys(localStorage)).catch(() => []);
  broadcast("info", `  localStorage keys (${lsKeys.length}): ${lsKeys.slice(0, 10).join(', ')}`);

  await page.waitForTimeout(3000);
  broadcast("success", `Logged in to Topin — URL: ${page.url()}`);
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

  // ── 1. Open config URL in VIEW mode — Clone button only exists there ────
  // Convert /edit-assessment/ → /view-assessment/ (Clone is absent on edit page)
  const viewUrl = config.url.replace("/edit-assessment/", "/view-assessment/");
  broadcast("info", `  Opening view URL: ${viewUrl.slice(0, 100)}`);
  await page.goto(viewUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  // If Topin redirected us to the login page, the session is invalid — fail fast
  if (page.url().includes("accounts.ccbp.in")) {
    throw new Error(`Session invalid — redirected to login when opening view URL. Re-run Publish with a fresh OTP.`);
  }

  // ── 2. Clone button — same selector as topin-cloner (proven working)
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
        await page.goto(viewUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        if (page.url().includes("accounts.ccbp.in")) {
          throw new Error(`Session invalid — redirected to login on re-navigation. Re-run Publish with a fresh OTP.`);
        }
      }
    }
  }
  if (!cloneFound) {
    const currentUrl = page.url();
    const allBtns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a, [role="button"]'))
        .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0)
        .map(el => (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60))
        .filter(Boolean).slice(0, 20)
    ).catch(() => []);
    broadcast("info", `  [DEBUG] URL: ${currentUrl}`);
    broadcast("info", `  [DEBUG] Buttons: ${JSON.stringify(allBtns)}`);
    throw new Error("Clone button not found after 2 attempts.");
  }

  await cloneLocator.click();
  await page.waitForURL(/create-assessment|edit-assessment/, { timeout: 30000 });
  broadcast("info", "  Cloned — on Section Details");

  // ── 3. Section Details: Save & Next ──────────────────────────────────────
  await waitForPageSettled(page);

  // Debug: log visible buttons so we can confirm the exact button text
  const sectionBtns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0)
      .map(el => (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60))
      .filter(Boolean).slice(0, 15)
  ).catch(() => []);
  broadcast("info", `  [DEBUG] Section Details buttons: ${JSON.stringify(sectionBtns)}`);

  // Try Save & Next first; fall back to Next / Continue if the button label differs
  const saveNextLocator = page.locator('button, a, [role="button"]').filter({ hasText: /save\s*&\s*next/i }).first();
  const nextLocator     = page.locator('button, a, [role="button"]').filter({ hasText: /^next$/i }).first();
  const continueLocator = page.locator('button, a, [role="button"]').filter({ hasText: /^continue$/i }).first();

  const hasSaveNext = await saveNextLocator.isVisible({ timeout: 5000 }).catch(() => false);
  const hasNext     = !hasSaveNext && await nextLocator.isVisible({ timeout: 3000 }).catch(() => false);

  if (hasSaveNext)      { await saveNextLocator.click({ timeout: 15000 }); }
  else if (hasNext)     { await nextLocator.click({ timeout: 15000 }); }
  else                  { await continueLocator.click({ timeout: 15000 }); }

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
  await page.locator('button, a, [role="button"]').filter({ hasText: /save\s*&\s*next/i }).first().click({ timeout: 30000 });
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
  return { assessmentId, assessmentLink };
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

async function runPublish(mobile, otp, date) {
  const startMs = Date.now();
  cancelRequested = false;
  broadcast("info", "Fetching sessions from Firestore…");
  const { assessments, sessions } = await fetchPublishData(date);

  if (sessions.length === 0) {
    broadcast("success", "All sessions are already published. Nothing to do.");
    broadcast("done", "Publish complete — 0 sessions to process", { passed: 0, failed: 0 });
    return;
  }

  broadcast("info", `Found ${sessions.length} unpublished session(s)${date ? ` for ${date}` : ""}`);
  broadcast("info", "[INTERCEPTOR] HAR recording enabled — all network calls will be captured.");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  // Match topin-cloner pattern: check session validity first with a temp context,
  // then create the real context either with valid saved state OR completely clean
  // (never load stale state into the same context that does OTP login — old tokens
  // in localStorage corrupt the fresh session and cause view-assessment to redirect)
  let sessionRestored = false;
  if (existsSync(COOKIES_FILE)) {
    const checkCtx = await browser.newContext({
      storageState: COOKIES_FILE,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const checkPage = await checkCtx.newPage();
    await checkPage.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
    sessionRestored = await tryRestoreSession(checkCtx, checkPage);
    await checkCtx.close();
  }

  // Real context: loaded with valid session OR completely fresh for OTP login
  // Use a realistic user agent — Topin detects default headless Chromium UA and
  // blocks protected routes (like /view-assessment/*) while leaving the root accessible
  const context = await browser.newContext({
    recordHar: { path: HAR_FILE },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ...(sessionRestored ? { storageState: COOKIES_FILE } : {}),
  });
  const page = await context.newPage();
  // Hide the webdriver flag that headless Chromium exposes — sites use this to detect automation
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  page.setDefaultTimeout(30000);

  let passed = 0, failed = 0;

  try {
    if (!sessionRestored) {
      await loginToTopin(page, mobile, otp);
      await saveSession(context);
    }

    for (const session of sessions) {
      if (cancelRequested) {
        broadcast("warn", "Job cancelled.");
        break;
      }
      const num = passed + failed + 1;
      broadcast("info", `\n[${num}/${sessions.length}] ${session.assessmentTitle} — ${session.dateOfAssessment} ${session.startTimeSlot}`);

      try {
        const { assessmentId, assessmentLink } = await publishOneSession(page, session, assessments);

        await updateDoc(doc(db, "examSessions", session.id), {
          topinAssessmentId: assessmentId,
          assessmentLink,
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

      await page.waitForTimeout(200);
    }
  } finally {
    // context.close() MUST come before browser.close() — it flushes the HAR file
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    parseHarToLog();
  }

  await logJob("publish", startMs, { passed, failed });
  broadcast("done", `Publish complete — ${passed} published, ${failed} failed`, { passed, failed });
}

// ── Invite: Firestore fetch ───────────────────────────────────────────────────

async function fetchInviteData(date) {
  let bookingsQuery = collection(db, "bookingRows");
  if (date) bookingsQuery = query(bookingsQuery, where("contestDate", "==", date));

  const [bookingsSnap, sessionsSnap] = await Promise.all([
    getDocs(bookingsQuery),
    getDocs(query(collection(db, "examSessions"), where("publishStatus", "==", "published"))),
  ]);

  const bookings = bookingsSnap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));

  const sessionMap = new Map();
  sessionsSnap.docs.forEach(d => {
    const s = d.data();
    if (s.sessionKey && s.topinAssessmentId) sessionMap.set(s.sessionKey, s.topinAssessmentId);
  });

  return { bookings, sessionMap };
}

// ── Invite: batch API call ────────────────────────────────────────────────────

const INVITE_BATCH_SIZE = 20;

async function callInviteAPIBatch(endpoint, apiKey, studentUids, assessmentId) {
  const payload = { candidate_user_ids: studentUids, assessment_id: assessmentId };
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method:  "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const text = await res.text().catch(() => "");
      let json = {};
      try { json = JSON.parse(text); } catch { /* non-JSON response */ }
      if (res.ok || res.status < 500) return { ok: res.ok, status: res.status, json, text };
      // 5xx — worth retrying
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)));
  }
  throw lastErr;
}

// ── Invite: main loop ─────────────────────────────────────────────────────────

async function runInvite(apiEndpoint, apiToken, date) {
  const startMs = Date.now();
  cancelRequested = false;
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

  // Group students by assessment_id (mirrors Apps Script logic)
  const groups = new Map();
  for (const booking of toInvite) {
    const assessmentId = sessionMap.get(booking.sessionKey);
    if (!groups.has(assessmentId)) groups.set(assessmentId, []);
    groups.get(assessmentId).push(booking);
  }

  broadcast("info", `Sending ${toInvite.length} invite(s) across ${groups.size} assessment(s)…\n`);

  let sent = 0, failed = 0;

  for (const [assessmentId, students] of groups) {
    const totalBatches = Math.ceil(students.length / INVITE_BATCH_SIZE);

    for (let i = 0; i < students.length; i += INVITE_BATCH_SIZE) {
      if (cancelRequested) {
        broadcast("warn", "Job cancelled.");
        break;
      }
      const batch = students.slice(i, i + INVITE_BATCH_SIZE);
      const batchNum = Math.floor(i / INVITE_BATCH_SIZE) + 1;
      broadcast("info", `Batch ${batchNum}/${totalBatches} — ${batch.length} students`);

      try {
        const { ok, status, json } = await callInviteAPIBatch(
          apiEndpoint, apiToken,
          batch.map(b => b.studentUid),
          assessmentId,
        );

        if (ok) {
          const failedUids = new Set(
            (json.failed_users_details || []).map(f => String(f.user_id || "").trim()),
          );
          const now = new Date().toISOString();
          const fbBatch = writeBatch(db);

          for (const booking of batch) {
            if (failedUids.has(booking.studentUid)) {
              const reason = (json.failed_users_details || [])
                .find(f => String(f.user_id) === booking.studentUid)?.reason || "Failed";
              broadcast("error", `  ${booking.studentName || booking.studentUid}: ${reason}`);
              fbBatch.update(doc(db, "bookingRows", booking.firestoreId), {
                inviteStatus: "failed", inviteError: reason,
              });
              failed++;
            } else {
              fbBatch.update(doc(db, "bookingRows", booking.firestoreId), {
                inviteStatus: "sent", invitedAt: now, inviteError: null,
              });
              sent++;
            }
          }
          await fbBatch.commit();
          broadcast("success", `  ${batch.length - failedUids.size} sent, ${failedUids.size} failed`);
        } else {
          const errorMsg = json.res_status || `HTTP ${status}`;
          broadcast("error", `  Batch failed: ${errorMsg}`);
          const fbBatch = writeBatch(db);
          for (const booking of batch) {
            fbBatch.update(doc(db, "bookingRows", booking.firestoreId), {
              inviteStatus: "failed", inviteError: errorMsg,
            });
            failed++;
          }
          await fbBatch.commit().catch(() => {});
        }
      } catch (err) {
        broadcast("error", `  Batch error: ${err.message}`);
        const fbBatch = writeBatch(db);
        for (const booking of batch) {
          fbBatch.update(doc(db, "bookingRows", booking.firestoreId), {
            inviteStatus: "failed", inviteError: err.message,
          });
          failed++;
        }
        await fbBatch.commit().catch(() => {});
      }

      await new Promise(r => setTimeout(r, 2000)); // 2s between batches
    }
  }

  await logJob("invite", startMs, { sent, failed });
  broadcast("done", `Invite complete — ${sent} sent, ${failed} failed`, { sent, failed });
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function authenticateServer() {
  const email    = process.env.SERVER_FB_EMAIL;
  const password = process.env.SERVER_FB_PASSWORD;
  if (!email || !password) {
    console.warn("[WARN] SERVER_FB_EMAIL / SERVER_FB_PASSWORD not set.");
    console.warn("       Firestore calls will fail once security rules are deployed.");
    console.warn("       See firestore.rules for setup instructions.");
    return;
  }
  await signInWithEmailAndPassword(fbAuth, email, password);
  console.log(`[AUTH] Signed in to Firebase as: ${email}`);
}

const PORT = process.env.PORT || 3001;
(async () => {
  await authenticateServer();
  app.listen(PORT, () => {
    console.log(`\n🚀 Automation server running at http://localhost:${PORT}`);
    console.log(`   GET  /health    — status check`);
    console.log(`   GET  /status    — job running state`);
    console.log(`   GET  /progress  — SSE progress stream`);
    console.log(`   POST /publish   — run Playwright publish`);
    console.log(`   POST /invite    — run API invites\n`);
  });
})();
