import { useState, useMemo, useEffect, useCallback } from "react";
import { getBookings, getSessions, updateSession } from "./api/firestore";

const PAGE_SIZE = 20;

const FILTER_INIT = { contestDate: "All", skill: "All", level: "All", timeSlot: "All", campus: "All", inviteStatus: "All" };
const T2_FILTER_INIT = { dateOfAssessment: "All", skill: "All", level: "All", startTimeSlot: "All", publishStatus: "All" };

const COLS = [
  "Student Name", "NIAT ID", "Student UID", "Skill", "Level",
  "Contest Date", "Time Slot", "Campus", "Unique Exam ID", "Invite",
  "User Assessment Link", "Config Link", "Details Link",
];
const T2_COLS = ["Assessment Title","Date","Start Time","End Time","Unique Exam ID","EXIT PIN","Topin ID","Publish Status","Config Link","User Assessment Link","Details Link"];

function deriveUserLink(assessmentLink) {
  if (!assessmentLink) return null;
  try {
    const url = new URL(assessmentLink);
    url.searchParams.delete("a_t");
    return url.toString();
  } catch {
    return assessmentLink.replace(/[?&]a_t=CLIENT/g, "").replace(/\?$/, "");
  }
}

function parseSessionSkillLevel(title) {
  if (!title) return { skill: "", level: "" };
  const m = title.match(/^(.*?)\s*-\s*(L\d+)$/i);
  return m ? { skill: m[1].trim(), level: m[2].toUpperCase() } : { skill: title.trim(), level: "" };
}

