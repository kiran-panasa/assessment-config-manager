import { Router } from "express";
import { chromium } from "playwright";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { db } from "../firebase.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import {
  setupTokenCapture,
  getValidTopinToken,
  getTopinProfile,
  publishSessionDirect,
  findAssessmentByTag,
  buildAssessmentLink,
  buildViewUrls,
} from "../lib/topinClient.js";

const router = Router();

// ── SSE broadcast ─────────────────────────────────────────────────────────────

const clients = new Set();
let jobRunning = false;
let cancelRequested = false;

function broadcast(type, message, extra = {}) {
  const data = JSON.stringify({ type, message, ts: Date.now(), ...extra });
  for (const res of clients) res.write(`data: ${data}\n\n`);
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// ── Cookie / HAR paths ────────────────────────────────────────────────────────

const COOKIES_FILE     = "./topin-session.json";
const NETWORK_LOG_FILE = "./topin-network-log.json";
const HAR_FILE         = "./topin-network.har";

function parseHarToLog() {
  if (!existsSync(HAR_FILE)) return;
  try {
    const har = JSON.parse(readFileSync(HAR_FILE, "utf8"));
    const SKIP = /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|otf|ico|map|webp)(\?|$)/i;
    const entries = (har.log?.entries || [])
      .filter(e => !SKIP.test(e.request.url))
      .map(e => {
        let reqBody = null;
        if (e.request.postData?.text) {
          try { reqBody = JSON.parse(e.request.postData.text); } catch { reqBody = e.request.postData.text; }
        }
        let resBody = null;
        const rawText = e.response.content?.text;
        if (rawText) {
          const decoded = e.response.content?.encoding === "base64"
            ? Buffer.from(rawText, "base64").toString("utf8")
            : rawText;
          try { resBody = JSON.parse(decoded); } catch { resBody = decoded.slice(0, 2000); }
        }
        return {
          timestamp: e.startedDateTime, method: e.request.method,
          url: e.request.url, status: e.response.status,
          mimeType: e.response.content?.mimeType || null,
          requestBody: reqBody, responseBody: resBody,
        };
      });
    writeFileSync(NETWORK_LOG_FILE, JSON.stringify(entries, null, 2));
    broadcast("info", `[INTERCEPTOR] ${entries.length} API call(s) captured`);
  } catch (err) {
    broadcast("error", `[INTERCEPTOR] HAR parse failed: ${err.message}`);
  }
}

async function saveSession(context) {
  try { await context.storageState({ path: COOKIES_FILE }); } catch { /* non-fatal */ }
}

async function tryRestoreSession(context, page) {
  if (!existsSync(COOKIES_FILE)) return false;
  try {
    await page.goto("https://config.topin.tech", { waitUntil: "domcontentloaded", timeout: 20000 });
    const valid = page.url().includes("config.topin.tech") && !page.url().includes("accounts.ccbp.in");
    if (valid) { broadcast("success", "[SESSION] Restored saved session."); return true; }
    broadcast("info", "[SESSION] Saved session expired — falling back to OTP login.");
    return false;
  } catch { return false; }
}

// ── Playwright helpers ────────────────────────────────────────────────────────

const MONTH_NAMES    = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAY_NAMES  = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function ordinalSuffix(d) {
  if (d >= 11 && d <= 13) return "th";
  return ["th","st","nd","rd","th"][Math.min(d % 10, 4)];
}

function buildDateButtonName(date) {
  return `Choose ${WEEKDAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}${ordinalSuffix(date.getDate())}, ${date.getFullYear()}`;
}

