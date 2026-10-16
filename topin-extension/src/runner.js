import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  browserLocalPersistence, setPersistence,
} from "firebase/auth";
import {
  getFirestore, collection, getDocs, query, where, doc, updateDoc,
} from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

const authGate   = document.getElementById("authGate");
const mainDiv    = document.getElementById("main");
const logEl      = document.getElementById("log");
const startBtn   = document.getElementById("startBtn");
const cancelBtn  = document.getElementById("cancelBtn");
const dateInput  = document.getElementById("date");
const statTotal  = document.getElementById("statTotal");
const statPassed = document.getElementById("statPassed");
const statFailed = document.getElementById("statFailed");

let cancelRequested = false;

function log(type, message) {
  const line = document.createElement("div");
  line.className = `l-${type}`;
  line.textContent = message;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// ── Auth gate (same as popup.js, so this page works even opened directly) ──────

onAuthStateChanged(auth, (user) => {
  if (user) {
    authGate.style.display = "none";
    mainDiv.style.display = "block";
  } else {
    authGate.style.display = "block";
    mainDiv.style.display = "none";
  }
});

document.getElementById("authSignIn").addEventListener("click", async () => {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const errorDiv = document.getElementById("authError");
  errorDiv.textContent = "";
  if (!email || !password) { errorDiv.textContent = "Enter email and password."; return; }
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errorDiv.textContent = err.message || "Sign in failed.";
  }
});

// ── Firestore fetch — same contract as scripts/server.js's fetchPublishData() ──

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

// ── Tab + content-script messaging ──────────────────────────────────────────

let workingTabId = null;

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function openOrNavigate(url) {
  if (workingTabId === null) {
    const tab = await chrome.tabs.create({ url });
    workingTabId = tab.id;
  } else {
    await chrome.tabs.update(workingTabId, { url });
  }
  await waitForTabComplete(workingTabId);
}

// Content script may not have finished injecting the instant the tab reports
// "complete" — retry a few times before giving up, same tolerance the Clone
// button wait already has on the Topin-SPA side.
async function sendToContentScript(message, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await chrome.tabs.sendMessage(workingTabId, message);
    } catch (err) {
      if (i === retries - 1) throw new Error(`Could not reach the Topin tab: ${err.message}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// ── Main publish loop ────────────────────────────────────────────────────────

async function runPublish(date) {
  cancelRequested = false;
  startBtn.disabled = true;
  cancelBtn.disabled = false;
  logEl.innerHTML = "";
  statTotal.textContent = "0";
  statPassed.textContent = "0";
  statFailed.textContent = "0";

  log("info", "Fetching sessions from Firestore…");
  let assessments, sessions;
  try {
    ({ assessments, sessions } = await fetchPublishData(date));
  } catch (err) {
    log("error", `Failed to fetch from Firestore: ${err.message}`);
    startBtn.disabled = false;
    cancelBtn.disabled = true;
    return;
  }

  if (sessions.length === 0) {
    log("success", "All sessions are already published. Nothing to do.");
    startBtn.disabled = false;
    cancelBtn.disabled = true;
    return;
  }

  statTotal.textContent = String(sessions.length);
  log("info", `Found ${sessions.length} unpublished session(s)${date ? ` for ${date}` : ""}`);

  let passed = 0, failed = 0;

  for (const session of sessions) {
    if (cancelRequested) { log("warn", "Cancelled."); break; }

    const num = passed + failed + 1;
    log("info", `\n[${num}/${sessions.length}] ${session.assessmentTitle} — ${session.dateOfAssessment} ${session.startTimeSlot}`);

    try {
      const config = assessments.find(a => a.skill === session.skill && a.level === `L${session.level}`);
      if (!config?.url) throw new Error(`No config URL for ${session.skill} - L${session.level}`);

      const viewUrl = config.url.replace("/edit-assessment/", "/view-assessment/");
      log("info", `  Opening: ${viewUrl.slice(0, 100)}`);
      await openOrNavigate(viewUrl);

      const result = await sendToContentScript({ action: "publishSession", session }, 8);
      if (!result?.success) throw new Error(result?.error || "Unknown content-script error");

      const { assessmentId, assessmentLink, viewAssessmentUrl, viewDetailsUrl } = result;

      await updateDoc(doc(db, "examSessions", session.id), {
        topinAssessmentId: assessmentId,
        assessmentLink,
        viewAssessmentUrl,
        viewDetailsUrl,
        publishStatus: "published",
        publishedAt: new Date().toISOString(),
      });
      log("success", `  Assessment ID: ${assessmentId}`);
      passed++;
    } catch (err) {
      log("error", `  Failed: ${err.message}`);
      await updateDoc(doc(db, "examSessions", session.id), {
        publishStatus: "failed",
        publishError: err.message,
      }).catch(() => {});
      failed++;
    }

    statPassed.textContent = String(passed);
    statFailed.textContent = String(failed);
  }

  log("info", `\nDone — ${passed} passed, ${failed} failed.`);
  startBtn.disabled = false;
  cancelBtn.disabled = true;
}

startBtn.addEventListener("click", () => runPublish(dateInput.value || null));
cancelBtn.addEventListener("click", () => { cancelRequested = true; });