export default function InvitedStudents({ S, showToast }) {
  const [activeTab, setActiveTab]     = useState("students");
  const [bookingRows, setBookingRows] = useState([]);
  const [examSessions, setExamSessions] = useState([]);
  const [loading, setLoading]         = useState(true);

  // students tab state
  const [filters, setFilters] = useState(FILTER_INIT);
  const [search, setSearch]   = useState("");
  const [pg, setPg]           = useState(1);

  // assessments tab state
  const [t2Filters, setT2Filters] = useState(T2_FILTER_INIT);
  const [t2Page, setT2Page]       = useState(1);
  const [markModal, setMarkModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bookingsData, sessionsData] = await Promise.all([getBookings(), getSessions()]);
      setBookingRows(bookingsData || []);
      setExamSessions(sessionsData || []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const sessionMap = useMemo(() => {
    const m = new Map();
    examSessions.forEach(s => { if (s.sessionKey) m.set(s.sessionKey, s); });
    return m;
  }, [examSessions]);

  // ── Students tab ─────────────────────────────────────────────────────────────

  const rows = useMemo(() =>
    bookingRows.map(row => {
      const s = row.sessionKey ? sessionMap.get(row.sessionKey) : null;
      return {
        ...row,
        uniqueExamId: s?.uniqueExamId ?? "—",
        userAssessmentLink: s?.assessmentLink ? deriveUserLink(s.assessmentLink) : null,
        viewAssessmentUrl: s?.viewAssessmentUrl ?? null,
        viewDetailsUrl: s?.viewDetailsUrl ?? null,
        mapped: !!s,
      };
    }), [bookingRows, sessionMap]);

  const opts = useMemo(() => ({
    contestDate:  ["All", ...[...new Set(rows.map(r => r.contestDate))].filter(Boolean).sort()],
    skill:        ["All", ...[...new Set(rows.map(r => r.skill))].filter(Boolean).sort()],
    level:        ["All", ...[...new Set(rows.map(r => r.skillLevel))].filter(Boolean).sort()],
    timeSlot:     ["All", ...[...new Set(rows.map(r => r.timeSlot))].filter(Boolean).sort()],
    campus:       ["All", ...[...new Set(rows.map(r => r.campus))].filter(Boolean).sort()],
    inviteStatus: ["All", "sent", "failed", "not sent"],
  }), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (filters.contestDate  !== "All" && r.contestDate !== filters.contestDate) return false;
      if (filters.skill        !== "All" && r.skill       !== filters.skill)       return false;
      if (filters.level        !== "All" && r.skillLevel  !== filters.level)       return false;
      if (filters.timeSlot     !== "All" && r.timeSlot    !== filters.timeSlot)    return false;
      if (filters.campus       !== "All" && r.campus      !== filters.campus)       return false;
      if (filters.inviteStatus !== "All") {
        const status = r.inviteStatus === "sent" ? "sent" : r.inviteStatus === "failed" ? "failed" : "not sent";
        if (status !== filters.inviteStatus) return false;
      }
      if (q) {
        const haystack = [r.studentName, r.niatId, r.studentUid, r.uniqueExamId].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filters, search]);

  const pages   = Math.ceil(filtered.length / PAGE_SIZE);
  const paged   = filtered.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE);
  const setFilter   = (key, val) => { setFilters(f => ({ ...f, [key]: val })); setPg(1); };
  const resetFilters = () => { setFilters(FILTER_INIT); setSearch(""); setPg(1); };
  const anyActive = Object.values(filters).some(v => v !== "All") || search.trim() !== "";

  // ── Assessments tab ──────────────────────────────────────────────────────────

  const t2Opts = useMemo(() => {
    const skills = new Set(), levels = new Set(), times = new Set(), dates = new Set();
    examSessions.forEach(s => {
      const { skill, level } = parseSessionSkillLevel(s.assessmentTitle);
      if (skill) skills.add(skill); if (level) levels.add(level);
      if (s.startTimeSlot) times.add(s.startTimeSlot);
      if (s.dateOfAssessment) dates.add(s.dateOfAssessment);
    });
    return { dateOfAssessment: [...dates].sort(), skill: [...skills].sort(), level: [...levels].sort(), startTimeSlot: [...times].sort() };
  }, [examSessions]);

  const t2Filtered = useMemo(() =>
    examSessions.filter(s => {
      const f = t2Filters;
      const { skill, level } = parseSessionSkillLevel(s.assessmentTitle);
      if (f.dateOfAssessment !== "All" && s.dateOfAssessment !== f.dateOfAssessment) return false;
      if (f.skill            !== "All" && skill              !== f.skill)             return false;
      if (f.level            !== "All" && level              !== f.level)             return false;
      if (f.startTimeSlot    !== "All" && s.startTimeSlot    !== f.startTimeSlot)     return false;
      if (f.publishStatus    !== "All") {
        const st = s.publishStatus || "pending";
        if (st !== f.publishStatus) return false;
      }
      return true;
    }), [examSessions, t2Filters]);

  const t2Pages = Math.ceil(t2Filtered.length / PAGE_SIZE);
  const t2Paged = t2Filtered.slice((t2Page - 1) * PAGE_SIZE, t2Page * PAGE_SIZE);
  const t2AnyActive = Object.values(t2Filters).some(v => v !== "All");

  const handleMarkPublished = async () => {
    if (!markModal?.topinId?.trim()) return;
    try {
      await updateSession(markModal.session.id, {
        publishStatus: "published",
        topinAssessmentId: markModal.topinId.trim(),
        assessmentLink: markModal.link.trim() || null,
      });
      showToast("Marked as published.");
      setMarkModal(null);
      load();
    } catch { showToast("Failed to update.", "error"); }
  };

  // ── Shared helpers ───────────────────────────────────────────────────────────

  const copyLink = (link) => {
    navigator.clipboard.writeText(link).then(() => showToast("Link copied!")).catch(() => showToast("Copy failed.", "error"));
  };

  const downloadStudentsCSV = () => {
    const headers = ["Student Name","NIAT ID","Student UID","Skill","Level","Contest Date","Time Slot","Campus","Unique Exam ID","Invite Status","User Assessment Link","Config Link","Details Link"];
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csvRows = [
      headers.map(esc).join(","),
      ...filtered.map(r => [
        r.studentName, r.niatId, r.studentUid, r.skill, r.skillLevel,
        r.contestDate, r.timeSlot, r.campus ?? "", r.uniqueExamId,
        r.inviteStatus === "sent" ? "Sent" : r.inviteStatus === "failed" ? "Failed" : "Not Sent",
        r.userAssessmentLink ?? "", r.viewAssessmentUrl ?? "", r.viewDetailsUrl ?? "",
      ].map(esc).join(",")),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csvRows.join("\n")], { type: "text/csv" }));
    a.download = `invited-students${filters.contestDate !== "All" ? `-${filters.contestDate}` : ""}.csv`;
    a.click();
  };

  const downloadAssessmentsCSV = () => {
    const h = ["Assessment Title","Date","Start Time","End Time","Unique Exam ID","EXIT PIN","Topin ID","Publish Status","Config Link","User Assessment Link","Details Link"];
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csvRows = [
      h.map(esc).join(","),
      ...t2Filtered.map(s => [
        s.assessmentTitle, s.dateOfAssessment, s.startTimeSlot, s.endTimeSlot,
        s.uniqueExamId, s.exitPin, s.topinAssessmentId ?? "", s.publishStatus ?? "pending",
        s.viewAssessmentUrl ?? "", s.assessmentLink ?? "", s.viewDetailsUrl ?? "",
      ].map(esc).join(",")),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csvRows.join("\n")], { type: "text/csv" }));
    a.download = `unique-assessments${t2Filters.dateOfAssessment !== "All" ? `-${t2Filters.dateOfAssessment}` : ""}.csv`;
    a.click();
  };

  const selStyle = { ...S.select, width: "auto", minWidth: 120 };

  if (loading) return (
    <div style={{ padding: "80px 48px", color: "#94a3b8", fontFamily: "'Inter', sans-serif", fontSize: 14 }}>Loading…</div>
  );

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={S.header}>
        <span style={S.headerTitle}>Invited Students</span>
        <nav style={S.nav}>
          {[["students","Invited Students"],["assessments","Unique Assessments"]].map(([key,label]) => (
            <button key={key} style={S.navItem(activeTab === key)} onClick={() => setActiveTab(key)}>{label}</button>
          ))}
        </nav>
        <div style={{ marginLeft: "auto", paddingBottom: 18, paddingTop: 18, display: "flex", alignItems: "center", gap: 12 }}>
          {activeTab === "students" && (
            <>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                {filtered.length !== rows.length ? `${filtered.length} of ${rows.length} students` : `${rows.length} students`}
              </span>
              {filtered.length > 0 && (
                <button onClick={downloadStudentsCSV} style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12, whiteSpace: "nowrap" }}>
                  Download CSV
                </button>
              )}
            </>
          )}
          {activeTab === "assessments" && t2Filtered.length > 0 && (
            <button onClick={downloadAssessmentsCSV} style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12, whiteSpace: "nowrap" }}>
              Download CSV
            </button>
          )}
          <button onClick={load} style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12, whiteSpace: "nowrap" }}>Refresh</button>
        </div>
      </div>

      <div style={S.body}>

        {/* ── Invited Students tab ── */}
        {activeTab === "students" && (
          <>
            <div style={{ marginBottom: 20 }}>
              <div style={S.sectionTitle}>Invited Students</div>
              <div style={{ ...S.sectionSub, marginBottom: 12 }}>All students with their personalised assessment links.</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "10px 14px", background: "#f0fdf9", border: "1px solid #bbf7e0", borderRadius: 8 }}>
                <span style={{ fontSize: 12, fontFamily: "'Inter', sans-serif", fontWeight: 600, color: "#0f172a", whiteSpace: "nowrap" }}>Attendance Scanner Link:</span>
                <a href="https://config.topin.tech/mark-user-attendance" target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "#059669", textDecoration: "none" }}>
                  https://config.topin.tech/mark-user-attendance
                </a>
                <button onClick={() => copyLink("https://config.topin.tech/mark-user-attendance")}
                  style={{ ...S.btn("secondary"), padding: "3px 10px", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>
                  Copy
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <input type="text" placeholder="Search name, NIAT ID, UID, Exam ID…" value={search}
                  onChange={e => { setSearch(e.target.value); setPg(1); }}
                  style={{ ...S.input, margin: 0, width: 260, fontSize: 12 }} />
                {[["contestDate","Date"],["skill","Skill"],["level","Level"],["timeSlot","Time Slot"],["campus","Campus"],["inviteStatus","Invite"]].map(([key,label]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: "#64748b", fontFamily: "'Inter', sans-serif", fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
                    <select style={{ ...selStyle, borderColor: filters[key] !== "All" ? "#00c896" : undefined }}
                      value={filters[key]} onChange={e => setFilter(key, e.target.value)}>
                      {opts[key].map(v => <option key={v} value={v}>{v === "All" ? `All ${label}s` : v}</option>)}
                    </select>
                  </div>
                ))}
                {anyActive && <button onClick={resetFilters} style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12, whiteSpace: "nowrap" }}>Reset</button>}
              </div>
            </div>

            <div style={S.card}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", color: "#94a3b8", padding: "60px 0", fontSize: 13 }}>
                  <div style={{ marginBottom: 10, fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 15, color: "#94a3b8" }}>
                    {rows.length === 0 ? "No data yet" : "No results for selected filters"}
                  </div>
                  {rows.length === 0 && "Upload a CSV and publish assessments to populate this table."}
                  {rows.length > 0 && anyActive && <button onClick={resetFilters} style={{ ...S.btn("secondary"), marginTop: 12, fontSize: 12 }}>Clear filters</button>}
                </div>
              ) : (
                <>
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead><tr>{COLS.map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
                      <tbody>
                        {paged.map((row, i) => (
                          <tr key={row.id || i}
                            onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            <td style={S.td}>{row.studentName || "—"}</td>
                            <td style={S.td}>{row.niatId || "—"}</td>
                            <td style={{ ...S.td, fontSize: 11, fontFamily: "'DM Mono', monospace" }}>{row.studentUid || "—"}</td>
                            <td style={S.td}>{row.skill || "—"}</td>
                            <td style={S.td}>{row.skillLevel || "—"}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{row.contestDate || "—"}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{row.timeSlot || "—"}</td>
                            <td style={S.td}>{row.campus || "—"}</td>
                            <td style={{ ...S.td, fontSize: 11, fontFamily: "'DM Mono', monospace", color: row.mapped ? "#3b82f6" : "#94a3b8" }}>
                              {row.uniqueExamId}
                              {!row.mapped && <span title="No matching exam session" style={{ marginLeft: 6, color: "#f5a623" }}>⚠</span>}
                            </td>
                            <td style={S.td}>
                              {row.inviteStatus === "sent" ? <span style={S.badge("#00c896")}>Sent</span>
                                : row.inviteStatus === "failed" ? <span style={S.badge("#ff5555")}>Failed</span>
                                : <span style={S.badge("#94a3b8")}>Not Sent</span>}
                            </td>
                            <td style={{ ...S.td, maxWidth: 260 }}>
                              {row.userAssessmentLink ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <a href={row.userAssessmentLink} target="_blank" rel="noreferrer"
                                    style={{ color: "#00c896", textDecoration: "none", fontSize: 11, fontFamily: "'DM Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190, display: "inline-block" }}>
                                    {row.userAssessmentLink.length > 42 ? row.userAssessmentLink.slice(0, 42) + "…" : row.userAssessmentLink}
                                  </a>
                                  <button onClick={() => copyLink(row.userAssessmentLink)}
                                    style={{ ...S.btn("secondary"), padding: "3px 10px", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>Copy</button>
                                </div>
                              ) : <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>}
                            </td>
                            {[["viewAssessmentUrl","Config"],["viewDetailsUrl","Details"]].map(([field,label]) => (
                              <td key={field} style={{ ...S.td, maxWidth: 200 }}>
                                {row[field] ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <a href={row[field]} target="_blank" rel="noreferrer"
                                      style={{ color: "#3b82f6", textDecoration: "none", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>{label} ↗</a>
                                    <button onClick={() => copyLink(row[field])}
                                      style={{ ...S.btn("secondary"), padding: "3px 8px", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>Copy</button>
                                  </div>
                                ) : <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {pages > 1 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
                      <span style={{ fontSize: 11, color: "#64748b", fontFamily: "'Inter', sans-serif" }}>
                        {(pg - 1) * PAGE_SIZE + 1}–{Math.min(pg * PAGE_SIZE, filtered.length)} of {filtered.length}
                      </span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {[["«",1],["‹",pg-1]].map(([lbl,p]) => (
                          <button key={lbl} disabled={pg===1} onClick={() => setPg(p)}
                            style={{ ...S.btn("secondary"), padding: "6px 12px", fontSize: 12, opacity: pg===1?0.35:1 }}>{lbl}</button>
                        ))}
                        <span style={{ padding: "6px 14px", fontSize: 12, color: "#475569", background: "#f1f5f9", borderRadius: 8 }}>{pg} / {pages}</span>
                        {[["›",pg+1],["»",pages]].map(([lbl,p]) => (
                          <button key={lbl} disabled={pg===pages} onClick={() => setPg(p)}
                            style={{ ...S.btn("secondary"), padding: "6px 12px", fontSize: 12, opacity: pg===pages?0.35:1 }}>{lbl}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* ── Unique Assessments tab ── */}
        {activeTab === "assessments" && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={S.sectionTitle}>Unique Assessments</div>
                <div style={{ ...S.sectionSub, marginBottom: 0 }}>One row per unique exam slot.</div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                {[
                  { key: "dateOfAssessment", label: "Date",    opts: t2Opts.dateOfAssessment },
                  { key: "skill",            label: "Skill",   opts: t2Opts.skill },
                  { key: "level",            label: "Level",   opts: t2Opts.level },
                  { key: "startTimeSlot",    label: "Time",    opts: t2Opts.startTimeSlot },
                  { key: "publishStatus",    label: "Status",  opts: ["pending","published","failed"], display: { pending:"Pending", published:"Published", failed:"Failed" } },
                ].map(({ key, label, opts, display }) => (
                  <select key={key} style={{ ...S.select, width: "auto", minWidth: 110, padding: "7px 10px", fontSize: 12 }}
                    value={t2Filters[key]} onChange={e => { setT2Filters(f => ({ ...f, [key]: e.target.value })); setT2Page(1); }}>
                    <option value="All">All {label}s</option>
                    {opts.map(v => <option key={v} value={v}>{display ? display[v] ?? v : v}</option>)}
                  </select>
                ))}
                {t2AnyActive && (
                  <button onClick={() => { setT2Filters(T2_FILTER_INIT); setT2Page(1); }}
                    style={{ ...S.btn("secondary"), padding: "7px 14px", fontSize: 12 }}>Reset</button>
                )}
              </div>
            </div>

            <div style={S.card}>
              {t2Filtered.length === 0 ? (
                <div style={{ textAlign: "center", color: "#555a7a", padding: "60px 0" }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 15, color: "#94a3b8", marginBottom: 10 }}>
                    {examSessions.length === 0 ? "No sessions yet" : "No results"}
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead><tr>{T2_COLS.map(c => <th key={c} style={S.th}>{c}</th>)}<th style={S.th}></th></tr></thead>
                      <tbody>
                        {t2Paged.map(s => (
                          <tr key={s.id}
                            onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            <td style={S.td}>{s.assessmentTitle}{s.hasMissingConfig && <span title="Duration unknown" style={{ marginLeft: 6, fontSize: 11, color: "#f5a623" }}>⚠</span>}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.dateOfAssessment}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.startTimeSlot}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.endTimeSlot}</td>
                            <td style={{ ...S.td, fontSize: 11, color: "#3b82f6", fontFamily: "'DM Mono', monospace" }}>{s.uniqueExamId}</td>
                            <td style={S.td}><span style={{ ...S.badge("#ff9966"), fontFamily: "'DM Mono', monospace", letterSpacing: "0.2em", fontSize: 13 }}>{s.exitPin}</span></td>
                            <td style={{ ...S.td, fontSize: 11, color: "#3b82f6", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>{s.topinAssessmentId ? s.topinAssessmentId.slice(0, 8) + "…" : "—"}</td>
                            <td style={S.td}>{s.publishStatus === "published" ? <span style={S.badge("#00c896")}>Published</span> : s.publishStatus === "failed" ? <span style={S.badge("#ff5555")}>Failed</span> : <span style={S.badge("#555a7a")}>Pending</span>}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.viewAssessmentUrl ? <a href={s.viewAssessmentUrl} target="_blank" rel="noreferrer" style={{ color: "#3b82f6", textDecoration: "none", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>Config ↗</a> : <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.assessmentLink ? <a href={s.assessmentLink} target="_blank" rel="noreferrer" style={{ color: "#3b82f6", textDecoration: "none", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>User Link ↗</a> : <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>}</td>
                            <td style={{ ...S.td, whiteSpace: "nowrap" }}>{s.viewDetailsUrl ? <a href={s.viewDetailsUrl} target="_blank" rel="noreferrer" style={{ color: "#3b82f6", textDecoration: "none", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>Details ↗</a> : <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>}</td>
                            <td style={S.td}>
                              {s.publishStatus !== "published"
                                ? <button onClick={() => setMarkModal({ session: s, topinId: s.topinAssessmentId || "", link: s.assessmentLink || "" })}
                                    style={{ ...S.btn("secondary"), padding: "5px 10px", fontSize: 11, border: "1px solid #3b82f6", color: "#3b82f6", whiteSpace: "nowrap" }}>Mark Published</button>
                                : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {t2Pages > 1 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
                      <span style={{ fontSize: 11, color: "#64748b", fontFamily: "'Inter', sans-serif" }}>
                        {(t2Page - 1) * PAGE_SIZE + 1}–{Math.min(t2Page * PAGE_SIZE, t2Filtered.length)} of {t2Filtered.length}
                      </span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {[["«",1],["‹",t2Page-1]].map(([lbl,p]) => (
                          <button key={lbl} disabled={t2Page===1} onClick={() => setT2Page(p)}
                            style={{ ...S.btn("secondary"), padding: "6px 12px", fontSize: 12, opacity: t2Page===1?0.35:1 }}>{lbl}</button>
                        ))}
                        <span style={{ padding: "6px 14px", fontSize: 12, color: "#475569", background: "#f1f5f9", borderRadius: 8 }}>{t2Page} / {t2Pages}</span>
                        {[["›",t2Page+1],["»",t2Pages]].map(([lbl,p]) => (
                          <button key={lbl} disabled={t2Page===t2Pages} onClick={() => setT2Page(p)}
                            style={{ ...S.btn("secondary"), padding: "6px 12px", fontSize: 12, opacity: t2Page===t2Pages?0.35:1 }}>{lbl}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Mark Published modal ── */}
      {markModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: "32px 32px 24px", width: "100%", maxWidth: 460, boxShadow: "0 8px 40px rgba(15,23,42,0.18)" }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 16, color: "#0f172a", marginBottom: 6 }}>Mark as Published</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 24 }}>{markModal.session.assessmentTitle} — {markModal.session.dateOfAssessment} {markModal.session.startTimeSlot}</div>
            <label style={{ fontSize: 11, fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "0.06em", color: "#64748b", textTransform: "uppercase", marginBottom: 6, display: "block" }}>Topin Assessment ID <span style={{ color: "#ef4444" }}>*</span></label>
            <input style={{ width: "100%", background: "#fff", border: "1px solid #dde3ed", borderRadius: 8, color: "#0f172a", padding: "10px 14px", fontFamily: "'DM Mono', monospace", fontSize: 13, outline: "none", marginBottom: 16 }}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={markModal.topinId} onChange={e => setMarkModal(m => ({ ...m, topinId: e.target.value }))} />
            <label style={{ fontSize: 11, fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "0.06em", color: "#64748b", textTransform: "uppercase", marginBottom: 6, display: "block" }}>Assessment Link (optional)</label>
            <input style={{ width: "100%", background: "#fff", border: "1px solid #dde3ed", borderRadius: 8, color: "#0f172a", padding: "10px 14px", fontFamily: "'DM Mono', monospace", fontSize: 13, outline: "none", marginBottom: 24 }}
              placeholder="https://assessment.topin.tech/..."
              value={markModal.link} onChange={e => setMarkModal(m => ({ ...m, link: e.target.value }))} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setMarkModal(null)} style={{ ...S.btn("secondary"), padding: "10px 22px", fontSize: 13 }}>Cancel</button>
              <button onClick={handleMarkPublished} style={{ ...S.btn("primary"), padding: "10px 22px", fontSize: 13 }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
