// Runs on config.topin.tech/* in the user's own logged-in tab. Ports the exact
// step sequence from scripts/server.js's publishOneSession() (Playwright) to
// plain DOM queries + dispatched events — no browser automation framework,
// no bot-detection risk, since this is a real user's real browser session.
// Login/OTP is intentionally not handled here: the user is expected to already
// be signed into Topin normally, the same way they'd use it by hand.

// Exit PIN step disabled per request (2026-11-10) — skip straight to
// Save & Next instead. setExitPin() below is kept intact; flip this back to
// true to resume setting it.
const EXIT_PIN_ENABLED = false;

// ── Generic DOM-wait helpers ─────────────────────────────────────────────────

function waitFor(findFn, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      const el = findFn();
      if (el) return resolve(el);
      if (Date.now() - start > timeoutMs) return reject(new Error(`${label} not found within ${Math.round(timeoutMs / 1000)}s.`));
      setTimeout(poll, 200);
    })();
  });
}

function visibleButtons() {
  return Array.from(document.querySelectorAll('button, a, [role="button"]'))
    .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);
}

function findByText(regex) {
  return visibleButtons().find(el => regex.test((el.textContent || el.getAttribute("aria-label") || "").trim()));
}

function debugButtonList() {
  return visibleButtons()
    .map(el => (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60))
    .filter(Boolean).slice(0, 20);
}

async function clickWhenFound(regex, timeoutMs, label) {
  const el = await waitFor(() => findByText(regex), timeoutMs, label);
  el.click();
  return el;
}

function waitForUrlMatch(regex, timeoutMs, label) {
  return waitFor(() => (regex.test(location.href) ? true : null), timeoutMs, label);
}

