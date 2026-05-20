/**
 * publish-sessions.js
 *
 * For each unpublished row in the "Unique Assessments" table this script:
 *   1. Logs in to Topin with mobile + OTP
 *   2. Opens the matching Assessment Config URL
 *   3. Clones the assessment
 *   4. Fills in Title, Date, Start Time, End Time, EXIT PIN
 *   5. Publishes it
 *   6. Extracts the Assessment ID (org_id) from the Assessment Link URL
 *   7. Writes the Assessment ID + "published" status back to Firestore
 *
 * HOW TO RUN
 *   cd scripts
 *   npm install
 *   npx playwright install chromium
 *   node publish-sessions.js
 *
 * ⚠ IMPORTANT: Adjust the TODO selectors below to match the actual Topin UI.
 *   Run with headless: false first so you can see what the browser is doing.
 */

import { chromium } from "playwright";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";
import * as config from "./config.js";

// ── Validate config ───────────────────────────────────────────────────────────

function validateConfig() {
  const checks = [
    [config.TOPIN_MOBILE,    "TOPIN_MOBILE"],
    [config.TOPIN_OTP,       "TOPIN_OTP"],
    [config.TOPIN_LOGIN_URL, "TOPIN_LOGIN_URL"],
  ];
  const missing = checks.filter(([v]) => typeof v !== "string" || v.startsWith("ENTER_")).map(([, k]) => k);
  if (missing.length) {
    console.error("❌ Missing values in config.js:", missing.join(", "));
    console.error("   Copy config.example.js → config.js and fill in the values.");
    process.exit(1);
  }
}

// ── Firebase ──────────────────────────────────────────────────────────────────

async function fetchFirestoreData() {
  const app = initializeApp(config.FIREBASE_CONFIG, "publish-script");
  const db  = getFirestore(app);

  const [assessmentsSnap, sessionsSnap] = await Promise.all([
    getDocs(collection(db, "assessments")),
    getDocs(collection(db, "examSessions")),
  ]);

  const assessments = assessmentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Only process sessions that are not yet published
  const sessions = sessionsSnap.docs
    .map(d => ({ id: d.id, db, ...d.data() }))
    .filter(s => s.publishStatus !== "published");

  return { assessments, sessions };
}

// ── Time helper ───────────────────────────────────────────────────────────────

