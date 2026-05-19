import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  setDoc, getDoc, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove,
} from "firebase/firestore";

const DEFAULT_SKILLS = [
  "Applied Gen AI Development",
  "Computational Thinking",
  "Critical Thinking & Communication",
  "CS Fundamentals",
  "Quantitative Reasoning",
  "Server-Side Engineering",
  "SQL",
  "UI Engineering",
  "DS & ML",
];

const DEFAULT_LEVELS = ["L1", "L2", "L3"];

const PIN_CHARS = "ACDEFGHJKLMNPQRTUVWXYZ23456789";

// ── CSV helpers ──────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) return [];
  function splitRow(line) {
    const vals = []; let inQ = false, cur = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === "," && !inQ) { vals.push(cur); cur = ""; }
      else cur += c;
    }
    vals.push(cur);
    return vals.map(v => v.trim().replace(/^"|"$/g, ""));
  }
  const headers = splitRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitRow(lines[i]);
    const row = {};
    headers.forEach((h, j) => { row[h] = vals[j] ?? ""; });
    rows.push(row);
  }
  return rows;
}

function genPin() {
  let p = "";
  for (let i = 0; i < 6; i++) p += PIN_CHARS[Math.floor(Math.random() * PIN_CHARS.length)];
  return p;
}

function timeToMins(t) {
  if (!t) return 0;
  const s = t.trim();
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2]);
    const p = ampm[3].toUpperCase();
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

function buildExamId(skill, level, date, timeSlot) {
  const sk = skill.toUpperCase().replace(/\s+/g, "_");
  return `NG26_NIAT_GRIT_${sk}_L${level}_${toISODate(date)}_${minsToHHMM(timeToMins(timeSlot))}`;
}

function deriveExamSessions(rows, assessments, bufMins) {
  const seen = new Map();
  rows.forEach(row => {
    const skill = row["Skill"]?.trim();
    const level = row["Skill Level"]?.trim();
    const date = row["Contest Date"]?.trim();
    const timeSlot = row["Time Slot"]?.trim();
    if (!skill || !level || !date || !timeSlot) return;
    const key = `${skill}||${level}||${date}||${timeSlot}`;
    if (!seen.has(key)) seen.set(key, { skill, level, date, timeSlot });
  });
  const sessions = [];
  seen.forEach(({ skill, level, date, timeSlot }) => {
    const match = assessments.find(a => a.skill === skill && a.level === `L${level}`);
    const duration = parseInt(match?.duration) || 0;
    const startMins = timeToMins(timeSlot);
    const endMins = startMins + duration + bufMins;
    sessions.push({
      assessmentTitle: `${skill} - L${level}`,
      dateOfAssessment: toISODate(date),
      startTimeSlot: minsToTime(startMins),
      endTimeSlot: minsToTime(endMins),
      uniqueExamId: buildExamId(skill, level, date, timeSlot),
      exitPin: genPin(),
      skill, level,
    });
  });
  return sessions;
}

// ── UI components ─────────────────────────────────────────────────────────────

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

const SESSION_COLS = ["Assessment Title", "Date", "Start Time", "End Time", "Unique Exam ID", "EXIT PIN"];

