import { db } from "../firebase";
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, writeBatch, arrayUnion, arrayRemove, onSnapshot,
} from "firebase/firestore";

function cutoffDate() {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getMyProfile(uid) {
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) return null;
  const profile = { id: userSnap.id, ...userSnap.data() };
  let pages = [];
  if (profile.role) {
    const roleSnap = await getDoc(doc(db, "roles", profile.role));
    if (roleSnap.exists()) pages = roleSnap.data().pages || [];
  }
  return { profile, pages };
}

export async function createUserProfile(uid, data) {
  const existing = await getDoc(doc(db, "users", uid));
  if (existing.exists()) return { created: false, status: existing.data().status };
  await setDoc(doc(db, "users", uid), data);
  return { created: true, status: data.status };
}

export async function getAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateUser(id, data) {
  await updateDoc(doc(db, "users", id), data);
}

export async function deleteUser(id) {
  await deleteDoc(doc(db, "users", id));
}

// ── Roles ─────────────────────────────────────────────────────────────────────

export async function getAllRoles() {
  const snap = await getDocs(collection(db, "roles"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createRole(key, name, pages) {
  await setDoc(doc(db, "roles", key), {
    key, name, pages: pages || [],
    createdAt: new Date().toISOString(),
  });
}

export async function updateRole(id, data) {
  await updateDoc(doc(db, "roles", id), data);
}

export async function deleteRole(id) {
  const snap = await getDoc(doc(db, "roles", id));
  if (snap.exists() && snap.data().isSystem) throw new Error("Cannot delete a system role");
  await deleteDoc(doc(db, "roles", id));
}

// ── Assessments ───────────────────────────────────────────────────────────────

export async function getAssessments() {
  const snap = await getDocs(collection(db, "assessments"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createAssessment(data) {
  const ref = await addDoc(collection(db, "assessments"), data);
  return ref.id;
}

export async function updateAssessment(id, data) {
  await updateDoc(doc(db, "assessments", id), data);
}

export async function deleteAssessment(id) {
  await deleteDoc(doc(db, "assessments", id));
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function getConfig() {
  const snap = await getDoc(doc(db, "config", "main"));
  if (!snap.exists()) return { skills: [], levels: [] };
  const d = snap.data();
  return { skills: d.skills || [], levels: d.levels || [] };
}

export async function addSkill(skill) {
  await updateDoc(doc(db, "config", "main"), { skills: arrayUnion(skill.trim()) });
}

export async function removeSkill(skill) {
  await updateDoc(doc(db, "config", "main"), { skills: arrayRemove(skill) });
}

export async function addLevel(level) {
  await updateDoc(doc(db, "config", "main"), { levels: arrayUnion(level.trim().toUpperCase()) });
}

export async function removeLevel(level) {
  await updateDoc(doc(db, "config", "main"), { levels: arrayRemove(level) });
}

// ── Bookings ──────────────────────────────────────────────────────────────────

export async function getBookings() {
  const q = query(
    collection(db, "bookingRows"),
    where("contestDate", ">=", cutoffDate()),
    orderBy("contestDate", "asc"),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function bulkSaveBookings(bookingOps, newSessions, batchId) {
  const now = new Date().toISOString();
  const CHUNK = 499;

  for (let i = 0; i < bookingOps.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const op of bookingOps.slice(i, i + CHUNK)) {
      const ref = op.id
        ? doc(db, "bookingRows", op.id)
        : doc(collection(db, "bookingRows"));
      const data = { ...op.data, uploadBatchId: batchId, uploadedAt: now };
      op.type === "update" ? batch.update(ref, data) : batch.set(ref, data);
    }
    await batch.commit();
  }

  for (let i = 0; i < newSessions.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const s of newSessions.slice(i, i + CHUNK)) {
      batch.set(doc(collection(db, "examSessions")), {
        ...s, publishStatus: "pending", uploadBatchId: batchId, uploadedAt: now,
      });
    }
    await batch.commit();
  }
}

export async function getBookingsForDate(date) {
  const q = query(collection(db, "bookingRows"), where("contestDate", "==", date));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function deleteBooking(id) {
  await deleteDoc(doc(db, "bookingRows", id));
}

export async function bulkDeleteBookings(ids) {
  for (let i = 0; i < ids.length; i += 499) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + 499)) batch.delete(doc(db, "bookingRows", id));
    await batch.commit();
  }
}

// ── Exam Sessions ─────────────────────────────────────────────────────────────

export async function getSessions() {
  const q = query(
    collection(db, "examSessions"),
    where("dateOfAssessment", ">=", cutoffDate()),
    orderBy("dateOfAssessment", "asc"),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getPublishedSessions(date) {
  let q = query(collection(db, "examSessions"), where("publishStatus", "==", "published"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getAllSessionsForDate(date) {
  let q = date
    ? query(collection(db, "examSessions"), where("dateOfAssessment", "==", date))
    : query(collection(db, "examSessions"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateSession(id, data) {
  await updateDoc(doc(db, "examSessions", id), data);
}

export async function deleteSession(id) {
  await deleteDoc(doc(db, "examSessions", id));
}

export async function bulkDeleteSessions(ids) {
  for (let i = 0; i < ids.length; i += 499) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + 499)) batch.delete(doc(db, "examSessions", id));
    await batch.commit();
  }
}

// ── TinyURL generation (client-side) ──────────────────────────────────────────

export async function generateTinyUrls() {
  const settingsSnap = await getDoc(doc(db, "settings", "automation"));
  const token = settingsSnap.exists() ? settingsSnap.data().tinyUrlToken : null;
  if (!token) throw new Error("TinyURL API token not set — add it in the Credentials tab.");

  const q = query(collection(db, "examSessions"), where("publishStatus", "==", "published"));
  const snap = await getDocs(q);
  const missing = snap.docs.filter(d => !d.data().tinyUrl && d.data().assessmentLink);

  let updated = 0, failed = 0;
  for (const docSnap of missing) {
    let userUrl = docSnap.data().assessmentLink;
    try { const u = new URL(userUrl); u.searchParams.delete("a_t"); userUrl = u.toString(); } catch {}
    try {
      const r = await fetch("https://api.tinyurl.com/create", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: userUrl, domain: "tinyurl.com" }),
      });
      const data = await r.json();
      const tinyUrl = data?.data?.tiny_url;
      if (tinyUrl) { await updateDoc(docSnap.ref, { tinyUrl }); updated++; }
      else failed++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 150));
  }

  return { updated, failed, skipped: snap.docs.length - missing.length };
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings() {
  const snap = await getDoc(doc(db, "settings", "automation"));
  return snap.exists() ? snap.data() : {};
}

export async function saveSettings(data) {
  await setDoc(doc(db, "settings", "automation"), data, { merge: true });
}

// ── Interviews ────────────────────────────────────────────────────────────────

export async function getInterviews(userEmail, isAdmin) {
  const snap = isAdmin
    ? await getDocs(collection(db, "scheduledInterviews"))
    : await getDocs(query(
        collection(db, "scheduledInterviews"),
        where("panelistEmail", "==", (userEmail || "").toLowerCase()),
      ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function bulkCreateInterviews(rows) {
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 499) {
    const batch = writeBatch(db);
    for (const row of rows.slice(i, i + 499)) {
      batch.set(doc(collection(db, "scheduledInterviews")), { ...row, uploadedAt: now });
    }
    await batch.commit();
  }
}

// ── Pre-invited Emails ────────────────────────────────────────────────────────

export async function getInvitedEmails() {
  const snap = await getDocs(collection(db, "invitedEmails"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addInvitedEmail(email, role, invitedBy) {
  const norm = email.toLowerCase().trim();
  const existing = await getDoc(doc(db, "invitedEmails", norm));
  if (existing.exists()) throw new Error("This email is already in the invite list.");
  await setDoc(doc(db, "invitedEmails", norm), {
    email: norm, role, invitedBy,
    invitedAt: new Date().toISOString(),
  });
}

export async function removeInvitedEmail(id) {
  await deleteDoc(doc(db, "invitedEmails", id));
}

export async function checkInvitedEmail(email) {
  const snap = await getDoc(doc(db, "invitedEmails", email.toLowerCase().trim()));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export async function createLog(data) {
  await addDoc(collection(db, "logs"), {
    ...data,
    createdAt: new Date().toISOString(),
  });
}

// ── Real-time listeners ───────────────────────────────────────────────────────

export function subscribeToSessions(callback) {
  const q = query(
    collection(db, "examSessions"),
    where("dateOfAssessment", ">=", cutoffDate()),
    orderBy("dateOfAssessment", "asc"),
  );
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export function subscribeToBookings(callback) {
  const q = query(
    collection(db, "bookingRows"),
    where("contestDate", ">=", cutoffDate()),
    orderBy("contestDate", "asc"),
  );
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// ── Invite (client-side) ──────────────────────────────────────────────────────

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
      try { json = JSON.parse(text); } catch {}
      if (res.ok || res.status < 500) return { ok: res.ok, status: res.status, json };
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) { lastErr = err; }
    if (attempt < 3) await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)));
  }
  throw lastErr;
}

export async function runInvite(apiEndpoint, apiToken, date, onProgress, cancelRef) {
  const now = new Date().toISOString();

  onProgress("info", "Fetching bookings from Firestore…");
  let bookingsSnap, sessionsSnap;

  if (date) {
    [bookingsSnap, sessionsSnap] = await Promise.all([
      getDocs(query(collection(db, "bookingRows"), where("contestDate", "==", date))),
      getDocs(query(collection(db, "examSessions"), where("publishStatus", "==", "published"))),
    ]);
  } else {
    // Filter by cutoffDate to avoid reading historical rows
    [bookingsSnap, sessionsSnap] = await Promise.all([
      getDocs(query(collection(db, "bookingRows"), where("contestDate", ">=", cutoffDate()), orderBy("contestDate", "asc"))),
      getDocs(query(collection(db, "examSessions"), where("publishStatus", "==", "published"))),
    ]);
  }

  const bookings = bookingsSnap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
  const sessionMap = new Map();
  sessionsSnap.docs.forEach(d => {
    const s = d.data();
    if (s.sessionKey && s.topinAssessmentId) sessionMap.set(s.sessionKey, s.topinAssessmentId);
  });

  const toInvite = bookings.filter(b => b.inviteStatus !== "sent" && b.sessionKey && sessionMap.has(b.sessionKey));
  const blocked  = bookings.filter(b => b.inviteStatus !== "sent" && b.sessionKey && !sessionMap.has(b.sessionKey));

  if (blocked.length) onProgress("warn", `${blocked.length} student(s) skipped — session not published`);
  if (toInvite.length === 0) {
    onProgress("success", "All eligible students already invited.");
    onProgress("done", "Invite complete — 0 invites", { sent: 0, failed: 0 });
    return;
  }

  const groups = new Map();
  for (const b of toInvite) {
    const aid = sessionMap.get(b.sessionKey);
    if (!groups.has(aid)) groups.set(aid, []);
    groups.get(aid).push(b);
  }
  onProgress("info", `Sending ${toInvite.length} invite(s) across ${groups.size} assessment(s)…`);

  let sent = 0, failed = 0;
  for (const [assessmentId, students] of groups) {
    const totalBatches = Math.ceil(students.length / INVITE_BATCH_SIZE);
    for (let i = 0; i < students.length; i += INVITE_BATCH_SIZE) {
      if (cancelRef?.current) { onProgress("warn", "Cancelled."); break; }
      const batch = students.slice(i, i + INVITE_BATCH_SIZE);
      onProgress("info", `Batch ${Math.floor(i / INVITE_BATCH_SIZE) + 1}/${totalBatches} — ${batch.length} students`);
      try {
        const { ok, status, json } = await callInviteAPIBatch(apiEndpoint, apiToken, batch.map(b => b.studentUid), assessmentId);
        const fbBatch = writeBatch(db);
        if (ok) {
          const failedUids = new Set((json.failed_users_details || []).map(f => String(f.user_id || "").trim()));
          for (const b of batch) {
            if (failedUids.has(b.studentUid)) {
              const reason = (json.failed_users_details || []).find(f => String(f.user_id) === b.studentUid)?.reason || "Failed";
              fbBatch.update(doc(db, "bookingRows", b.firestoreId), { inviteStatus: "failed", inviteError: reason });
              failed++;
            } else {
              fbBatch.update(doc(db, "bookingRows", b.firestoreId), { inviteStatus: "sent", invitedAt: now, inviteError: null });
              sent++;
            }
          }
        } else {
          const errorMsg = json.res_status || `HTTP ${status}`;
          onProgress("error", `  Batch failed: ${errorMsg}`);
          for (const b of batch) { fbBatch.update(doc(db, "bookingRows", b.firestoreId), { inviteStatus: "failed", inviteError: errorMsg }); failed++; }
        }
        await fbBatch.commit();
      } catch (err) {
        onProgress("error", `  Batch error: ${err.message}`);
        const fbBatch = writeBatch(db);
        for (const b of batch) { fbBatch.update(doc(db, "bookingRows", b.firestoreId), { inviteStatus: "failed", inviteError: err.message }); failed++; }
        await fbBatch.commit().catch(() => {});
      }
      if (i + INVITE_BATCH_SIZE < students.length) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (cancelRef?.current) break;
  }
  onProgress("done", `Invite complete — ${sent} sent, ${failed} failed`, { sent, failed });
}