function to24Hr(timeStr) {
  // "4:00 PM" → "16:00"  |  "10:30 AM" → "10:30"
  const m = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return timeStr;
  let h = parseInt(m[1]);
  const mins = m[2], period = m[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${mins}`;
}

// ── Topin login ───────────────────────────────────────────────────────────────

async function loginToTopin(page) {
  console.log("🔐 Navigating to Topin login...");
  await page.goto(config.TOPIN_LOGIN_URL, { waitUntil: "networkidle" });

  // ── TODO: adjust these selectors to match the actual Topin login page ──────
  // Enter mobile number
  await page.waitForSelector(
    'input[type="tel"], input[name*="mobile" i], input[placeholder*="mobile" i], input[placeholder*="phone" i]',
    { timeout: 15000 },
  );
  await page.fill(
    'input[type="tel"], input[name*="mobile" i], input[placeholder*="mobile" i], input[placeholder*="phone" i]',
    config.TOPIN_MOBILE,
  );

  // Click "Send OTP" / "Get OTP"
  await page.click(
    'button:has-text("Send OTP"), button:has-text("Get OTP"), button:has-text("Request OTP"), button:has-text("Continue")',
  );
  await page.waitForTimeout(2000);

  // Enter OTP
  await page.waitForSelector(
    'input[name*="otp" i], input[placeholder*="otp" i], input[placeholder*="code" i]',
    { timeout: 15000 },
  );
  await page.fill(
    'input[name*="otp" i], input[placeholder*="otp" i], input[placeholder*="code" i]',
    config.TOPIN_OTP,
  );

  // Click "Verify" / "Login" / "Submit"
  await page.click(
    'button:has-text("Verify"), button:has-text("Login"), button:has-text("Submit"), button[type="submit"]',
  );
  await page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {});
  // ─────────────────────────────────────────────────────────────────────────

  console.log("✅ Logged in to Topin");
}

// ── Publish one session ───────────────────────────────────────────────────────

async function publishSession(page, session, assessments) {
  // Find matching Assessment Config by skill + level
  const asmtConfig = assessments.find(
    a => a.skill === session.skill && a.level === `L${session.level}`,
  );
  if (!asmtConfig?.url) {
    throw new Error(`No config URL found for ${session.skill} - L${session.level}`);
  }

  console.log(`  ↗ Opening config URL...`);
  await page.goto(asmtConfig.url, { waitUntil: "networkidle" });

  // ── TODO: adjust selectors to match the Topin "Clone" button/option ────────
  await page.click(
    'button:has-text("Clone"), button:has-text("Duplicate"), a:has-text("Clone"), [data-action="clone"]',
  );
  await page.waitForNavigation({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1500);
  console.log(`  ✅ Cloned`);

  // Fill Assessment Title
  // TODO: adjust selector
  await page.fill(
    'input[name*="title" i], input[name*="name" i], input[placeholder*="title" i], input[placeholder*="assessment name" i]',
    session.assessmentTitle,
  );

  // Fill Date (expects YYYY-MM-DD for HTML date inputs)
  // TODO: adjust selector — some date pickers need different handling
  await page.fill(
    'input[type="date"], input[name*="date" i]',
    session.dateOfAssessment,
  );

  // Fill Start Time (convert "4:00 PM" → "16:00" for HTML time inputs)
  // TODO: adjust selector
  await page.fill(
    'input[name*="start" i], input[placeholder*="start time" i]',
    to24Hr(session.startTimeSlot),
  );

  // Fill End Time
  // TODO: adjust selector
  await page.fill(
    'input[name*="end" i], input[placeholder*="end time" i]',
    to24Hr(session.endTimeSlot),
  );

  // Fill EXIT PIN
  // TODO: adjust selector
  await page.fill(
    'input[name*="pin" i], input[name*="exit" i], input[placeholder*="pin" i]',
    session.exitPin,
  );

  // Publish the assessment
  // TODO: adjust selector
  await page.click(
    'button:has-text("Publish"), button:has-text("Save & Publish"), button[type="submit"]:has-text("Publish")',
  );
  await page.waitForTimeout(2500);
  console.log(`  ✅ Published`);

  // ── Extract Assessment ID from Assessment Link ─────────────────────────────
  // The link looks like:
  //   https://assessment.topin.tech/assessment?org_id=<UUID>&auto_redirect=1
  // org_id is the Assessment ID needed for the invite API.
  //
  // TODO: adjust selector to find the element containing the Assessment Link URL
  const linkEl = await page.$(
    'a[href*="org_id"], input[value*="org_id"], [class*="assessment-link"] a, [class*="share"] a[href*="assessment.topin"]',
  );
  if (!linkEl) {
    throw new Error(
      'Could not find Assessment Link on the page after publishing. ' +
      'Check that the assessment published successfully and adjust the selector.',
    );
  }

  const href = (await linkEl.getAttribute("href")) || (await linkEl.getAttribute("value")) || "";
  const url  = new URL(href);
  const assessmentId = url.searchParams.get("org_id");

  if (!assessmentId) {
    throw new Error(`Could not extract org_id from URL: ${href}`);
  }

  return assessmentId;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  validateConfig();

  console.log("📡 Fetching data from Firestore...");
  const { assessments, sessions } = await fetchFirestoreData();

  if (sessions.length === 0) {
    console.log("✅ All sessions are already published. Nothing to do.");
    process.exit(0);
  }

  console.log(`\n📋 ${sessions.length} unpublished session(s) found:`);
  sessions.forEach((s, i) =>
    console.log(`   ${i + 1}. ${s.assessmentTitle} — ${s.dateOfAssessment} ${s.startTimeSlot}`),
  );
  console.log("\nStarting browser (headless: false — you will see the window)...\n");

  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const page    = await browser.newPage();
  page.setDefaultTimeout(20000);

  let passed = 0, failed = 0;

  try {
    await loginToTopin(page);

    for (const session of sessions) {
      const num = passed + failed + 1;
      console.log(`\n[${num}/${sessions.length}] ${session.assessmentTitle} — ${session.dateOfAssessment} ${session.startTimeSlot}`);

      const { id, db } = session;

      try {
        const assessmentId = await publishSession(page, session, assessments);

        await updateDoc(doc(db, "examSessions", id), {
          topinAssessmentId: assessmentId,
          publishStatus:     "published",
          publishedAt:       new Date().toISOString(),
        });

        console.log(`  🆔 Assessment ID: ${assessmentId}`);
        passed++;
      } catch (err) {
        console.error(`  ❌ Failed: ${err.message}`);
        await updateDoc(doc(db, "examSessions", id), {
          publishStatus: "failed",
          publishError:  err.message,
        }).catch(() => {});
        failed++;
        // Continue to next session instead of aborting
      }

      await page.waitForTimeout(800);
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`✅ Published: ${passed}   ❌ Failed: ${failed}`);
  if (failed > 0) {
    console.log(`\nRe-run the script to retry failed sessions.`);
    console.log(`Check the Publish Status column in the app (Unique Assessments tab).`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("\n💥 Fatal error:", err.message);
  process.exit(1);
});