function StudentBookings({ S, assessments, examSessions, writeLog, showToast }) {
  const [bookTab, setBookTab] = useState("upload");
  const [bufferTime, setBufferTime] = useState("30");
  const [csvRows, setCsvRows] = useState([]);
  const [preview, setPreview] = useState(null);
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef(null);

  const buildPreview = (rows, buf) => {
    const sessions = deriveExamSessions(rows, assessments, buf);
    if (!sessions.length) { showToast("No valid rows found in CSV.", "error"); setPreview(null); return; }
    setPreview(sessions);
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) { setCsvRows([]); setPreview(null); return; }
    const text = await file.text();
    const rows = parseCSV(text);
    setCsvRows(rows);
    buildPreview(rows, parseInt(bufferTime) || 0);
  };

  const handleBufferChange = (val) => {
    setBufferTime(val);
    if (csvRows.length) buildPreview(csvRows, parseInt(val) || 0);
  };

  const handleProcess = async () => {
    if (!preview?.length) return;
    setProcessing(true);
    try {
      const batchId = Date.now().toString();
      for (const session of preview) {
        await addDoc(collection(db, "examSessions"), {
          ...session, uploadBatchId: batchId, uploadedAt: serverTimestamp(),
        });
      }
      writeLog("exam_sessions_uploaded", { count: preview.length, batchId });
      showToast(`${preview.length} session${preview.length !== 1 ? "s" : ""} saved.`);
      setPreview(null); setCsvRows([]);
      if (fileRef.current) fileRef.current.value = "";
      setBookTab("sessions");
    } catch { showToast("Failed to save sessions.", "error"); }
    setProcessing(false);
  };

  const handleDeleteSession = async (id) => {
    try {
      await deleteDoc(doc(db, "examSessions", id));
      writeLog("exam_session_deleted", { sessionId: id });
      showToast("Session deleted.");
    } catch { showToast("Failed to delete.", "error"); }
  };

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={S.header}>
        <span style={S.headerTitle}>Student Bookings</span>
        <nav style={S.nav}>
          {[["upload", "Upload CSV"], ["sessions", "Exam Sessions"]].map(([key, label]) => (
            <button key={key} style={S.navItem(bookTab === key)} onClick={() => setBookTab(key)}>{label}</button>
          ))}
        </nav>
        <div style={{ marginLeft: "auto", paddingBottom: 18, paddingTop: 18, fontSize: 12, color: "#555a7a" }}>
          {examSessions.length} session{examSessions.length !== 1 ? "s" : ""} stored
        </div>
      </div>

      <div style={S.body}>
        {bookTab === "upload" && (
          <>
            <div style={S.sectionTitle}>Upload Booking CSV</div>
            <div style={S.sectionSub}>Upload a registrations CSV to auto-generate exam sessions with PINs.</div>

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

              {preview && (
                <div style={{ marginTop: 28 }}>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: "#00c896", marginBottom: 16, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Preview — {preview.length} unique session{preview.length !== 1 ? "s" : ""} detected
                  </div>
                  <div style={{ overflowX: "auto", marginBottom: 20 }}>
                    <table style={S.table}>
                      <thead><tr>{SESSION_COLS.map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
                      <tbody>
                        {preview.map((s, i) => (
                          <tr key={i}>
                            <td style={S.td}>{s.assessmentTitle}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.dateOfAssessment}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.startTimeSlot}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.endTimeSlot}</td>
                            <td style={{ ...S.td, fontSize: 11, color: "#7eb8ff", fontFamily: "'DM Mono', monospace" }}>{s.uniqueExamId}</td>
                            <td style={S.td}>
                              <span style={{ ...S.badge("#ff9966"), fontFamily: "'DM Mono', monospace", letterSpacing: "0.2em", fontSize: 13 }}>{s.exitPin}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <button style={S.btn("primary")} onClick={handleProcess} disabled={processing}>
                      {processing ? "Saving…" : "Save All Sessions"}
                    </button>
                    <button style={S.btn("secondary")} onClick={() => {
                      setPreview(null); setCsvRows([]);
                      if (fileRef.current) fileRef.current.value = "";
                    }}>Discard</button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ ...S.card, background: "#0d0e14", border: "1px solid #2e3044", padding: "20px 24px" }}>
              <div style={{ fontSize: 12, color: "#555a7a", lineHeight: 1.9 }}>
                <strong style={{ color: "#7eb8ff" }}>Required CSV columns:</strong> Skill, Skill Level, Contest Date, Time Slot<br />
                <strong style={{ color: "#7eb8ff" }}>End Time</strong> = Start Time + Assessment Duration + Buffer Time<br />
                <strong style={{ color: "#7eb8ff" }}>Assessment Duration</strong> is set per-assessment in Assessment Configurations → Add / Edit tab.
              </div>
            </div>
          </>
        )}

        {bookTab === "sessions" && (
          <>
            <div style={S.sectionTitle}>Exam Sessions</div>
            <div style={S.sectionSub}>All generated exam sessions with unique IDs and exit PINs.</div>
            <div style={S.card}>
              {examSessions.length === 0 ? (
                <div style={{ textAlign: "center", color: "#555a7a", padding: "60px 0", fontSize: 13 }}>
                  <div style={{ marginBottom: 10, fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#3a3d52" }}>No sessions yet</div>
                  Upload a CSV file to generate and store exam sessions.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        {SESSION_COLS.map(c => <th key={c} style={S.th}>{c}</th>)}
                        <th style={S.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {examSessions.map(s => (
                        <tr key={s.id}
                          onMouseEnter={e => e.currentTarget.style.background = "#1a1b24"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <td style={S.td}>{s.assessmentTitle}</td>
                          <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.dateOfAssessment}</td>
                          <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.startTimeSlot}</td>
                          <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.endTimeSlot}</td>
                          <td style={{ ...S.td, fontSize: 11, color: "#7eb8ff", fontFamily: "'DM Mono', monospace" }}>{s.uniqueExamId}</td>
                          <td style={S.td}>
                            <span style={{ ...S.badge("#ff9966"), fontFamily: "'DM Mono', monospace", letterSpacing: "0.2em", fontSize: 13 }}>{s.exitPin}</span>
                          </td>
                          <td style={S.td}>
                            <button style={{ ...S.btn("danger"), padding: "6px 14px", fontSize: 12 }}
                              onClick={() => handleDeleteSession(s.id)}>Del</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [assessments, setAssessments] = useState([]);
  const [skills, setSkills] = useState(DEFAULT_SKILLS);
  const [levels, setLevels] = useState(DEFAULT_LEVELS);
  const [examSessions, setExamSessions] = useState([]);
  const [loading, setLoading] = useState(true);
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

  const formatDate = (ts) => {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const writeLog = (action, details = {}) =>
    addDoc(collection(db, "logs"), { action, ...details, timestamp: serverTimestamp() }).catch(() => {});

  useEffect(() => {
    const configRef = doc(db, "config", "main");

    getDoc(configRef).then(snap => {
      if (!snap.exists()) setDoc(configRef, { skills: DEFAULT_SKILLS, levels: DEFAULT_LEVELS });
    });

    const unsubAssessments = onSnapshot(
      collection(db, "assessments"),
      (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
        setAssessments(data);
        setLoading(false);
      },
      () => setLoading(false),
    );

    const unsubConfig = onSnapshot(configRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.skills) setSkills(data.skills);
        if (data.levels) setLevels(data.levels);
      }
    });

    const unsubSessions = onSnapshot(
      collection(db, "examSessions"),
      (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.uploadedAt?.toMillis?.() ?? 0) - (b.uploadedAt?.toMillis?.() ?? 0));
        setExamSessions(data);
      },
    );

    return () => { unsubAssessments(); unsubConfig(); unsubSessions(); };
  }, []);

  const isValidUrl = (url) => {
    try { new URL(url); return true; } catch { return false; }
  };

  const handleSave = async () => {
    if (!selSkill || !selLevel || !configUrl.trim()) {
      showToast("Fill in all fields.", "error"); return;
    }
    if (!isValidUrl(configUrl.trim())) {
      showToast("Enter a valid URL.", "error"); return;
    }
    const duplicate = assessments.find(a =>
      a.skill === selSkill && a.level === selLevel && a.id !== editId
    );
    if (duplicate) {
      showToast(`${selSkill} - ${selLevel} already exists.`, "error"); return;
    }

    const duration = parseInt(selDuration) || 0;
    try {
      if (editId) {
        await updateDoc(doc(db, "assessments", editId), {
          skill: selSkill, level: selLevel, url: configUrl.trim(), duration,
        });
        writeLog("updated", { assessmentId: editId, skill: selSkill, level: selLevel });
        showToast("Assessment updated.");
      } else {
        const ref = await addDoc(collection(db, "assessments"), {
          skill: selSkill, level: selLevel, url: configUrl.trim(), duration,
          createdAt: serverTimestamp(),
        });
        writeLog("created", { assessmentId: ref.id, skill: selSkill, level: selLevel });
        showToast("Assessment saved.");
      }
      setSelSkill(""); setSelLevel(""); setConfigUrl(""); setSelDuration(""); setEditId(null);
    } catch {
      showToast("Failed to save. Try again.", "error");
    }
  };

  const handleEdit = (a) => {
    setSelSkill(a.skill); setSelLevel(a.level); setConfigUrl(a.url);
    setSelDuration(a.duration ? String(a.duration) : "");
    setEditId(a.id); setTab("entry");
  };

  const handleDelete = async (id) => {
    const assessment = assessments.find(a => a.id === id);
    try {
      await deleteDoc(doc(db, "assessments", id));
      writeLog("deleted", { assessmentId: id, skill: assessment?.skill, level: assessment?.level });
      showToast("Deleted.");
    } catch { showToast("Failed to delete.", "error"); }
  };

  const handleAddSkill = async () => {
    const s = newSkill.trim();
    if (!s || skills.includes(s)) { showToast("Skill already exists or empty.", "error"); return; }
    try {
      await updateDoc(doc(db, "config", "main"), { skills: arrayUnion(s) });
      writeLog("skill_added", { skill: s });
      setNewSkill(""); showToast("Skill added.");
    } catch { showToast("Failed to add skill.", "error"); }
  };

  const handleRemoveSkill = async (s) => {
    try {
      await updateDoc(doc(db, "config", "main"), { skills: arrayRemove(s) });
      writeLog("skill_removed", { skill: s }); showToast("Skill removed.");
    } catch { showToast("Failed to remove skill.", "error"); }
  };

  const handleAddLevel = async () => {
    const l = newLevel.trim().toUpperCase();
    if (!l || levels.includes(l)) { showToast("Level exists or empty.", "error"); return; }
    try {
      await updateDoc(doc(db, "config", "main"), { levels: arrayUnion(l) });
      writeLog("level_added", { level: l });
      setNewLevel(""); showToast("Level added.");
    } catch { showToast("Failed to add level.", "error"); }
  };

  const handleRemoveLevel = async (l) => {
    try {
      await updateDoc(doc(db, "config", "main"), { levels: arrayRemove(l) });
      writeLog("level_removed", { level: l }); showToast("Level removed.");
    } catch { showToast("Failed to remove level.", "error"); }
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
    sidebarBrand: { padding: "24px 20px", borderBottom: "1px solid #1e2030", fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 15, color: "#fff", letterSpacing: "-0.3px", display: "flex", alignItems: "center", gap: 10, lineHeight: 1.3 },
    dot: { width: 8, height: 8, borderRadius: "50%", background: "#00c896", display: "inline-block", flexShrink: 0 },
    sidebarNav: { padding: "12px 10px", flex: 1 },
    sidebarItem: (active) => ({
      display: "flex", alignItems: "center", gap: 11, width: "100%",
      padding: "10px 12px", borderRadius: 8, fontFamily: "'Syne', sans-serif",
      fontWeight: 600, fontSize: 12.5, letterSpacing: "0.01em", cursor: "pointer",
      color: active ? "#fff" : "#555a7a", background: active ? "#1a1b24" : "transparent",
      border: "none", borderLeft: active ? "2px solid #00c896" : "2px solid transparent",
      textAlign: "left", transition: "all 0.15s", marginBottom: 2,
    }),
    main: { marginLeft: 240, flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
    header: { borderBottom: "1px solid #1e2030", padding: "0 48px", display: "flex", alignItems: "flex-end", gap: 40, background: "#0d0e14", position: "sticky", top: 0, zIndex: 100 },
    headerTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: "#3a3d52", paddingBottom: 20, paddingTop: 20, marginRight: 8 },
    nav: { display: "flex", gap: 0 },
    navItem: (active) => ({
      padding: "18px 22px", fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 13,
      letterSpacing: "0.04em", cursor: "pointer", color: active ? "#fff" : "#555a7a",
      background: "none", border: "none", borderBottom: active ? "2px solid #00c896" : "2px solid transparent",
      transition: "color 0.15s",
    }),
    body: { padding: "40px 48px", maxWidth: 1200 },
    card: { background: "#13141e", border: "1px solid #1e2030", borderRadius: 12, padding: "32px 36px", marginBottom: 24 },
    label: { fontSize: 11, fontFamily: "'Syne', sans-serif", fontWeight: 700, letterSpacing: "0.12em", color: "#555a7a", textTransform: "uppercase", marginBottom: 8, display: "block" },
    select: { width: "100%", background: "#0d0e14", border: "1px solid #2e3044", borderRadius: 8, color: "#e0e0e8", padding: "11px 14px", fontFamily: "'DM Mono', monospace", fontSize: 13, outline: "none", appearance: "none", cursor: "pointer" },
    input: { width: "100%", background: "#0d0e14", border: "1px solid #2e3044", borderRadius: 8, color: "#e0e0e8", padding: "11px 14px", fontFamily: "'DM Mono', monospace", fontSize: 13, outline: "none" },
    btn: (variant = "primary") => ({
      padding: "11px 24px", borderRadius: 8, fontFamily: "'Syne', sans-serif", fontWeight: 700,
      fontSize: 13, letterSpacing: "0.04em", cursor: "pointer",
      background: variant === "primary" ? "#00c896" : variant === "danger" ? "transparent" : "#1e2030",
      color: variant === "primary" ? "#0d0e14" : variant === "danger" ? "#ff5555" : "#aab",
      border: variant === "danger" ? "1px solid #ff5555" : "none", transition: "opacity 0.15s",
    }),
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 },
    sectionTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, color: "#fff", marginBottom: 6 },
    sectionSub: { fontSize: 12, color: "#555a7a", marginBottom: 28 },
    table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
    th: { fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", color: "#555a7a", textTransform: "uppercase", padding: "10px 16px", textAlign: "left", borderBottom: "1px solid #1e2030" },
    td: { padding: "14px 16px", borderBottom: "1px solid #1a1b24", verticalAlign: "middle" },
    badge: (color = "#00c896") => ({
      display: "inline-block", background: color + "18", color, borderRadius: 4,
      padding: "2px 10px", fontSize: 11, fontFamily: "'Syne', sans-serif", fontWeight: 700, letterSpacing: "0.08em",
    }),
    pill: { display: "inline-flex", alignItems: "center", gap: 8, background: "#1a1b24", border: "1px solid #2e3044", borderRadius: 20, padding: "5px 12px 5px 16px", fontSize: 12, color: "#c0c4d8", margin: "4px" },
    pillX: { cursor: "pointer", fontSize: 15, lineHeight: 1, background: "none", border: "none", padding: 0, color: "#ff5555" },
  };

  const NAV_ITEMS = [
    { key: "assessments", label: "Assessment Configurations", Icon: IconAssessment },
    { key: "bookings", label: "Student Bookings", Icon: IconBookings },
  ];

  if (loading) return (
    <div style={{ ...S.root, alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <span style={{ color: "#555a7a", fontFamily: "'Syne', sans-serif", fontSize: 14 }}>Connecting to database...</span>
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
            return (
              <button key={key} style={S.sidebarItem(active)} onClick={() => setPage(key)}>
                <Icon color={active ? "#fff" : "#555a7a"} />{label}
              </button>
            );
          })}
        </nav>
      </aside>

      <div style={S.main}>

        {page === "assessments" && (
          <>
            <div style={S.header}>
              <span style={S.headerTitle}>Assessment Configurations</span>
              <nav style={S.nav}>
                {[["entry", "Add / Edit"], ["manage", "All Assessments"], ["settings", "Skills & Levels"]].map(([key, label]) => (
                  <button key={key} style={S.navItem(tab === key)} onClick={() => setTab(key)}>{label}</button>
                ))}
              </nav>
              <div style={{ marginLeft: "auto", paddingBottom: 18, paddingTop: 18, fontSize: 12, color: "#555a7a" }}>
                {assessments.length} assessment{assessments.length !== 1 ? "s" : ""} stored
              </div>
            </div>

            <div style={S.body}>

              {tab === "entry" && (() => {
                const takenCombos = assessments.filter(a => a.id !== editId).map(a => `${a.skill}::${a.level}`);
                const takenSet = new Set(takenCombos);
                const skillFullyTaken = (s) => levels.every(l => takenSet.has(`${s}::${l}`));
                const levelTakenForSkill = (l) => selSkill && takenSet.has(`${selSkill}::${l}`);

                return (
                  <div style={{ animation: "fadeIn 0.2s ease" }}>
                    <div style={S.sectionTitle}>{editId ? "Edit Assessment" : "Add Assessment"}</div>
                    <div style={S.sectionSub}>Select a skill and level, then paste the config URL and set the assessment duration.</div>

                    <div style={S.card}>
                      <div style={S.grid2}>
                        <div>
                          <label style={S.label}>Skill</label>
                          <select style={S.select} value={selSkill} onChange={e => { setSelSkill(e.target.value); setSelLevel(""); }}>
                            <option value="">— Select skill —</option>
                            {skills.map(s => {
                              const taken = skillFullyTaken(s);
                              return <option key={s} value={s} disabled={taken}>{s}{taken ? " (all levels filled)" : ""}</option>;
                            })}
                          </select>
                        </div>
                        <div>
                          <label style={S.label}>Level</label>
                          <select style={S.select} value={selLevel} onChange={e => setSelLevel(e.target.value)} disabled={!selSkill}>
                            <option value="">{selSkill ? "— Select level —" : "— Pick a skill first —"}</option>
                            {levels.map(l => {
                              const taken = levelTakenForSkill(l);
                              return <option key={l} value={l} disabled={taken}>{l}{taken ? " (filled)" : ""}</option>;
                            })}
                          </select>
                        </div>
                      </div>

                      {selSkill && (
                        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {levels.map(l => {
                            const taken = takenSet.has(`${selSkill}::${l}`);
                            return (
                              <span key={l} style={{ fontSize: 11, fontFamily: "'Syne', sans-serif", fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: taken ? "#ff555518" : "#00c89618", color: taken ? "#ff5555" : "#00c896", letterSpacing: "0.06em" }}>
                                {l} {taken ? "✕ filled" : "✓ open"}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      <div style={{ marginTop: 20 }}>
                        <label style={S.label}>Config URL</label>
                        <input style={S.input} type="url" placeholder="https://config.topin.tech/view-assessment/…"
                          value={configUrl} onChange={e => setConfigUrl(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && handleSave()} />
                      </div>

                      <div style={{ marginTop: 16 }}>
                        <label style={S.label}>Assessment Duration (minutes)</label>
                        <input style={{ ...S.input, maxWidth: 220 }} type="number" min="0" placeholder="e.g. 60"
                          value={selDuration} onChange={e => setSelDuration(e.target.value)} />
                        <div style={{ marginTop: 6, fontSize: 11, color: "#555a7a" }}>
                          Used to calculate End Time Slot in Student Bookings. Leave blank to treat as 0.
                        </div>
                      </div>

                      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
                        <button style={S.btn("primary")} onClick={handleSave}>
                          {editId ? "Update Assessment" : "Save Assessment"}
                        </button>
                        {editId && (
                          <button style={S.btn("secondary")} onClick={() => {
                            setEditId(null); setSelSkill(""); setSelLevel(""); setConfigUrl(""); setSelDuration("");
                          }}>Cancel Edit</button>
                        )}
                      </div>
                    </div>

                    {assessments.length > 0 && (
                      <div style={S.card}>
                        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: "#555a7a", marginBottom: 16, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                          Recent Entries
                        </div>
                        <table style={S.table}>
                          <thead>
                            <tr>
                              <th style={S.th}>Skill</th><th style={S.th}>Level</th>
                              <th style={S.th}>Duration</th><th style={S.th}>URL</th><th style={S.th}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...assessments].reverse().slice(0, 5).map(a => (
                              <tr key={a.id}>
                                <td style={S.td}>{a.skill}</td>
                                <td style={S.td}><span style={S.badge()}>{a.level}</span></td>
                                <td style={{ ...S.td, color: "#555a7a" }}>{a.duration ? `${a.duration} min` : "—"}</td>
                                <td style={{ ...S.td, maxWidth: 280 }}>
                                  <a href={a.url} target="_blank" rel="noreferrer" style={{ color: "#00c896", textDecoration: "none", fontSize: 12, wordBreak: "break-all" }}>
                                    {a.url.slice(0, 48)}…
                                  </a>
                                </td>
                                <td style={S.td}>
                                  <button style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12 }} onClick={() => handleEdit(a)}>Edit</button>
                                </td>
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
                        <thead>
                          <tr>
                            <th style={S.th}>Skill</th><th style={S.th}>Level</th>
                            <th style={S.th}>Duration</th><th style={S.th}>Config URL</th>
                            <th style={S.th}>Added</th><th style={S.th}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map(a => (
                            <tr key={a.id}
                              onMouseEnter={e => e.currentTarget.style.background = "#1a1b24"}
                              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                              <td style={S.td}>{a.skill}</td>
                              <td style={S.td}><span style={S.badge()}>{a.level}</span></td>
                              <td style={{ ...S.td, color: "#555a7a" }}>{a.duration ? `${a.duration} min` : "—"}</td>
                              <td style={{ ...S.td, maxWidth: 300 }}>
                                <a href={a.url} target="_blank" rel="noreferrer" style={{ color: "#7eb8ff", textDecoration: "none", fontSize: 12, wordBreak: "break-all" }}>
                                  {a.url.length > 50 ? a.url.slice(0, 50) + "…" : a.url}
                                </a>
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
                  <div style={S.sectionSub}>Add or remove skills and difficulty levels used across assessments.</div>

                  <div style={S.grid2}>
                    <div style={S.card}>
                      <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#fff", marginBottom: 20 }}>Skills</div>
                      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                        <input style={{ ...S.input, flex: 1 }} placeholder="New skill name…"
                          value={newSkill} onChange={e => setNewSkill(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && handleAddSkill()} />
                        <button style={{ ...S.btn("primary"), whiteSpace: "nowrap" }} onClick={handleAddSkill}>Add</button>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap" }}>
                        {skills.map(s => (
                          <div key={s} style={S.pill}>{s}
                            <button style={S.pillX} onClick={() => handleRemoveSkill(s)} title="Remove">×</button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={S.card}>
                      <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#fff", marginBottom: 20 }}>Levels</div>
                      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                        <input style={{ ...S.input, flex: 1 }} placeholder="e.g. L3, Advanced…"
                          value={newLevel} onChange={e => setNewLevel(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && handleAddLevel()} />
                        <button style={{ ...S.btn("primary"), whiteSpace: "nowrap" }} onClick={handleAddLevel}>Add</button>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap" }}>
                        {levels.map(l => (
                          <div key={l} style={S.pill}>
                            <span style={S.badge()}>{l}</span>
                            <button style={S.pillX} onClick={() => handleRemoveLevel(l)} title="Remove">×</button>
                          </div>
                        ))}
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
            examSessions={examSessions}
            writeLog={writeLog}
            showToast={showToast}
          />
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
