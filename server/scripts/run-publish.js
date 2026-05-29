/**
 * Local Playwright publish runner.
 *
 * Usage:
 *   node scripts/run-publish.js --mobile=9XXXXXXXXX --otp=123456 [--date=2026-05-31]
 *
 * The browser opens visually (HEADLESS=false by default locally).
 * Results are written to Firestore. Auth tokens are saved so Northflank
 * can use the direct API path on all future runs without a browser.
 */

import "dotenv/config";
import { runPublish } from "../src/routes/publish.js";

// ── Parse CLI args ─────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith("--"))
    .map(a => {
      const [k, ...v] = a.slice(2).split("=");
      return [k, v.join("=")];
    })
);

const { mobile, otp, date } = args;

if (!mobile || !otp) {
  console.error("Usage: node scripts/run-publish.js --mobile=9XXXXXXXXX --otp=123456 [--date=2026-05-31]");
  process.exit(1);
}

// Show browser visually when running locally
process.env.HEADLESS = "false";

console.log(`\n🚀 Starting local publish`);
console.log(`   Mobile : ${mobile}`);
console.log(`   Date   : ${date || "all unpublished"}`);
console.log(`   Browser: visible (HEADLESS=false)\n`);

runPublish(mobile, otp, date || null)
  .then(() => {
    console.log("\n✅ Publish complete. Tokens saved — Northflank will use direct API from now on.");
    process.exit(0);
  })
  .catch(err => {
    console.error("\n❌ Fatal error:", err.message);
    process.exit(1);
  });
