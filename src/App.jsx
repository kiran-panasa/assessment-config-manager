import { useState, useEffect, useRef, useMemo } from "react";
import { db, auth } from "./firebase";
import { signOut } from "firebase/auth";
import { AuthProvider, useAuth } from "./AuthContext";
import CreateAssessments from "./CreateAssessments";
import InvitedStudents from "./InvitedStudents";
import AdminPanel from "./AdminPanel";
import LoginPage from "./LoginPage";
import PendingPage from "./PendingPage";
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  setDoc, getDoc, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove,
} from "firebase/firestore";

const DEFAULT_SKILLS = [
  "Applied Gen AI Development", "Computational Thinking",
  "Critical Thinking & Communication", "CS Fundamentals",
  "Quantitative Reasoning", "Server-Side Engineering",
  "SQL", "UI Engineering", "DS & ML",
];
const DEFAULT_LEVELS = ["L1", "L2", "L3"];
const PIN_CHARS = "ACDEFGHJKLMNPQRTUVWXYZ23456789";
const PAGE_SIZE = 20;

const T1_COLS = [
  ["Booking ID", "bookingId"], ["Student Name", "studentName"], ["NIAT ID", "niatId"],
  ["Skill", "skill"], ["Level", "skillLevel"], ["Contest Date", "contestDate"],
  ["Time Slot", "timeSlot"], ["Campus", "campus"], ["Slot Centre", "slotCentre"],
  ["Batch", "batch"], ["Section", "section"], ["Attendance", "attendance"],
  ["Status", "status"], ["Student UID", "studentUid"], ["Booked At", "bookedAt"],
  ["Contest Link", "contestLink"], ["Classroom Details", "classroomDetails"],
];
const T2_COLS = ["Assessment Title", "Date", "Start Time", "End Time", "Unique Exam ID", "EXIT PIN", "Topin ID", "Publish Status"];
const T3_COLS = ["Student Name", "NIAT ID", "Student UID", "Skill", "Level", "Contest Date", "Time Slot", "Unique Exam ID", "Invite"];

// ── helpers ──────────────────────────────────────────────────────────────────

function splitCSVRow(line) {
  const vals = []; let inQ = false, cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (c === "," && !inQ) { vals.push(cur); cur = ""; } else cur += c;
  }
  vals.push(cur);
  return vals.map(v => v.trim().replace(/^"|"$/g, ""));
}

function genPin() {
  let p = "";
  for (let i = 0; i < 6; i++) p += PIN_CHARS[Math.floor(Math.random() * PIN_CHARS.length)];
  return p;
}

function timeToMins(t) {
  if (!t) return 0;
  const s = t.trim();
  const ap = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ap) {
    let h = parseInt(ap[1]), m = parseInt(ap[2]);
    const p = ap[3].toUpperCase();
    if (p === "PM" && h !== 12) h += 12;
    if (p === "AM" && h === 12) h = 0;
    return h * 60 + m;
  }
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) return parseInt(h24[1]) * 60 + parseInt(h24[2]);
  return 0;
}

function minsToTime(m) {
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  const p = h >= 12 ? "PM" : "AM", h12 = h % 12 || 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${p}`;
}

function minsToHHMM(m) {
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  return `${String(h).padStart(2, "0")}${String(mm).padStart(2, "0")}`;
}

function toISODate(d) {
  if (!d) return "";
  const dm = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dm) return `${dm[3]}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
  const im = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (im) return `${im[1]}-${im[2]}-${im[3]}`;
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toISOString().slice(0, 10);
}

function buildSessionKey(skill, level, date, timeSlot) {
  return `${skill}||${level}||${toISODate(date)}||${minsToHHMM(timeToMins(timeSlot))}`;
}

function buildExamId(skill, level, date, timeSlot) {
  return `NG26_NIAT_GRIT_${skill.toUpperCase().replace(/\s+/g, "_")}_L${level}_${toISODate(date)}_${minsToHHMM(timeToMins(timeSlot))}`;
}

function parseBookingCSV(text, existingBids, existingSessions, assessments, bufMins) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) return { error: "CSV file is empty." };

  const rawHeaders = splitCSVRow(lines[0]);
  const hIdx = {};
  rawHeaders.forEach((h, i) => { hIdx[h.toLowerCase().trim()] = i; });

  const REQUIRED = ["booking id", "skill", "skill level", "contest date", "time slot"];
  const missing = REQUIRED.filter(c => hIdx[c] === undefined);
  if (missing.length) return { error: `Missing required columns: ${missing.join(", ")}` };

  const get = (vals, key) => (vals[hIdx[key.toLowerCase()]] ?? "").trim();

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitCSVRow(lines[i]);
    const skill = get(vals, "skill");
    const skillLevel = get(vals, "skill level");
    const contestDate = toISODate(get(vals, "contest date"));
    const timeSlot = get(vals, "time slot");
    rows.push({
      bookingId: get(vals, "booking id"),
      studentUid: get(vals, "student uid"),
      studentName: get(vals, "student name"),
      niatId: get(vals, "niat id"),
      campus: get(vals, "campus"),
      slotCentre: get(vals, "slot centre"),
      batch: get(vals, "batch"),
      section: get(vals, "section"),
      contestDate, timeSlot, skill, skillLevel,
      contestLink: get(vals, "contest link"),
      classroomDetails: get(vals, "classroom details"),
      bookedAt: get(vals, "booked at"),
      attendance: get(vals, "attendance"),
      status: get(vals, "status"),
      sessionKey: buildSessionKey(skill, skillLevel, contestDate, timeSlot),
    });
  }

  if (rows.length === 0) return { error: "No data rows found in CSV." };

  const existingSet = new Set(existingBids);
  const dupRows = rows.filter(r => existingSet.has(r.bookingId));
  const newRows = rows.filter(r => !existingSet.has(r.bookingId));

  const existingSessionMap = new Map();
  existingSessions.forEach(s => { if (s.sessionKey) existingSessionMap.set(s.sessionKey, s); });

  const seenKeys = new Set();
  const newSessions = [], reusedSessions = [], warnSessions = [];

  rows.forEach(row => {
    const key = row.sessionKey;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    if (existingSessionMap.has(key)) { reusedSessions.push(existingSessionMap.get(key)); return; }
    const match = assessments.find(a => a.skill === row.skill && a.level === `L${row.skillLevel}`);
    const duration = parseInt(match?.duration) || 0;
    const hasMissingConfig = !match || !match.duration;
    const startMins = timeToMins(row.timeSlot);
    const session = {
      assessmentTitle: `${row.skill} - L${row.skillLevel}`,
      dateOfAssessment: row.contestDate,
      startTimeSlot: minsToTime(startMins),
      endTimeSlot: minsToTime(startMins + duration + bufMins),
      uniqueExamId: buildExamId(row.skill, row.skillLevel, row.contestDate, row.timeSlot),
      exitPin: genPin(),
      skill: row.skill, level: row.skillLevel,
      sessionKey: key, hasMissingConfig,
    };
    newSessions.push(session);
    if (hasMissingConfig) warnSessions.push(session);
  });

  return { rows, newRows, dupRows, newSessions, reusedSessions, warnSessions };
}