function formatTimeSlot(date) {
  const h = date.getHours(), m = date.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2,"0")} ${h >= 12 ? "PM" : "AM"}`;
}

function parseDateTime(dateStr, timeStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const m = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) throw new Error(`Invalid time format: ${timeStr}`);
  let hour = parseInt(m[1]);
  const min = parseInt(m[2]), p = m[3].toUpperCase();
  if (p === "PM" && hour !== 12) hour += 12;
  if (p === "AM" && hour === 12) hour = 0;
  const d = new Date(year, month - 1, day, hour, min, 0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
  return d;
}

async function waitForPageSettled(page, timeout = 15000) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
}

async function ensureMonth(page, targetDate) {
  const picker = page.locator(".react-datepicker").last();
  const targetMonthYear = `${MONTH_NAMES[targetDate.getMonth()]} ${targetDate.getFullYear()}`;
  for (let attempt = 0; attempt < 24; attempt++) {
    const current = ((await picker.locator(".react-datepicker__current-month").textContent()) || "").replace(/\s+/g, " ").trim();
    if (current === targetMonthYear) return;
    const [monthName, yearText] = current.split(" ");
    const currentKey = Number(yearText) * 12 + MONTH_NAMES.indexOf(monthName);
    const targetKey  = targetDate.getFullYear() * 12 + targetDate.getMonth();
    await picker.getByRole("button", { name: currentKey < targetKey ? "Next Month" : "Previous Month" }).click();
    await page.waitForTimeout(200);
  }
  throw new Error(`Could not navigate date picker to ${targetMonthYear}`);
}

async function setDateTimeField(page, testId, dateStr, timeStr) {
  const targetDate = parseDateTime(dateStr, timeStr);
  const timeText = formatTimeSlot(targetDate);
  const wrapper = page.locator(`[data-testid="${testId}"]`);
  await wrapper.locator('input[placeholder="Select Date & Time"]').click();
  await page.locator(".react-datepicker").last().waitFor({ state: "visible" });
  await ensureMonth(page, targetDate);
  await page.locator(".react-datepicker").last().getByRole("button", { name: buildDateButtonName(targetDate) }).click();
  await page.waitForTimeout(300);
  const pickerEl = page.locator(".react-datepicker").last();
  const scrollResult = await pickerEl.evaluate((el, t) => {
    const list = el.querySelector(".react-datepicker__time-list");
    const items = Array.from(el.querySelectorAll(".react-datepicker__time-list-item"));
    const idx = items.findIndex(i => (i.textContent || "").trim() === t);
    if (idx === -1 || !list) return null;
    list.scrollTop = items[idx].offsetTop;
    return { found: true };
  }, timeText);
  if (!scrollResult) throw new Error(`Time option "${timeText}" not found for ${testId}`);
  await page.waitForTimeout(150);
  const timeHandle = await pickerEl.evaluateHandle((el, t) => {
    return Array.from(el.querySelectorAll(".react-datepicker__time-list-item"))
      .find(i => (i.textContent || "").trim() === t) || null;
  }, timeText);
  const el = timeHandle.asElement();
  if (!el) throw new Error(`Time option element not clickable for ${testId}`);
  await el.click();
  await timeHandle.dispose();
  await page.waitForTimeout(300);
}

async function ensureInternalAdminOpen(page) {
  const secureBtn = page.getByRole("button", { name: "Enable Secure Browser" });
  if (!(await secureBtn.isVisible().catch(() => false)))
    await page.getByRole("button", { name: "Internal Admin Options" }).click();
}

async function setExitPin(page, exitPin) {
  await ensureInternalAdminOpen(page);
  const container = page.locator('[data-testid="ao-exam-environment-option"]');
  const exitInput = container.locator('input[placeholder="Custom Exit Password (if any)"]');
  if (!(await exitInput.isVisible().catch(() => false)))
    await container.getByRole("button", { name: "Enable Secure Browser" }).click();
  const yesRadio = container.locator('input[data-testid="Yes"]').first();
  if ((await yesRadio.count()) && !(await yesRadio.isChecked().catch(() => false)))
    await container.locator("span", { hasText: "Yes" }).first().click();
  await exitInput.fill("");
  await exitInput.fill(exitPin);
}

// ── TinyURL helper ────────────────────────────────────────────────────────────

async function createTinyUrl(longUrl) {
  const token = process.env.TINYURL_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch("https://api.tinyurl.com/create", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: longUrl, domain: "tinyurl.com" }),
    });
    const data = await res.json();
    return data?.data?.tiny_url || null;
  } catch { return null; }
}

function deriveUserUrl(assessmentLink) {
  try {
    const u = new URL(assessmentLink);
    u.searchParams.delete("a_t");
    return u.toString();
  } catch { return assessmentLink; }
}

// ── Publish one session ───────────────────────────────────────────────────────

async function publishOneSession(page, session, assessments) {
  const config = assessments.find(a => a.skill === session.skill && a.level === `L${session.level}`);
  if (!config?.url) throw new Error(`No config URL for ${session.skill} - L${session.level}`);

  const viewUrl = config.url.replace("/edit-assessment/", "/view-assessment/");
  broadcast("info", `  Opening: ${viewUrl.slice(0, 80)}`);
  await page.goto(viewUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (page.url().includes("accounts.ccbp.in"))
    throw new Error("Session expired — re-run with a fresh OTP.");

  const cloneLocator = page.locator('button, a, [role="button"]').filter({ hasText: /clone/i }).first();
  try { await cloneLocator.waitFor({ timeout: 90000 }); }
  catch {
    const btns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button,a,[role="button"]'))
        .filter(e => e.offsetWidth > 0).map(e => (e.textContent || "").trim().slice(0, 60)).filter(Boolean).slice(0, 20)
    ).catch(() => []);
    broadcast("info", `  [DEBUG] Buttons: ${JSON.stringify(btns)}`);
    throw new Error("Clone button not found within 90s.");
  }
  await cloneLocator.click();
  await page.waitForURL(/create-assessment|edit-assessment/, { timeout: 30000 });

  if (page.url().includes("create-assessment")) {
    await waitForPageSettled(page);
    await page.locator('button, a, [role="button"]').filter({ hasText: /save\s*&\s*next/i }).first().waitFor({ timeout: 60000 });
    await page.locator('button, a, [role="button"]').filter({ hasText: /save\s*&\s*next/i }).first().click();
    await page.waitForURL(/edit-assessment/, { timeout: 30000 });
  }
  await page.locator('input[placeholder="Enter Assessment Name"]').waitFor({ timeout: 30000 });

  await page.locator('input[placeholder="Enter Assessment Name"]').fill(session.assessmentTitle);

  const tagsInput = page.locator('[data-testid="bscd-assess-categories-input"] input').first();
  await tagsInput.fill(session.uniqueExamId);
  await tagsInput.press("Enter");
  await page.waitForTimeout(300);
  broadcast("info", "  Tags set");

  await setDateTimeField(page, "bscd-start-date-time-input", session.dateOfAssessment, session.startTimeSlot);
  await setDateTimeField(page, "bscd-end-date-time-input",   session.dateOfAssessment, session.endTimeSlot);
  await setExitPin(page, session.exitPin);

  await page.locator('button, a, [role="button"]').filter({ hasText: /save\s*&\s*next/i }).first().click({ timeout: 30000 });

  const publishLocator = page.locator('button, a, [role="button"]').filter({ hasText: /^publish assessment$/i }).first();
  await publishLocator.waitFor({ timeout: 30000 });
  await publishLocator.click();
  await page.getByRole("button", { name: "Yes, I agree" }).click();

  const copyLinkButton = page.getByRole("button", { name: "Copy Link" });
  await copyLinkButton.waitFor({ timeout: 60000 });

  const viewAssessmentUrl = page.url();
  const viewDetailsUrl    = viewAssessmentUrl.replace("/view-assessment/", "/view-details/");
  broadcast("info", `  Published — Config URL: ${viewAssessmentUrl}`);

  let assessmentLink = null;
  try {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://config.topin.tech" });
    await copyLinkButton.click();
    const clip = await page.evaluate(async () => navigator.clipboard.readText());
    if (clip?.includes("assessment.topin.tech")) assessmentLink = clip;
  } catch { /* fall through to DOM scan */ }

  if (!assessmentLink) {
    assessmentLink = await page.evaluate(() => {
      for (const el of document.querySelectorAll("input")) {
        if (el.value?.includes("org_id=")) return el.value;
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim();
        if (t.includes("org_id=") && t.includes("assessment.topin.tech")) return t;
      }
      return null;
    });
  }
  if (!assessmentLink) throw new Error("Could not find Assessment Link after publishing.");

  let assessmentId;
  try { assessmentId = new URL(assessmentLink).searchParams.get("org_id"); }
  catch { assessmentId = assessmentLink.match(/org_id=([0-9a-f-]{36})/i)?.[1] || null; }
  if (!assessmentId) throw new Error(`Could not extract org_id from: ${assessmentLink}`);

  const userUrl = deriveUserUrl(assessmentLink);
  const tinyUrl = await createTinyUrl(userUrl);
  if (tinyUrl) broadcast("info", `  TinyURL: ${tinyUrl}`);
  else broadcast("info", "  TinyURL: skipped (token not set or API error)");

  return { assessmentId, assessmentLink, viewAssessmentUrl, viewDetailsUrl, tinyUrl };
}

// ── Topin login ───────────────────────────────────────────────────────────────

async function loginToTopin(page, mobile, otp) {
  broadcast("info", "Navigating to Topin…");
  await page.goto("https://config.topin.tech/", { waitUntil: "domcontentloaded" });
  await waitForPageSettled(page);
  if (!page.url().includes("accounts.ccbp.in/login")) {
    await page.context().clearCookies();
    await page.goto("https://config.topin.tech/", { waitUntil: "domcontentloaded" });
    await waitForPageSettled(page);
  }
  if (!page.url().includes("accounts.ccbp.in/login"))
    throw new Error(`Could not reach Topin login. URL: ${page.url()}`);

  await page.locator('input[placeholder="Enter Number"]').fill(mobile);
  await page.getByRole("button", { name: "GET OTP" }).click();
  await page.waitForTimeout(2000);

  const digits = otp.replace(/\D/g, "");
  if (digits.length !== 6) throw new Error("OTP must be exactly 6 digits.");
  const otpInputs = page.locator('input[aria-label*="Digit"], input[aria-label*="verification code"]');
  await otpInputs.first().waitFor({ timeout: 10000 });
  for (let i = 0; i < 6; i++) { await otpInputs.nth(i).fill(digits[i]); await page.waitForTimeout(100); }

  await page.getByRole("button", { name: /Verify & Login/i }).click();
  await page.waitForURL(/config\.topin\.tech/, { timeout: 90000 });
  await page.waitForTimeout(5000);
  await waitForPageSettled(page);
  broadcast("success", `Logged in — ${page.url()}`);
}

// ── Firestore helpers (Admin SDK) ─────────────────────────────────────────────

async function fetchPublishData(date) {
  let sessionsRef = db.collection("examSessions");
  if (date) sessionsRef = sessionsRef.where("dateOfAssessment", "==", date);
  const [assessmentsSnap, sessionsSnap] = await Promise.all([
    db.collection("assessments").get(),
    sessionsRef.get(),
  ]);
  const assessments = assessmentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const sessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.publishStatus !== "published");
  return { assessments, sessions };
}

async function fetchInviteData(date) {
  let bookingsRef = db.collection("bookingRows");
  if (date) bookingsRef = bookingsRef.where("contestDate", "==", date);
  const [bookingsSnap, sessionsSnap] = await Promise.all([
    bookingsRef.get(),
    db.collection("examSessions").where("publishStatus", "==", "published").get(),
  ]);
  const bookings = bookingsSnap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  const sessionMap = new Map();
  sessionsSnap.docs.forEach(d => {
    const s = d.data();
    if (s.sessionKey && s.topinAssessmentId) sessionMap.set(s.sessionKey, s.topinAssessmentId);
  });
  return { bookings, sessionMap };
}

async function logJob(type, startMs, stats) {
  const durationMinutes = parseFloat(((Date.now() - startMs) / 60000).toFixed(2));
  await db.collection("jobLogs").add({
    type, durationMinutes,
    month: new Date().toISOString().slice(0, 7),
    loggedAt: new Date().toISOString(),
    ...stats,
  }).catch(() => {});
}

// ── Main publish loop ─────────────────────────────────────────────────────────

async function runPublishDirect(accessToken, sessions, assessments, date) {
  broadcast("info", "[DIRECT API] Publishing without browser…");
  const { user_id, org_id } = await getTopinProfile(accessToken);

  let passed = 0, failed = 0;
  for (const session of sessions) {
    if (cancelRequested) { broadcast("warn", "Cancelled."); break; }
    const num = passed + failed + 1;
    broadcast("info", `\n[${num}/${sessions.length}] ${session.assessmentTitle} — ${session.dateOfAssessment} ${session.startTimeSlot}`);

    try {
      const config = assessments.find(a => a.skill === session.skill && a.level === `L${session.level}`);
      if (!config?.url) throw new Error(`No config URL for ${session.skill} - L${session.level}`);

      broadcast("info", "  Calling Topin publish API…");
      await publishSessionDirect(accessToken, session, config.url);

      broadcast("info", `  Waiting for GraphQL confirmation (uniqueExamId: ${session.uniqueExamId})…`);
      const result = await findAssessmentByTag(accessToken, user_id, org_id, session.uniqueExamId);

      if (!result) throw new Error("Assessment not found in GraphQL after 30s — publish may have failed");

      const assessmentId  = result.published_assess_id;
      const assessmentLink = buildAssessmentLink(assessmentId);
      const { viewAssessmentUrl, viewDetailsUrl } = buildViewUrls(result.id);

      const userUrl = assessmentLink.replace(/[?&]a_t=CLIENT/g, "").replace(/\?$/, "");
      const tinyUrl = await createTinyUrl(userUrl);
      if (tinyUrl) broadcast("info", `  TinyURL: ${tinyUrl}`);

      await db.collection("examSessions").doc(session.id).update({
        topinAssessmentId: assessmentId, assessmentLink,
        viewAssessmentUrl, viewDetailsUrl,
        tinyUrl: tinyUrl || null,
        publishStatus: "published", publishedAt: new Date().toISOString(),
        publishError: null,
      });
      broadcast("success", `  Done — Assessment ID: ${assessmentId}`);
      passed++;
    } catch (err) {
      broadcast("error", `  Failed: ${err.message}`);
      await db.collection("examSessions").doc(session.id).update({ publishStatus: "failed", publishError: err.message }).catch(() => {});
      failed++;
    }
  }
  return { passed, failed };
}

async function runPublish(mobile, otp, date) {
  const startMs = Date.now();
  cancelRequested = false;
  broadcast("info", "Fetching sessions from Firestore…");
  const { assessments, sessions } = await fetchPublishData(date);
  if (sessions.length === 0) {
    broadcast("success", "All sessions already published. Nothing to do.");
    broadcast("done", "Publish complete — 0 sessions", { passed: 0, failed: 0 });
    return;
  }
  broadcast("info", `${sessions.length} unpublished session(s)${date ? ` for ${date}` : ""}`);

  // ── Try direct API path first (no browser needed) ────────────────────────
  const storedToken = await getValidTopinToken(broadcast);
  if (storedToken) {
    broadcast("info", "[AUTH] Using stored token — no browser required.");
    let passed = 0, failed = 0;
    try {
      ({ passed, failed } = await runPublishDirect(storedToken, sessions, assessments, date));
    } catch (err) {
      broadcast("error", `Direct API fatal error: ${err.message}`);
      broadcast("warn", "Falling back to browser mode…");
      // fall through to Playwright below
    }
    if (passed + failed === sessions.length) {
      await logJob("publish", startMs, { passed, failed, mode: "direct" });
      broadcast("done", `Publish complete — ${passed} published, ${failed} failed`, { passed, failed });
      return;
    }
  } else {
    broadcast("info", "[AUTH] No stored token — launching browser for OTP login…");
  }

  // ── Playwright fallback (OTP login + browser automation) ─────────────────
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu"] });

  let sessionRestored = false;
  if (existsSync(COOKIES_FILE)) {
    const checkCtx = await browser.newContext({ storageState: COOKIES_FILE, userAgent: UA });
    const checkPage = await checkCtx.newPage();
    await checkPage.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
    sessionRestored = await tryRestoreSession(checkCtx, checkPage);
    await checkCtx.close();
  }

  const context = await browser.newContext({
    recordHar: { path: HAR_FILE }, userAgent: UA,
    ...(sessionRestored ? { storageState: COOKIES_FILE } : {}),
  });

  // Capture tokens from this login so future runs skip the browser
  setupTokenCapture(context, broadcast);

  const page = await context.newPage();
  await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  page.setDefaultTimeout(30000);

  let passed = 0, failed = 0;
  try {
    if (!sessionRestored) { await loginToTopin(page, mobile, otp); await saveSession(context); }
    for (const session of sessions) {
      if (cancelRequested) { broadcast("warn", "Cancelled."); break; }
      const num = passed + failed + 1;
      broadcast("info", `\n[${num}/${sessions.length}] ${session.assessmentTitle} — ${session.dateOfAssessment} ${session.startTimeSlot}`);
      try {
        const { assessmentId, assessmentLink, viewAssessmentUrl, viewDetailsUrl, tinyUrl } = await publishOneSession(page, session, assessments);
        await db.collection("examSessions").doc(session.id).update({
          topinAssessmentId: assessmentId, assessmentLink,
          viewAssessmentUrl, viewDetailsUrl,
          tinyUrl: tinyUrl || null,
          publishStatus: "published", publishedAt: new Date().toISOString(),
          publishError: null,
        });
        broadcast("success", `  Assessment ID: ${assessmentId}`);
        passed++;
      } catch (err) {
        broadcast("error", `  Failed: ${err.message}`);
        await db.collection("examSessions").doc(session.id).update({ publishStatus: "failed", publishError: err.message }).catch(() => {});
        failed++;
      }
      await page.waitForTimeout(200);
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    parseHarToLog();
  }
  await logJob("publish", startMs, { passed, failed, mode: "browser" });
  broadcast("done", `Publish complete — ${passed} published, ${failed} failed`, { passed, failed });
}

// ── Main invite loop ──────────────────────────────────────────────────────────

const INVITE_BATCH_SIZE = 20;

async function callInviteAPIBatch(endpoint, apiKey, studentUids, assessmentId) {
  const payload = { candidate_user_ids: studentUids, assessment_id: assessmentId };
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text().catch(() => "");
      let json = {};
      try { json = JSON.parse(text); } catch { /* non-JSON */ }
      if (res.ok || res.status < 500) return { ok: res.ok, status: res.status, json };
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) { lastErr = err; }
    if (attempt < 3) await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)));
  }
  throw lastErr;
}

async function runInvite(apiEndpoint, apiToken, date) {
  const startMs = Date.now();
  cancelRequested = false;
  broadcast("info", "Fetching bookings from Firestore…");
  const { bookings, sessionMap } = await fetchInviteData(date);

  const toInvite = bookings.filter(b => b.inviteStatus !== "sent" && b.sessionKey && sessionMap.has(b.sessionKey));
  const blocked  = bookings.filter(b => b.inviteStatus !== "sent" && b.sessionKey && !sessionMap.has(b.sessionKey));
  if (blocked.length) broadcast("warn", `${blocked.length} student(s) skipped — session not published`);
  if (toInvite.length === 0) {
    broadcast("success", "All eligible students already invited.");
    broadcast("done", "Invite complete — 0 invites", { sent: 0, failed: 0 });
    return;
  }

  const groups = new Map();
  for (const b of toInvite) {
    const aid = sessionMap.get(b.sessionKey);
    if (!groups.has(aid)) groups.set(aid, []);
    groups.get(aid).push(b);
  }
  broadcast("info", `Sending ${toInvite.length} invite(s) across ${groups.size} assessment(s)…`);

  let sent = 0, failed = 0;
  for (const [assessmentId, students] of groups) {
    const totalBatches = Math.ceil(students.length / INVITE_BATCH_SIZE);
    for (let i = 0; i < students.length; i += INVITE_BATCH_SIZE) {
      if (cancelRequested) { broadcast("warn", "Cancelled."); break; }
      const batch = students.slice(i, i + INVITE_BATCH_SIZE);
      broadcast("info", `Batch ${Math.floor(i/INVITE_BATCH_SIZE)+1}/${totalBatches} — ${batch.length} students`);
      try {
        const { ok, status, json } = await callInviteAPIBatch(apiEndpoint, apiToken, batch.map(b => b.studentUid), assessmentId);
        if (ok) {
          const failedUids = new Set((json.failed_users_details || []).map(f => String(f.user_id || "").trim()));
          const now = new Date().toISOString();
          const fbBatch = db.batch();
          for (const b of batch) {
            if (failedUids.has(b.studentUid)) {
              const reason = (json.failed_users_details || []).find(f => String(f.user_id) === b.studentUid)?.reason || "Failed";
              fbBatch.update(db.collection("bookingRows").doc(b.firestoreId), { inviteStatus: "failed", inviteError: reason });
              failed++;
            } else {
              fbBatch.update(db.collection("bookingRows").doc(b.firestoreId), { inviteStatus: "sent", invitedAt: now, inviteError: null });
              sent++;
            }
          }
          await fbBatch.commit();
        } else {
          const errorMsg = json.res_status || `HTTP ${status}`;
          broadcast("error", `  Batch failed: ${errorMsg}`);
          const fbBatch = db.batch();
          for (const b of batch) { fbBatch.update(db.collection("bookingRows").doc(b.firestoreId), { inviteStatus: "failed", inviteError: errorMsg }); failed++; }
          await fbBatch.commit().catch(() => {});
        }
      } catch (err) {
        broadcast("error", `  Batch error: ${err.message}`);
        const fbBatch = db.batch();
        for (const b of batch) { fbBatch.update(db.collection("bookingRows").doc(b.firestoreId), { inviteStatus: "failed", inviteError: err.message }); failed++; }
        await fbBatch.commit().catch(() => {});
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  await logJob("invite", startMs, { sent, failed });
  broadcast("done", `Invite complete — ${sent} sent, ${failed} failed`, { sent, failed });
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get("/health", (_req, res) => res.json({ status: "ok", jobRunning }));
router.get("/status", (_req, res) => res.json({ jobRunning }));

// SSE progress stream — no auth required (read-only, non-sensitive log messages)
router.get("/progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

router.get("/network-log", requireAuth, requireAdmin, (_req, res) => {
  if (!existsSync(NETWORK_LOG_FILE)) return res.status(404).json({ error: "No log yet." });
  try {
    const entries = JSON.parse(readFileSync(NETWORK_LOG_FILE, "utf8"));
    res.json({ count: entries.length, entries });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/run", requireAuth, requireAdmin, async (req, res) => {
  if (jobRunning) return res.status(409).json({ error: "A job is already running." });
  const { mobile, otp, date } = req.body;
  if (!mobile || !otp) return res.status(400).json({ error: "mobile and otp required" });
  jobRunning = true;
  res.json({ started: true });
  await new Promise(r => setTimeout(r, 400));
  runPublish(mobile, otp, date || null)
    .catch(err => broadcast("error", `Fatal: ${err.message}`))
    .finally(() => { jobRunning = false; });
});

router.post("/invite", requireAuth, requireAdmin, async (req, res) => {
  if (jobRunning) return res.status(409).json({ error: "A job is already running." });
  const { apiEndpoint, apiToken, date } = req.body;
  if (!apiEndpoint || !apiToken) return res.status(400).json({ error: "apiEndpoint and apiToken required" });
  jobRunning = true;
  res.json({ started: true });
  await new Promise(r => setTimeout(r, 400));
  runInvite(apiEndpoint, apiToken, date || null)
    .catch(err => broadcast("error", `Fatal: ${err.message}`))
    .finally(() => { jobRunning = false; });
});

router.post("/cancel", requireAuth, requireAdmin, (_req, res) => {
  if (jobRunning) { cancelRequested = true; broadcast("warn", "Cancel requested…"); }
  res.json({ ok: true });
});

export default router;
