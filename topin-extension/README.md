# Topin Assessment Publisher — browser extension

Publishes assessment sessions to Topin the same way `scripts/server.js` /
`server/src/routes/publish.js` already do — but runs inside your own
logged-in Chrome tab instead of a Playwright-driven headless browser, so:

- **No server to start** — install once, use whenever you need to publish.
- **No bot-detection risk** — it's your real, already-logged-in Topin
  session, not an automated browser Topin's own code has previously
  detected and blocked (see the `--disable-blink-features=AutomationControlled`
  workarounds in `scripts/server.js` — this sidesteps that entirely).
- **No OTP automation needed** — you're expected to already be signed into
  `config.topin.tech` normally, the same way you'd use it by hand.

This does **not** change `scripts/server.js` or `server/src/routes/publish.js`
— those still exist and work exactly as before. This is a separate, additive
way to do the same job.

## Install (one-time, per person who publishes assessments)

1. Open Chrome, go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this `topin-extension/` folder.
5. Pin the extension (puzzle-piece icon in the toolbar → pin) for easy access.

The `dist/` folder is already built and committed — no `npm install` or build
step needed to use it. (If you're changing the source, see **Developing**
below.)

## Use it

1. Make sure you're logged into `config.topin.tech` in this browser, same as
   normal.
2. Click the extension icon → sign in with your assessment-config-manager
   email/password (same account you use on the main app).
3. Click **Open Publisher** — opens a new tab.
4. Optionally pick an Assessment Date (leave blank for all unpublished
   sessions), click **Start Publishing**.
5. Watch the live log. Each session gets cloned, filled in, and published on
   Topin exactly like the existing automation does, and `examSessions` in
   Firestore gets updated the same way (`publishStatus`, `assessmentLink`,
   `topinAssessmentId`, etc.) — the rest of the app (stats, Student Bookings,
   Invite Students) sees published sessions exactly as before.

You can close the tab and come back later — sign-in is remembered.

## How it works

- `popup.html`/`popup.js` — sign-in screen, opens the runner tab.
- `runner.html`/`runner.js` — the orchestration page. Reads unpublished
  sessions from Firestore (same query as `scripts/server.js`'s
  `fetchPublishData()`), opens/reuses one Topin tab, and for each session
  sends a message to the content script and waits for the result.
- `src/content-topin.js` — the content script injected into
  `config.topin.tech/*`. Ports the exact step sequence from
  `publishOneSession()` in `scripts/server.js` (Clone → Assessment Name →
  Tags → Start/End Date & Time → Exit PIN → Save & Next → Publish → extract
  the assessment link) to plain DOM queries and dispatched events instead of
  Playwright locators.

No background service worker is used, deliberately — MV3 service workers can
be killed by Chrome after ~30s of inactivity, which doesn't suit a multi-minute
publish run. Keeping the orchestration in a normal tab (`runner.html`) avoids
that entirely.

## Developing

If you change anything in `src/popup.js` or `src/runner.js` (both bundle the
Firebase SDK), rebuild before testing:

```
cd topin-extension
npm install
npm run build
```

Then go to `chrome://extensions` and click the refresh icon on this
extension's card. `src/content-topin.js` needs no build step — it has no
imports — just refresh the extension and reload the Topin tab.