// ── sub-components ────────────────────────────────────────────────────────────

function Toast({ message, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2200); return () => clearTimeout(t); }, []);
  return (
    <div style={{
      position: "fixed", bottom: 32, right: 32, zIndex: 9999,
      background: type === "error" ? "#ff4444" : "#00c896",
      color: "#fff", padding: "12px 22px", borderRadius: 8,
      fontFamily: "'DM Mono', monospace", fontSize: 13,
      boxShadow: "0 4px 24px rgba(0,0,0,0.18)", animation: "slideUp 0.25s ease",
    }}>{message}</div>
  );
}

const IconAssessment = ({ color }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);

const IconBookings = ({ color }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const IconCreate = ({ color }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const IconInvited = ({ color }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <polyline points="16 11 18 13 22 9" />
  </svg>
);

const IconAdmin = ({ color }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);

function Pagination({ page, total, onPage, S }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  const from = (page - 1) * PAGE_SIZE + 1, to = Math.min(page * PAGE_SIZE, total);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, paddingTop: 16, borderTop: "1px solid #1e2030" }}>
      <span style={{ fontSize: 11, color: "#555a7a", fontFamily: "'Syne', sans-serif" }}>{from}–{to} of {total}</span>
      <div style={{ display: "flex", gap: 6 }}>
        {[["«", 1], ["‹", page - 1]].map(([lbl, pg]) => (
          <button key={lbl} disabled={page === 1} onClick={() => onPage(pg)}
            style={{ ...S.btn("secondary"), padding: "6px 12px", fontSize: 12, opacity: page === 1 ? 0.35 : 1 }}>{lbl}</button>
        ))}
        <span style={{ padding: "6px 14px", fontSize: 12, color: "#e0e0e8", background: "#1e2030", borderRadius: 8 }}>{page} / {pages}</span>
        {[["›", page + 1], ["»", pages]].map(([lbl, pg]) => (
          <button key={lbl} disabled={page === pages} onClick={() => onPage(pg)}
            style={{ ...S.btn("secondary"), padding: "6px 12px", fontSize: 12, opacity: page === pages ? 0.35 : 1 }}>{lbl}</button>
        ))}
      </div>
    </div>
  );
}

function DateFilter({ dates, value, onChange, S }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ ...S.label, marginBottom: 0, whiteSpace: "nowrap" }}>Filter by date</span>
      <select style={{ ...S.select, width: 170 }} value={value} onChange={e => onChange(e.target.value)}>
        <option value="All">All Dates</option>
        {dates.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}

// ── StudentBookings ───────────────────────────────────────────────────────────