// React controlled inputs track value changes through their own synthetic
// event system — setting `.value` directly doesn't register. Using the
// native setter before dispatching `input` is the standard workaround.
function setNativeValue(el, value) {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function dispatchEnterKey(el) {
  const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
  el.dispatchEvent(new KeyboardEvent("keydown", opts));
  el.dispatchEvent(new KeyboardEvent("keyup", opts));
}

// ── Date/time helpers (pure functions — ported verbatim from scripts/server.js) ──

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinalSuffix(day) {
  if (day >= 11 && day <= 13) return "th";
  switch (day % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function buildDateButtonName(date) {
  return `Choose ${WEEKDAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}${ordinalSuffix(date.getDate())}, ${date.getFullYear()}`;
}

function formatTimeSlot(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? "PM" : "AM";
  const twelveHour = hours % 12 || 12;
  return `${twelveHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

function parseDateTime(dateStr, timeStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const m = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) throw new Error(`Invalid time format: ${timeStr}`);
  let hour = parseInt(m[1]);
  const min = parseInt(m[2]);
  const period = m[3].toUpperCase();
  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  const d = new Date(year, month - 1, day, hour, min, 0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
  return d;
}

// ── Date/time picker ─────────────────────────────────────────────────────────

async function ensureMonth(picker, targetDate) {
  const targetMonthYear = `${MONTH_NAMES[targetDate.getMonth()]} ${targetDate.getFullYear()}`;
  for (let attempt = 0; attempt < 24; attempt++) {
    const currentEl = picker.querySelector(".react-datepicker__current-month");
    const current = (currentEl?.textContent || "").replace(/\s+/g, " ").trim();
    if (current === targetMonthYear) return;
    const [monthName, yearText] = current.split(" ");
    const currentKey = Number(yearText) * 12 + MONTH_NAMES.indexOf(monthName);
    const targetKey = targetDate.getFullYear() * 12 + targetDate.getMonth();
    const navRegex = currentKey < targetKey ? /^Next Month$/i : /^Previous Month$/i;
    const navBtn = Array.from(picker.querySelectorAll('button, [role="button"]'))
      .find(el => navRegex.test((el.getAttribute("aria-label") || el.textContent || "").trim()));
    if (!navBtn) throw new Error("Date picker month navigation button not found.");
    navBtn.click();
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Unable to navigate date picker to ${targetMonthYear}`);
}

async function setDateTimeField(testId, dateStr, timeStr) {
  const targetDate = parseDateTime(dateStr, timeStr);
  const timeText = formatTimeSlot(targetDate);

  const wrapper = await waitFor(() => document.querySelector(`[data-testid="${testId}"]`), 15000, `Date field ${testId}`);
  const input = wrapper.querySelector('input[placeholder="Select Date & Time"]');
  if (!input) throw new Error(`Date input not found in ${testId}`);
  input.click();

  const picker = await waitFor(() => {
    const all = document.querySelectorAll(".react-datepicker");
    return all.length ? all[all.length - 1] : null;
  }, 10000, "Date picker");

  await ensureMonth(picker, targetDate);

  const dayBtn = Array.from(picker.querySelectorAll('button, [role="button"]'))
    .find(el => (el.getAttribute("aria-label") || el.textContent || "").trim() === buildDateButtonName(targetDate));
  if (!dayBtn) throw new Error(`Date button "${buildDateButtonName(targetDate)}" not found in picker.`);
  dayBtn.click();
  await new Promise(r => setTimeout(r, 300));

  const timeItem = await waitFor(() => {
    const items = Array.from(picker.querySelectorAll(".react-datepicker__time-list-item"));
    return items.find(item => (item.textContent || "").trim() === timeText) || null;
  }, 8000, `Time option "${timeText}"`);
  timeItem.click();
  await new Promise(r => setTimeout(r, 300));
}

// ── Exit PIN ──────────────────────────────────────────────────────────────────

async function ensureInternalAdminOpen() {
  const secureBtn = findByText(/^Enable Secure Browser$/i);
  if (!secureBtn) {
    const adminBtn = await waitFor(() => findByText(/^Internal Admin Options$/i), 10000, "Internal Admin Options");
    adminBtn.click();
    await new Promise(r => setTimeout(r, 300));
  }
}

async function setExitPin(exitPin) {
  await ensureInternalAdminOpen();
  const container = await waitFor(() => document.querySelector('[data-testid="ao-exam-environment-option"]'), 10000, "Exit PIN container");

  let exitInput = container.querySelector('input[placeholder="Custom Exit Password (if any)"]');
  if (!exitInput || exitInput.offsetWidth === 0) {
    const secureBtn = Array.from(container.querySelectorAll('button, [role="button"]'))
      .find(el => /^Enable Secure Browser$/i.test((el.textContent || "").trim()));
    if (secureBtn) secureBtn.click();
    exitInput = await waitFor(
      () => container.querySelector('input[placeholder="Custom Exit Password (if any)"]'),
      8000, "Exit PIN input",
    );
  }

  const yesRadio = container.querySelector('input[data-testid="Yes"]');
  if (yesRadio && !yesRadio.checked) {
    const yesLabel = Array.from(container.querySelectorAll("span")).find(el => (el.textContent || "").trim() === "Yes");
    if (yesLabel) yesLabel.click();
    await new Promise(r => setTimeout(r, 200));
  }

  setNativeValue(exitInput, "");
  setNativeValue(exitInput, exitPin);
}

// ── Assessment link extraction (DOM scan — no clipboard automation needed) ────

function extractAssessmentLink() {
  for (const el of document.querySelectorAll("input")) {
    if (el.value && el.value.includes("org_id=")) return el.value;
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = node.textContent.trim();
    if (t.includes("org_id=") && t.includes("assessment.topin.tech")) return t;
  }
  return null;
}

// ── Main publish sequence (mirrors publishOneSession() in scripts/server.js) ──

async function publishSession(session) {
  if (location.href.includes("accounts.ccbp.in")) {
    throw new Error("Not logged into Topin in this browser — sign in at config.topin.tech first, then retry.");
  }

  // 2. Clone Assessment
  let cloneEl;
  try {
    cloneEl = await waitFor(() => findByText(/clone assessment/i), 90000, "Clone Assessment button");
  } catch (err) {
    throw new Error(`${err.message} Visible buttons: ${JSON.stringify(debugButtonList())}`);
  }
  cloneEl.click();
  await waitForUrlMatch(/create-assessment|edit-assessment/, 30000, "Post-clone navigation");

  // 3. Section Details (only if Topin lands there first)
  if (location.href.includes("create-assessment")) {
    await clickWhenFound(/save\s*&\s*next/i, 60000, "Save & Next (Section Details)");
    await waitForUrlMatch(/edit-assessment/, 30000, "Final Review navigation");
  }
  await waitFor(() => document.querySelector('input[placeholder="Enter Assessment Name"]'), 30000, "Assessment Name field");

  // 4. Assessment Name
  const nameInput = document.querySelector('input[placeholder="Enter Assessment Name"]');
  setNativeValue(nameInput, session.assessmentTitle);

  // 5. Tags
  const tagsInput = document.querySelector('[data-testid="bscd-assess-categories-input"] input');
  if (!tagsInput) throw new Error("Tags input not found.");
  setNativeValue(tagsInput, session.uniqueExamId);
  dispatchEnterKey(tagsInput);
  await new Promise(r => setTimeout(r, 300));

  // 6/7. Start & End Date/Time
  await setDateTimeField("bscd-start-date-time-input", session.dateOfAssessment, session.startTimeSlot);
  await setDateTimeField("bscd-end-date-time-input", session.dateOfAssessment, session.endTimeSlot);

  // 8. Exit PIN — disabled, see EXIT_PIN_ENABLED at the top of this file.
  if (EXIT_PIN_ENABLED) await setExitPin(session.exitPin);

  // 9. Save & Next -> Publish & Invite
  await clickWhenFound(/save\s*&\s*next/i, 30000, "Save & Next (Final Review)");

  // 10. Publish
  const publishEl = await waitFor(() => findByText(/publish assessment/i), 60000, "Publish Assessment button");
  publishEl.click();
  const agreeEl = await waitFor(() => findByText(/^yes,\s*i agree$/i), 15000, '"Yes, I agree" button');
  agreeEl.click();

  await waitFor(() => findByText(/^copy link$/i), 60000, "Copy Link button (publish confirmation)");

  const viewAssessmentUrl = location.href;
  const viewDetailsUrl = viewAssessmentUrl.replace("/view-assessment/", "/view-details/");

  const assessmentLink = extractAssessmentLink();
  if (!assessmentLink) throw new Error("Could not find Assessment Link after publishing.");

  let assessmentId;
  try {
    assessmentId = new URL(assessmentLink).searchParams.get("org_id");
  } catch {
    const m = assessmentLink.match(/org_id=([0-9a-f-]{36})/i);
    assessmentId = m ? m[1] : null;
  }
  if (!assessmentId) throw new Error(`Could not extract org_id from link: ${assessmentLink}`);

  return { assessmentId, assessmentLink, viewAssessmentUrl, viewDetailsUrl };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== "publishSession") return false;
  publishSession(message.session)
    .then(result => sendResponse({ success: true, ...result }))
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true; // keep the message channel open for the async response above
});