function StudentBookings({ S, assessments, bookingRows, examSessions, writeLog, showToast }) {
  const [bookTab, setBookTab] = useState("upload");
  const [bufferTime, setBufferTime] = useState("30");
  const [csvData, setCsvData] = useState(null);
  const [dupChoice, setDupChoice] = useState(null);
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef(null);

  const [t1Date, setT1Date] = useState("All"); const [t1Page, setT1Page] = useState(1);
  const [t2Date, setT2Date] = useState("All"); const [t2Page, setT2Page] = useState(1);
  const [t3Date, setT3Date] = useState("All"); const [t3Page, setT3Page] = useState(1);

  const existingBids = useMemo(() => bookingRows.map(r => r.bookingId), [bookingRows]);
  const existingDocIdMap = useMemo(() => { const m = new Map(); bookingRows.forEach(r => m.set(r.bookingId, r.id)); return m; }, [bookingRows]);

  const sessionMap = useMemo(() => { const m = new Map(); examSessions.forEach(s => { if (s.sessionKey) m.set(s.sessionKey, s); }); return m; }, [examSessions]);

  const userMapping = useMemo(() =>
    bookingRows.map(row => {
      const s = row.sessionKey ? sessionMap.get(row.sessionKey) : null;
      return { ...row, uniqueExamId: s?.uniqueExamId ?? "—", mapped: !!s };
    }), [bookingRows, sessionMap]);

  const t1Dates = useMemo(() => [...new Set(bookingRows.map(r => r.contestDate))].filter(Boolean).sort(), [bookingRows]);
  const t2Dates = useMemo(() => [...new Set(examSessions.map(r => r.dateOfAssessment))].filter(Boolean).sort(), [examSessions]);
  const t3Dates = useMemo(() => [...new Set(userMapping.map(r => r.contestDate))].filter(Boolean).sort(), [userMapping]);

  const t1Filtered = t1Date === "All" ? bookingRows : bookingRows.filter(r => r.contestDate === t1Date);
  const t2Filtered = t2Date === "All" ? examSessions : examSessions.filter(r => r.dateOfAssessment === t2Date);
  const t3Filtered = t3Date === "All" ? userMapping : userMapping.filter(r => r.contestDate === t3Date);

  const rowsToSave = useMemo(() =>
    csvData ? (dupChoice === "overwrite" ? csvData.rows : csvData.newRows) : [],
    [csvData, dupChoice]);

  const processFile = async (file, buf) => {
    if (!file) { setCsvData(null); setDupChoice(null); return; }
    if (!file.name.toLowerCase().endsWith(".csv")) { showToast("Only .csv files are accepted.", "error"); return; }
    const text = await file.text();
    const result = parseBookingCSV(text, existingBids, examSessions, assessments, buf);
    if (result.error) { showToast(result.error, "error"); setCsvData(null); return; }
    setCsvData(result);
    setDupChoice(result.dupRows.length === 0 ? "skip" : null);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    processFile(file, parseInt(bufferTime) || 0);
  };

  const handleBufferChange = (val) => {
    setBufferTime(val);
    if (fileRef.current?.files[0]) processFile(fileRef.current.files[0], parseInt(val) || 0);
  };

  const handleSave = async () => {
    if (!csvData || !dupChoice || processing) return;
    setProcessing(true);
    const batchId = Date.now().toString();
    try {
      for (const row of rowsToSave) {
        const data = { ...row, uploadBatchId: batchId, uploadedAt: serverTimestamp() };
        const existId = existingDocIdMap.get(row.bookingId);
        if (existId && dupChoice === "overwrite") {
          await updateDoc(doc(db, "bookingRows", existId), data);
        } else if (!existId) {
          await addDoc(collection(db, "bookingRows"), data);
        }
      }
      for (const session of csvData.newSessions) {
        await addDoc(collection(db, "examSessions"), { ...session, uploadBatchId: batchId, uploadedAt: serverTimestamp() });
      }
      writeLog("csv_upload", { batchId, bookings: rowsToSave.length, sessions: csvData.newSessions.length });
      showToast(`Saved: ${rowsToSave.length} bookings, ${csvData.newSessions.length} new sessions.`);
      setCsvData(null); setDupChoice(null);
      if (fileRef.current) fileRef.current.value = "";
      setBookTab("bookings");
    } catch { showToast("Save failed. Please try again.", "error"); }
    setProcessing(false);
  };

  const handleDeleteBooking = async (id) => {
    try { await deleteDoc(doc(db, "bookingRows", id)); writeLog("booking_deleted", { id }); showToast("Booking deleted."); }
    catch { showToast("Failed to delete.", "error"); }
  };

  const handleDeleteSession = async (id) => {
    try { await deleteDoc(doc(db, "examSessions", id)); writeLog("session_deleted", { id }); showToast("Session deleted."); }
    catch { showToast("Failed to delete.", "error"); }
  };

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={S.header}>
        <span style={S.headerTitle}>Student Bookings</span>
        <nav style={S.nav}>
          {[["upload","Upload CSV"],["bookings","Slot Bookings"],["assessments","Unique Assessments"],["users","User Mapping"]].map(([key, label]) => (
            <button key={key} style={S.navItem(bookTab === key)} onClick={() => setBookTab(key)}>{label}</button>
          ))}
        </nav>
        <div style={{ marginLeft: "auto", paddingBottom: 18, paddingTop: 18, fontSize: 12, color: "#555a7a" }}>
          {bookingRows.length} bookings · {examSessions.length} sessions
        </div>
      </div>

      <div style={S.body}>

        {/* ── UPLOAD ── */}
        {bookTab === "upload" && (
          <>
            <div style={S.sectionTitle}>Upload Booking CSV</div>
            <div style={S.sectionSub}>Generates Slot Bookings (Table 1), Unique Assessments (Table 2), and User Mapping (Table 3).</div>

            <div style={S.card}>
              <div style={S.grid2}>
                <div>
                  <label style={S.label}>Booking CSV File</label>
                  <input ref={fileRef} type="file" accept=".csv" onChange={handleFile}
                    style={{ ...S.input, cursor: "pointer", paddingTop: 9 }} />
                </div>
                <div>
                  <label style={S.label}>Buffer Time (minutes)</label>
                  <input type="number" min="0" style={S.input} value={bufferTime}
                    onChange={e => handleBufferChange(e.target.value)} placeholder="e.g. 30" />
                </div>
              </div>

              {csvData && csvData.dupRows.length > 0 && (
                <div style={{ marginTop: 24, padding: "16px 20px", background: "#1f1a0a", border: "1px solid #f5a623", borderRadius: 8 }}>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: "#f5a623", marginBottom: 8 }}>
                    ⚠ {csvData.dupRows.length} duplicate Booking ID{csvData.dupRows.length > 1 ? "s" : ""} found
                  </div>
                  <div style={{ fontSize: 12, color: "#9a8060", marginBottom: 14 }}>These Booking IDs already exist. How should they be handled?</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button onClick={() => setDupChoice("skip")}
                      style={{ ...S.btn("secondary"), padding: "8px 16px", fontSize: 12, border: `1px solid ${dupChoice === "skip" ? "#00c896" : "#2e3044"}`, color: dupChoice === "skip" ? "#00c896" : "#aab" }}>
                      Skip duplicates — save {csvData.newRows.length} new rows
                    </button>
                    <button onClick={() => setDupChoice("overwrite")}
                      style={{ ...S.btn("secondary"), padding: "8px 16px", fontSize: 12, border: `1px solid ${dupChoice === "overwrite" ? "#f5a623" : "#2e3044"}`, color: dupChoice === "overwrite" ? "#f5a623" : "#aab" }}>
                      Overwrite — save all {csvData.rows.length} rows
                    </button>
                    <button onClick={() => { setCsvData(null); setDupChoice(null); if (fileRef.current) fileRef.current.value = ""; }}
                      style={{ ...S.btn("danger"), padding: "8px 16px", fontSize: 12 }}>Cancel</button>
                  </div>
                </div>
              )}

              {csvData && dupChoice && (
                <div style={{ marginTop: 24 }}>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 12, color: "#555a7a", marginBottom: 14, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    Ready to save
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
                    {[
                      [rowsToSave.length, "Booking rows", "#00c896"],
                      [csvData.newSessions.length, "New exam sessions", "#7eb8ff"],
                      [csvData.reusedSessions.length, "Sessions reused (PINs kept)", "#555a7a"],
                    ].map(([val, lbl, color]) => (
                      <div key={lbl} style={{ background: "#0d0e14", border: "1px solid #1e2030", borderRadius: 8, padding: "14px 18px" }}>
                        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, color }}>{val}</div>
                        <div style={{ fontSize: 11, color: "#555a7a", marginTop: 4 }}>{lbl}</div>
                      </div>
                    ))}
                  </div>
                  {csvData.warnSessions.length > 0 && (
                    <div style={{ marginBottom: 16, padding: "12px 16px", background: "#0f1228", border: "1px solid #3a4070", borderRadius: 8, fontSize: 12, color: "#7eb8ff", lineHeight: 1.7 }}>
                      ⚠ {csvData.warnSessions.length} session{csvData.warnSessions.length > 1 ? "s" : ""} have no matching Assessment Config — End Time uses 0 duration.
                      Fix by setting <strong>Assessment Duration</strong> in Assessment Configurations → Add / Edit.
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 12 }}>
                    <button style={{ ...S.btn("primary"), opacity: (processing || rowsToSave.length === 0) ? 0.5 : 1 }}
                      onClick={handleSave} disabled={processing || rowsToSave.length === 0}>
                      {processing ? "Saving…" : "Save All"}
                    </button>
                    <button style={S.btn("secondary")} onClick={() => { setCsvData(null); setDupChoice(null); if (fileRef.current) fileRef.current.value = ""; }}>
                      Discard
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ ...S.card, background: "#0d0e14", border: "1px solid #2e3044", padding: "20px 24px" }}>
              <div style={{ fontSize: 12, color: "#555a7a", lineHeight: 1.9 }}>
                <strong style={{ color: "#7eb8ff" }}>Required CSV columns:</strong> Booking ID, Skill, Skill Level, Contest Date, Time Slot<br />
                <strong style={{ color: "#7eb8ff" }}>End Time</strong> = Start Time + Assessment Duration (from config) + Buffer Time<br />
                <strong style={{ color: "#7eb8ff" }}>EXIT PIN</strong> is preserved if the same slot was uploaded before.
              </div>
            </div>
          </>
        )}

        {/* ── TABLE 1: SLOT BOOKINGS ── */}
        {bookTab === "bookings" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={S.sectionTitle}>Slot Bookings</div>
                <div style={{ ...S.sectionSub, marginBottom: 0 }}>All raw booking rows from uploaded CSVs.</div>
              </div>
              <DateFilter dates={t1Dates} value={t1Date} onChange={v => { setT1Date(v); setT1Page(1); }} S={S} />
            </div>
            <div style={S.card}>
              {t1Filtered.length === 0 ? (
                <div style={{ textAlign: "center", color: "#555a7a", padding: "60px 0", fontSize: 13 }}>
                  <div style={{ marginBottom: 10, fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#3a3d52" }}>
                    {bookingRows.length === 0 ? "No bookings yet" : "No results for selected date"}
                  </div>
                  {bookingRows.length === 0 && "Upload a CSV to populate this table."}
                </div>
              ) : (
                <>
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead><tr>{T1_COLS.map(([h]) => <th key={h} style={S.th}>{h}</th>)}<th style={S.th}></th></tr></thead>
                      <tbody>
                        {t1Filtered.slice((t1Page - 1) * PAGE_SIZE, t1Page * PAGE_SIZE).map(row => (
                          <tr key={row.id}
                            onMouseEnter={e => e.currentTarget.style.background = "#1a1b24"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            {T1_COLS.map(([, k]) => (
                              <td key={k} style={{ ...S.td, whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                                {k === "status"
                                  ? <span style={S.badge(row[k]?.toLowerCase() === "active" ? "#00c896" : "#555a7a")}>{row[k] || "—"}</span>
                                  : k === "attendance"
                                  ? <span style={S.badge(row[k]?.toLowerCase() === "present" ? "#00c896" : row[k] ? "#f5a623" : "#555a7a")}>{row[k] || "—"}</span>
                                  : k === "contestLink" && row[k]
                                  ? <a href={row[k]} target="_blank" rel="noreferrer" style={{ color: "#7eb8ff", textDecoration: "none", fontSize: 11 }}>Link ↗</a>
                                  : (row[k] || "—")}
                              </td>
                            ))}
                            <td style={S.td}>
                              <button style={{ ...S.btn("danger"), padding: "5px 12px", fontSize: 11 }} onClick={() => handleDeleteBooking(row.id)}>Del</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination page={t1Page} total={t1Filtered.length} onPage={setT1Page} S={S} />
                </>
              )}
            </div>
          </>
        )}

        {/* ── TABLE 2: UNIQUE ASSESSMENTS ── */}
        {bookTab === "assessments" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={S.sectionTitle}>Unique Assessments</div>
                <div style={{ ...S.sectionSub, marginBottom: 0 }}>One row per unique exam slot with UniqueExamID and EXIT PIN.</div>
              </div>
              <DateFilter dates={t2Dates} value={t2Date} onChange={v => { setT2Date(v); setT2Page(1); }} S={S} />
            </div>
            <div style={S.card}>
              {t2Filtered.length === 0 ? (
                <div style={{ textAlign: "center", color: "#555a7a", padding: "60px 0", fontSize: 13 }}>
                  <div style={{ marginBottom: 10, fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#3a3d52" }}>
                    {examSessions.length === 0 ? "No sessions yet" : "No results for selected date"}
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead><tr>{T2_COLS.map(c => <th key={c} style={S.th}>{c}</th>)}<th style={S.th}></th></tr></thead>
                      <tbody>
                        {t2Filtered.slice((t2Page - 1) * PAGE_SIZE, t2Page * PAGE_SIZE).map(s => (
                          <tr key={s.id}
                            onMouseEnter={e => e.currentTarget.style.background = "#1a1b24"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            <td style={S.td}>
                              {s.assessmentTitle}
                              {s.hasMissingConfig && <span title="Duration unknown — End Time may be inaccurate" style={{ marginLeft: 6, fontSize: 11, color: "#f5a623" }}>⚠</span>}
                            </td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.dateOfAssessment}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.startTimeSlot}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.endTimeSlot}</td>
                            <td style={{ ...S.td, fontSize: 11, color: "#7eb8ff", fontFamily: "'DM Mono', monospace" }}>{s.uniqueExamId}</td>
                            <td style={S.td}>
                              <span style={{ ...S.badge("#ff9966"), fontFamily: "'DM Mono', monospace", letterSpacing: "0.2em", fontSize: 13 }}>{s.exitPin}</span>
                            </td>
                            <td style={{ ...S.td, fontSize: 11, color: "#7eb8ff", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>
                              {s.topinAssessmentId ? s.topinAssessmentId.slice(0, 8) + "…" : "—"}
                            </td>
                            <td style={S.td}>
                              {s.publishStatus === "published"
                                ? <span style={S.badge("#00c896")}>Published</span>
                                : s.publishStatus === "failed"
                                ? <span style={S.badge("#ff5555")}>Failed</span>
                                : <span style={S.badge("#555a7a")}>Pending</span>}
                            </td>
                            <td style={S.td}>
                              <button style={{ ...S.btn("danger"), padding: "5px 12px", fontSize: 11 }} onClick={() => handleDeleteSession(s.id)}>Del</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination page={t2Page} total={t2Filtered.length} onPage={setT2Page} S={S} />
                </>
              )}
            </div>
          </>
        )}

        {/* ── TABLE 3: USER MAPPING ── */}
        {bookTab === "users" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={S.sectionTitle}>User Mapping</div>
                <div style={{ ...S.sectionSub, marginBottom: 0 }}>Each student mapped to their Unique Exam ID.</div>
              </div>
              <DateFilter dates={t3Dates} value={t3Date} onChange={v => { setT3Date(v); setT3Page(1); }} S={S} />
            </div>
            <div style={S.card}>
              {t3Filtered.length === 0 ? (
                <div style={{ textAlign: "center", color: "#555a7a", padding: "60px 0", fontSize: 13 }}>
                  <div style={{ marginBottom: 10, fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#3a3d52" }}>
                    {userMapping.length === 0 ? "No data yet" : "No results for selected date"}
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead><tr>{T3_COLS.map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
                      <tbody>
                        {t3Filtered.slice((t3Page - 1) * PAGE_SIZE, t3Page * PAGE_SIZE).map((row, i) => (
                          <tr key={row.id || i}
                            onMouseEnter={e => e.currentTarget.style.background = "#1a1b24"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            <td style={S.td}>{row.studentName || "—"}</td>
                            <td style={S.td}>{row.niatId || "—"}</td>
                            <td style={{ ...S.td, fontSize: 11, fontFamily: "'DM Mono', monospace" }}>{row.studentUid || "—"}</td>
                            <td style={S.td}>{row.skill || "—"}</td>
                            <td style={S.td}>{row.skillLevel || "—"}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{row.contestDate || "—"}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{row.timeSlot || "—"}</td>
                            <td style={{ ...S.td, fontSize: 11, fontFamily: "'DM Mono', monospace", color: row.mapped ? "#7eb8ff" : "#555a7a" }}>
                              {row.uniqueExamId}
                              {!row.mapped && <span title="No matching exam session found" style={{ marginLeft: 6, color: "#f5a623" }}>⚠</span>}
                            </td>
                            <td style={S.td}>
                              {row.inviteStatus === "sent"
                                ? <span style={S.badge("#00c896")}>Sent</span>
                                : row.inviteStatus === "failed"
                                ? <span style={S.badge("#ff5555")}>Failed</span>
                                : <span style={S.badge("#555a7a")}>Not Sent</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination page={t3Page} total={t3Filtered.length} onPage={setT3Page} S={S} />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function AppInner() {
  const { currentUser, userProfile, allowedPages, authLoading } = useAuth();

  const [assessments, setAssessments] = useState([]);
  const [skills, setSkills] = useState(DEFAULT_SKILLS);
  const [levels, setLevels] = useState(DEFAULT_LEVELS);
  const [bookingRows, setBookingRows] = useState([]);
  const [examSessions, setExamSessions] = useState([]);
  const [firestoreLoading, setFirestoreLoading] = useState(true);
  const [page, setPage] = useState("assessments");
  const [tab, setTab] = useState("entry");
  const [toast, setToast] = useState(null);

  const [selSkill, setSelSkill] = useState("");
  const [selLevel, setSelLevel] = useState("");
  const [configUrl, setConfigUrl] = useState("");
  const [selDuration, setSelDuration] = useState("");
  const [editId, setEditId] = useState(null);
  const [newSkill, setNewSkill] = useState("");
  const [newLevel, setNewLevel] = useState("");
  const [filterSkill, setFilterSkill] = useState("All");
  const [filterLevel, setFilterLevel] = useState("All");

  const showToast = (message, type = "success") => setToast({ message, type });

  const prevRoleRef = useRef(null);

  useEffect(() => {
    if (!userProfile) { prevRoleRef.current = null; return; }
    const prev = prevRoleRef.current;
    prevRoleRef.current = userProfile.role;
    if (prev !== null && prev !== userProfile.role && userProfile.status === "active") {
      showToast("Your access level has been changed by an admin.", "error");
    }
  }, [userProfile?.role]);

  useEffect(() => {
    if (authLoading || !allowedPages.length) return;
    const adminOk = page === "admin" && userProfile?.role === "admin";
    if (!adminOk && !allowedPages.includes(page)) setPage(allowedPages[0]);
  }, [allowedPages, authLoading]);

  const formatDate = (ts) => {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const writeLog = (action, details = {}) =>
    addDoc(collection(db, "logs"), { action, ...details, timestamp: serverTimestamp() }).catch(() => {});

  useEffect(() => {
    const configRef = doc(db, "config", "main");
    getDoc(configRef).then(snap => { if (!snap.exists()) setDoc(configRef, { skills: DEFAULT_SKILLS, levels: DEFAULT_LEVELS }); });

    const unsubA = onSnapshot(collection(db, "assessments"), snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
      setAssessments(data); setFirestoreLoading(false);
    }, () => setFirestoreLoading(false));

    const unsubC = onSnapshot(configRef, snap => {
      if (snap.exists()) { const d = snap.data(); if (d.skills) setSkills(d.skills); if (d.levels) setLevels(d.levels); }
    });

    const unsubB = onSnapshot(collection(db, "bookingRows"), snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => (a.uploadedAt?.toMillis?.() ?? 0) - (b.uploadedAt?.toMillis?.() ?? 0));
      setBookingRows(data);
    });

    const unsubS = onSnapshot(collection(db, "examSessions"), snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => (a.uploadedAt?.toMillis?.() ?? 0) - (b.uploadedAt?.toMillis?.() ?? 0));
      setExamSessions(data);
    });

    return () => { unsubA(); unsubC(); unsubB(); unsubS(); };
  }, []);

  const isValidUrl = (url) => { try { new URL(url); return true; } catch { return false; } };

  const handleSave = async () => {
    if (!selSkill || !selLevel || !configUrl.trim()) { showToast("Fill in all fields.", "error"); return; }
    if (!isValidUrl(configUrl.trim())) { showToast("Enter a valid URL.", "error"); return; }
    const duplicate = assessments.find(a => a.skill === selSkill && a.level === selLevel && a.id !== editId);
    if (duplicate) { showToast(`${selSkill} - ${selLevel} already exists.`, "error"); return; }
    const duration = parseInt(selDuration) || 0;
    try {
      if (editId) {
        await updateDoc(doc(db, "assessments", editId), { skill: selSkill, level: selLevel, url: configUrl.trim(), duration });
        writeLog("updated", { assessmentId: editId, skill: selSkill, level: selLevel });
        showToast("Assessment updated.");
      } else {
        const ref = await addDoc(collection(db, "assessments"), { skill: selSkill, level: selLevel, url: configUrl.trim(), duration, createdAt: serverTimestamp() });
        writeLog("created", { assessmentId: ref.id, skill: selSkill, level: selLevel });
        showToast("Assessment saved.");
      }
      setSelSkill(""); setSelLevel(""); setConfigUrl(""); setSelDuration(""); setEditId(null);
    } catch { showToast("Failed to save. Try again.", "error"); }
  };

  const handleEdit = (a) => {
    setSelSkill(a.skill); setSelLevel(a.level); setConfigUrl(a.url);
    setSelDuration(a.duration ? String(a.duration) : ""); setEditId(a.id); setTab("entry");
  };

  const handleDelete = async (id) => {
    const a = assessments.find(x => x.id === id);
    try { await deleteDoc(doc(db, "assessments", id)); writeLog("deleted", { assessmentId: id, skill: a?.skill }); showToast("Deleted."); }
    catch { showToast("Failed to delete.", "error"); }
  };

  const handleAddSkill = async () => {
    const s = newSkill.trim();
    if (!s || skills.includes(s)) { showToast("Skill already exists or empty.", "error"); return; }
    try { await updateDoc(doc(db, "config", "main"), { skills: arrayUnion(s) }); writeLog("skill_added", { skill: s }); setNewSkill(""); showToast("Skill added."); }
    catch { showToast("Failed to add skill.", "error"); }
  };

  const handleRemoveSkill = async (s) => {
    try { await updateDoc(doc(db, "config", "main"), { skills: arrayRemove(s) }); writeLog("skill_removed", { skill: s }); showToast("Skill removed."); }
    catch { showToast("Failed to remove skill.", "error"); }
  };

  const handleAddLevel = async () => {
    const l = newLevel.trim().toUpperCase();
    if (!l || levels.includes(l)) { showToast("Level exists or empty.", "error"); return; }
    try { await updateDoc(doc(db, "config", "main"), { levels: arrayUnion(l) }); writeLog("level_added", { level: l }); setNewLevel(""); showToast("Level added."); }
    catch { showToast("Failed to add level.", "error"); }
  };

  const handleRemoveLevel = async (l) => {
    try { await updateDoc(doc(db, "config", "main"), { levels: arrayRemove(l) }); writeLog("level_removed", { level: l }); showToast("Level removed."); }
    catch { showToast("Failed to remove level.", "error"); }
  };

  const filtered = assessments.filter(a =>
    (filterSkill === "All" || a.skill === filterSkill) &&
    (filterLevel === "All" || a.level === filterLevel)
  );

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0d0e14; }
    @keyframes slideUp { from { transform: translateY(20px); opacity:0;} to { transform:translateY(0);opacity:1;} }
    @keyframes fadeIn { from {opacity:0;} to {opacity:1;} }
    ::-webkit-scrollbar { width: 5px; background: #1a1b24; }
    ::-webkit-scrollbar-thumb { background: #2e3044; border-radius: 4px; }
  `;

  const S = {
    root: { minHeight: "100vh", background: "#0d0e14", fontFamily: "'DM Mono', monospace", color: "#e0e0e8", display: "flex" },
    sidebar: { width: 240, background: "#0a0b10", borderRight: "1px solid #1e2030", display: "flex", flexDirection: "column", position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 200 },
    sidebarBrand: { padding: "24px 20px", borderBottom: "1px solid #1e2030", fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 15, color: "#fff", letterSpacing: "-0.3px", display: "flex", alignItems: "center", gap: 10 },
    dot: { width: 8, height: 8, borderRadius: "50%", background: "#00c896", display: "inline-block", flexShrink: 0 },
    sidebarNav: { padding: "12px 10px", flex: 1 },
    sidebarItem: (active) => ({ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "10px 12px", borderRadius: 8, fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 12.5, cursor: "pointer", color: active ? "#fff" : "#555a7a", background: active ? "#1a1b24" : "transparent", border: "none", borderLeft: active ? "2px solid #00c896" : "2px solid transparent", textAlign: "left", transition: "all 0.15s", marginBottom: 2 }),
    main: { marginLeft: 240, flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
    header: { borderBottom: "1px solid #1e2030", padding: "0 48px", display: "flex", alignItems: "flex-end", gap: 32, background: "#0d0e14", position: "sticky", top: 0, zIndex: 100 },
    headerTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: "#3a3d52", paddingBottom: 20, paddingTop: 20, marginRight: 8 },
    nav: { display: "flex", gap: 0 },
    navItem: (active) => ({ padding: "18px 18px", fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 13, cursor: "pointer", color: active ? "#fff" : "#555a7a", background: "none", border: "none", borderBottom: active ? "2px solid #00c896" : "2px solid transparent", transition: "color 0.15s" }),
    body: { padding: "36px 48px", maxWidth: 1300 },
    card: { background: "#13141e", border: "1px solid #1e2030", borderRadius: 12, padding: "28px 32px", marginBottom: 24 },
    label: { fontSize: 11, fontFamily: "'Syne', sans-serif", fontWeight: 700, letterSpacing: "0.12em", color: "#555a7a", textTransform: "uppercase", marginBottom: 8, display: "block" },
    select: { width: "100%", background: "#0d0e14", border: "1px solid #2e3044", borderRadius: 8, color: "#e0e0e8", padding: "11px 14px", fontFamily: "'DM Mono', monospace", fontSize: 13, outline: "none", appearance: "none", cursor: "pointer" },
    input: { width: "100%", background: "#0d0e14", border: "1px solid #2e3044", borderRadius: 8, color: "#e0e0e8", padding: "11px 14px", fontFamily: "'DM Mono', monospace", fontSize: 13, outline: "none" },
    btn: (variant = "primary") => ({ padding: "11px 24px", borderRadius: 8, fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, cursor: "pointer", background: variant === "primary" ? "#00c896" : variant === "danger" ? "transparent" : "#1e2030", color: variant === "primary" ? "#0d0e14" : variant === "danger" ? "#ff5555" : "#aab", border: variant === "danger" ? "1px solid #ff5555" : "none", transition: "opacity 0.15s" }),
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 },
    sectionTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, color: "#fff", marginBottom: 6 },
    sectionSub: { fontSize: 12, color: "#555a7a", marginBottom: 28 },
    table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
    th: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", color: "#555a7a", textTransform: "uppercase", padding: "10px 14px", textAlign: "left", borderBottom: "1px solid #1e2030" },
    td: { padding: "12px 14px", borderBottom: "1px solid #1a1b24", verticalAlign: "middle" },
    badge: (color = "#00c896") => ({ display: "inline-block", background: color + "18", color, borderRadius: 4, padding: "2px 10px", fontSize: 11, fontFamily: "'Syne', sans-serif", fontWeight: 700, letterSpacing: "0.08em" }),
    pill: { display: "inline-flex", alignItems: "center", gap: 8, background: "#1a1b24", border: "1px solid #2e3044", borderRadius: 20, padding: "5px 12px 5px 16px", fontSize: 12, color: "#c0c4d8", margin: "4px" },
    pillX: { cursor: "pointer", fontSize: 15, lineHeight: 1, background: "none", border: "none", padding: 0, color: "#ff5555" },
  };

  const NAV_ITEMS = [
    { key: "assessments", label: "Assessment Configurations", Icon: IconAssessment },
    { key: "bookings",    label: "Student Bookings",          Icon: IconBookings },
    { key: "create",      label: "Create Assessments",        Icon: IconCreate },
    { key: "invited",     label: "Invited Students",          Icon: IconInvited },
    ...(userProfile?.role === "admin" ? [{ key: "admin", label: "Admin Panel", Icon: IconAdmin }] : []),
  ];

  if (authLoading) return (
    <div style={{ minHeight: "100vh", background: "#0d0e14", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{css}</style>
      <span style={{ color: "#555a7a", fontFamily: "'Syne', sans-serif", fontSize: 14 }}>Loading…</span>
    </div>
  );
  if (!currentUser) return <LoginPage />;
  if (!userProfile || userProfile.status === "pending") return <PendingPage />;

  if (firestoreLoading) return (
    <div style={{ ...S.root, alignItems: "center", justifyContent: "center" }}>
      <span style={{ color: "#555a7a", fontFamily: "'Syne', sans-serif", fontSize: 14 }}>Connecting to database…</span>
    </div>
  );

  return (
    <div style={S.root}>
      <style>{css}</style>

      <aside style={S.sidebar}>
        <div style={S.sidebarBrand}><span style={S.dot} />NxtWave Admin</div>
        <nav style={S.sidebarNav}>
          {NAV_ITEMS.map(({ key, label, Icon }) => {
            const active = page === key;
            const locked = key !== "admin" && !allowedPages.includes(key);
            return (
              <button key={key}
                style={{ ...S.sidebarItem(active), color: locked ? "#3a3d52" : active ? "#fff" : "#555a7a", cursor: locked ? "not-allowed" : "pointer" }}
                title={locked ? "Contact admin for access" : undefined}
                onClick={() => { if (locked) { showToast("Contact admin for access.", "error"); return; } setPage(key); }}>
                <Icon color={locked ? "#3a3d52" : active ? "#fff" : "#555a7a"} />
                {label}
                {locked && <span style={{ marginLeft: "auto", fontSize: 10, color: "#3a3d52" }}>🔒</span>}
              </button>
            );
          })}
        </nav>
        <div style={{ padding: "14px 12px", borderTop: "1px solid #1e2030" }}>
          <div style={{ fontSize: 11, color: "#7eb8ff", fontFamily: "'DM Mono', monospace", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: 4 }}>
            {userProfile.displayName || userProfile.email}
          </div>
          <div style={{ fontSize: 10, color: "#3a3d52", fontFamily: "'Syne', sans-serif", fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.1em", paddingLeft: 4 }}>
            {userProfile.role ? userProfile.role.replace(/-/g, " ") : "No Role"}
          </div>
          <button onClick={() => signOut(auth)} style={{
            width: "100%", background: "transparent", border: "1px solid #2e3044",
            borderRadius: 6, color: "#555a7a", padding: "8px 12px",
            fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 11,
            cursor: "pointer", textAlign: "left",
          }}>
            Sign Out
          </button>
        </div>
      </aside>

      <div style={S.main}>

        {page === "assessments" && (
          <>
            <div style={S.header}>
              <span style={S.headerTitle}>Assessment Configurations</span>
              <nav style={S.nav}>
                {[["entry","Add / Edit"],["manage","All Assessments"],["settings","Skills & Levels"]].map(([key, label]) => (
                  <button key={key} style={S.navItem(tab === key)} onClick={() => setTab(key)}>{label}</button>
                ))}
              </nav>
              <div style={{ marginLeft: "auto", paddingBottom: 18, paddingTop: 18, fontSize: 12, color: "#555a7a" }}>
                {assessments.length} assessment{assessments.length !== 1 ? "s" : ""}
              </div>
            </div>

            <div style={S.body}>

              {tab === "entry" && (() => {
                const takenCombos = assessments.filter(a => a.id !== editId).map(a => `${a.skill}::${a.level}`);
                const takenSet = new Set(takenCombos);
                const skillFullyTaken = (s) => levels.every(l => takenSet.has(`${s}::${l}`));
                const levelTaken = (l) => selSkill && takenSet.has(`${selSkill}::${l}`);
                return (
                  <div style={{ animation: "fadeIn 0.2s ease" }}>
                    <div style={S.sectionTitle}>{editId ? "Edit Assessment" : "Add Assessment"}</div>
                    <div style={S.sectionSub}>Select skill and level, paste the config URL, and set the assessment duration.</div>
                    <div style={S.card}>
                      <div style={S.grid2}>
                        <div>
                          <label style={S.label}>Skill</label>
                          <select style={S.select} value={selSkill} onChange={e => { setSelSkill(e.target.value); setSelLevel(""); }}>
                            <option value="">— Select skill —</option>
                            {skills.map(s => { const t = skillFullyTaken(s); return <option key={s} value={s} disabled={t}>{s}{t ? " (all levels filled)" : ""}</option>; })}
                          </select>
                        </div>
                        <div>
                          <label style={S.label}>Level</label>
                          <select style={S.select} value={selLevel} onChange={e => setSelLevel(e.target.value)} disabled={!selSkill}>
                            <option value="">{selSkill ? "— Select level —" : "— Pick a skill first —"}</option>
                            {levels.map(l => { const t = levelTaken(l); return <option key={l} value={l} disabled={t}>{l}{t ? " (filled)" : ""}</option>; })}
                          </select>
                        </div>
                      </div>
                      {selSkill && (
                        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {levels.map(l => { const t = takenSet.has(`${selSkill}::${l}`); return (
                            <span key={l} style={{ fontSize: 11, fontFamily: "'Syne', sans-serif", fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: t ? "#ff555518" : "#00c89618", color: t ? "#ff5555" : "#00c896" }}>
                              {l} {t ? "✕ filled" : "✓ open"}
                            </span>
                          ); })}
                        </div>
                      )}
                      <div style={{ marginTop: 20 }}>
                        <label style={S.label}>Config URL</label>
                        <input style={S.input} type="url" placeholder="https://config.topin.tech/view-assessment/…"
                          value={configUrl} onChange={e => setConfigUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSave()} />
                      </div>
                      <div style={{ marginTop: 16 }}>
                        <label style={S.label}>Assessment Duration (minutes)</label>
                        <input style={{ ...S.input, maxWidth: 220 }} type="number" min="0" placeholder="e.g. 60"
                          value={selDuration} onChange={e => setSelDuration(e.target.value)} />
                        <div style={{ marginTop: 6, fontSize: 11, color: "#555a7a" }}>Used to compute End Time in Student Bookings. Leave blank to treat as 0.</div>
                      </div>
                      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
                        <button style={S.btn("primary")} onClick={handleSave}>{editId ? "Update Assessment" : "Save Assessment"}</button>
                        {editId && <button style={S.btn("secondary")} onClick={() => { setEditId(null); setSelSkill(""); setSelLevel(""); setConfigUrl(""); setSelDuration(""); }}>Cancel Edit</button>}
                      </div>
                    </div>
                    {assessments.length > 0 && (
                      <div style={S.card}>
                        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: "#555a7a", marginBottom: 16, letterSpacing: "0.08em", textTransform: "uppercase" }}>Recent Entries</div>
                        <table style={S.table}>
                          <thead><tr><th style={S.th}>Skill</th><th style={S.th}>Level</th><th style={S.th}>Duration</th><th style={S.th}>URL</th><th style={S.th}></th></tr></thead>
                          <tbody>
                            {[...assessments].reverse().slice(0, 5).map(a => (
                              <tr key={a.id}>
                                <td style={S.td}>{a.skill}</td>
                                <td style={S.td}><span style={S.badge()}>{a.level}</span></td>
                                <td style={{ ...S.td, color: "#555a7a" }}>{a.duration ? `${a.duration} min` : "—"}</td>
                                <td style={{ ...S.td, maxWidth: 280 }}>
                                  <a href={a.url} target="_blank" rel="noreferrer" style={{ color: "#00c896", textDecoration: "none", fontSize: 12 }}>{a.url.slice(0, 48)}…</a>
                                </td>
                                <td style={S.td}><button style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12 }} onClick={() => handleEdit(a)}>Edit</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              {tab === "manage" && (
                <div style={{ animation: "fadeIn 0.2s ease" }}>
                  <div style={S.sectionTitle}>All Assessments</div>
                  <div style={S.sectionSub}>View, filter, edit or delete stored assessment configs.</div>
                  <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
                    <div style={{ flex: 1 }}>
                      <label style={S.label}>Filter by Skill</label>
                      <select style={S.select} value={filterSkill} onChange={e => setFilterSkill(e.target.value)}>
                        <option value="All">All Skills</option>
                        {skills.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div style={{ width: 160 }}>
                      <label style={S.label}>Filter by Level</label>
                      <select style={S.select} value={filterLevel} onChange={e => setFilterLevel(e.target.value)}>
                        <option value="All">All Levels</option>
                        {levels.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={S.card}>
                    {filtered.length === 0 ? (
                      <div style={{ textAlign: "center", color: "#555a7a", padding: "40px 0", fontSize: 13 }}>No assessments found.</div>
                    ) : (
                      <table style={S.table}>
                        <thead><tr><th style={S.th}>Skill</th><th style={S.th}>Level</th><th style={S.th}>Duration</th><th style={S.th}>Config URL</th><th style={S.th}>Added</th><th style={S.th}></th></tr></thead>
                        <tbody>
                          {filtered.map(a => (
                            <tr key={a.id} onMouseEnter={e => e.currentTarget.style.background = "#1a1b24"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                              <td style={S.td}>{a.skill}</td>
                              <td style={S.td}><span style={S.badge()}>{a.level}</span></td>
                              <td style={{ ...S.td, color: "#555a7a" }}>{a.duration ? `${a.duration} min` : "—"}</td>
                              <td style={{ ...S.td, maxWidth: 300 }}>
                                <a href={a.url} target="_blank" rel="noreferrer" style={{ color: "#7eb8ff", textDecoration: "none", fontSize: 12, wordBreak: "break-all" }}>{a.url.length > 50 ? a.url.slice(0, 50) + "…" : a.url}</a>
                              </td>
                              <td style={{ ...S.td, fontSize: 11, color: "#555a7a", whiteSpace: "nowrap" }}>{formatDate(a.createdAt)}</td>
                              <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12 }} onClick={() => handleEdit(a)}>Edit</button>
                                  <button style={{ ...S.btn("danger"), padding: "6px 14px", fontSize: 12 }} onClick={() => handleDelete(a.id)}>Del</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

              {tab === "settings" && (
                <div style={{ animation: "fadeIn 0.2s ease" }}>
                  <div style={S.sectionTitle}>Skills & Levels</div>
                  <div style={S.sectionSub}>Add or remove skills and difficulty levels.</div>
                  <div style={S.grid2}>
                    <div style={S.card}>
                      <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#fff", marginBottom: 20 }}>Skills</div>
                      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                        <input style={{ ...S.input, flex: 1 }} placeholder="New skill name…" value={newSkill} onChange={e => setNewSkill(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddSkill()} />
                        <button style={{ ...S.btn("primary"), whiteSpace: "nowrap" }} onClick={handleAddSkill}>Add</button>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap" }}>
                        {skills.map(s => <div key={s} style={S.pill}>{s}<button style={S.pillX} onClick={() => handleRemoveSkill(s)}>×</button></div>)}
                      </div>
                    </div>
                    <div style={S.card}>
                      <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#fff", marginBottom: 20 }}>Levels</div>
                      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                        <input style={{ ...S.input, flex: 1 }} placeholder="e.g. L3, Advanced…" value={newLevel} onChange={e => setNewLevel(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddLevel()} />
                        <button style={{ ...S.btn("primary"), whiteSpace: "nowrap" }} onClick={handleAddLevel}>Add</button>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap" }}>
                        {levels.map(l => <div key={l} style={S.pill}><span style={S.badge()}>{l}</span><button style={S.pillX} onClick={() => handleRemoveLevel(l)}>×</button></div>)}
                      </div>
                    </div>
                  </div>
                  <div style={{ ...S.card, background: "#0d0e14", border: "1px solid #2e3044", padding: "20px 24px" }}>
                    <div style={{ fontSize: 12, color: "#555a7a", lineHeight: 1.8 }}>
                      <strong style={{ color: "#7eb8ff" }}>Note:</strong> Removing a skill or level does not delete assessments already stored under them.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {page === "bookings" && (
          <StudentBookings
            S={S}
            assessments={assessments}
            bookingRows={bookingRows}
            examSessions={examSessions}
            writeLog={writeLog}
            showToast={showToast}
          />
        )}

        {page === "create" && (
          <CreateAssessments
            S={S}
            examSessions={examSessions}
            bookingRows={bookingRows}
            showToast={showToast}
          />
        )}

        {page === "invited" && (
          <InvitedStudents
            S={S}
            bookingRows={bookingRows}
            examSessions={examSessions}
            showToast={showToast}
          />
        )}

        {page === "admin" && (
          <AdminPanel S={S} showToast={showToast} />
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
