import { useState, useMemo, useEffect, useCallback } from "react";
import { api, invalidateCache } from "./api/client";

const PAGE_SIZE = 20;

const FILTER_INIT = { contestDate: "All", skill: "All", level: "All", timeSlot: "All", inviteStatus: "All" };

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

const COLS = [
  "Student Name", "NIAT ID", "Student UID", "Skill", "Level",
  "Contest Date", "Time Slot", "Unique Exam ID", "Invite",
  "User Assessment Link", "Config Link", "Details Link",
];

export default function InvitedStudents({ S, showToast }) {
  const [bookingRows, setBookingRows] = useState([]);
  const [examSessions, setExamSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generatingTiny, setGeneratingTiny] = useState(false);
  const [filters, setFilters] = useState(FILTER_INIT);
  const [search, setSearch] = useState("");
  const [pg, setPg] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bookings, sessions] = await Promise.all([
        api.get("/api/bookings"),
        api.get("/api/sessions"),
      ]);
      setBookingRows(bookings.rows || []);
      setExamSessions(sessions.sessions || []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const sessionMap = useMemo(() => {
    const m = new Map();
    examSessions.forEach(s => { if (s.sessionKey) m.set(s.sessionKey, s); });
    return m;
  }, [examSessions]);

  const rows = useMemo(() =>
    bookingRows.map(row => {
      const s = row.sessionKey ? sessionMap.get(row.sessionKey) : null;
      return {
        ...row,
        uniqueExamId: s?.uniqueExamId ?? "—",
        userAssessmentLink: s?.tinyUrl || (s?.assessmentLink ? deriveUserLink(s.assessmentLink) : null),
        isTinyUrl: !!s?.tinyUrl,
        viewAssessmentUrl: s?.viewAssessmentUrl ?? null,
        viewDetailsUrl: s?.viewDetailsUrl ?? null,
        mapped: !!s,
      };
    }), [bookingRows, sessionMap]);

  const opts = useMemo(() => ({
    contestDate: ["All", ...[...new Set(rows.map(r => r.contestDate))].filter(Boolean).sort()],
    skill:       ["All", ...[...new Set(rows.map(r => r.skill))].filter(Boolean).sort()],
    level:       ["All", ...[...new Set(rows.map(r => r.skillLevel))].filter(Boolean).sort()],
    timeSlot:    ["All", ...[...new Set(rows.map(r => r.timeSlot))].filter(Boolean).sort()],
    inviteStatus:["All", "sent", "failed", "not sent"],
  }), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (filters.contestDate !== "All" && r.contestDate !== filters.contestDate) return false;
      if (filters.skill       !== "All" && r.skill       !== filters.skill)       return false;
      if (filters.level       !== "All" && r.skillLevel  !== filters.level)       return false;
      if (filters.timeSlot    !== "All" && r.timeSlot    !== filters.timeSlot)    return false;
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

  const pages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE);

  const setFilter = (key, val) => { setFilters(f => ({ ...f, [key]: val })); setPg(1); };
  const resetFilters = () => { setFilters(FILTER_INIT); setSearch(""); setPg(1); };
  const anyActive = Object.values(filters).some(v => v !== "All") || search.trim() !== "";

  const handleGenerateTinyUrls = useCallback(async () => {
    setGeneratingTiny(true);
    try {
      const res = await api.post("/api/sessions/tiny-urls", {});
      invalidateCache("/api/sessions");
      showToast(`TinyURLs: ${res.updated} generated, ${res.skipped} already done, ${res.failed} failed.`);
      await load();
    } catch (err) {
      showToast(err.message, "error");
    }
    setGeneratingTiny(false);
  }, [load]);

  const copyLink = (link) => {
    navigator.clipboard.writeText(link).then(() => showToast("Link copied!")).catch(() => showToast("Copy failed.", "error"));
  };

  const downloadCSV = () => {
    const headers = ["Student Name", "NIAT ID", "Student UID", "Skill", "Level", "Contest Date", "Time Slot", "Unique Exam ID", "Invite Status", "User Assessment Link", "Config Link", "Details Link"];
    const escape = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csvRows = [
      headers.map(escape).join(","),
      ...filtered.map(r => [
        r.studentName, r.niatId, r.studentUid, r.skill, r.skillLevel,
        r.contestDate, r.timeSlot, r.uniqueExamId,
        r.inviteStatus === "sent" ? "Sent" : r.inviteStatus === "failed" ? "Failed" : "Not Sent",
        r.userAssessmentLink ?? "", r.viewAssessmentUrl ?? "", r.viewDetailsUrl ?? "",
      ].map(escape).join(",")),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invited-students${filters.contestDate !== "All" ? `-${filters.contestDate}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selStyle = { ...S.select, width: "auto", minWidth: 120 };

  if (loading) return (
    <div style={{ padding: "80px 48px", color: "#94a3b8", fontFamily: "'Inter', sans-serif", fontSize: 14 }}>
      Loading…
    </div>
  );

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={S.header}>
        <span style={S.headerTitle}>Invited Students</span>
        <div style={{ marginLeft: "auto", paddingBottom: 18, paddingTop: 18, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            {filtered.length !== rows.length ? `${filtered.length} of ${rows.length} students` : `${rows.length} students`}
          </span>
          <button onClick={load} style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12, whiteSpace: "nowrap" }}>
            Refresh
          </button>
          <button onClick={handleGenerateTinyUrls} disabled={generatingTiny}
            style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12, whiteSpace: "nowrap", opacity: generatingTiny ? 0.5 : 1 }}>
            {generatingTiny ? "Generating…" : "Generate TinyURLs"}
          </button>
          {filtered.length > 0 && (
            <button onClick={downloadCSV} style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12, whiteSpace: "nowrap" }}>
              Download CSV
            </button>
          )}
        </div>
      </div>

      <div style={S.body}>
        <div style={{ marginBottom: 20 }}>
          <div style={S.sectionTitle}>Invited Students</div>
          <div style={{ ...S.sectionSub, marginBottom: 16 }}>All students with their personalised assessment links.</div>

          {/* Search + Filters */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            {/* Text search */}
            <input
              type="text"
              placeholder="Search name, NIAT ID, UID, Exam ID…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPg(1); }}
              style={{ ...S.input, margin: 0, width: 260, fontSize: 12 }}
            />

            {/* Dropdown filters */}
            {[
              ["contestDate", "Date"],
              ["skill",       "Skill"],
              ["level",       "Level"],
              ["timeSlot",    "Time Slot"],
              ["inviteStatus","Invite"],
            ].map(([key, label]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "#64748b", fontFamily: "'Inter', sans-serif", fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
                <select style={{ ...selStyle, borderColor: filters[key] !== "All" ? "#00c896" : undefined }}
                  value={filters[key]} onChange={e => setFilter(key, e.target.value)}>
                  {opts[key].map(v => (
                    <option key={v} value={v}>{v === "All" ? `All ${label}s` : v}</option>
                  ))}
                </select>
              </div>
            ))}

            {anyActive && (
              <button onClick={resetFilters} style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12, whiteSpace: "nowrap" }}>
                Reset
              </button>
            )}
          </div>
        </div>

        <div style={S.card}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", color: "#94a3b8", padding: "60px 0", fontSize: 13 }}>
              <div style={{ marginBottom: 10, fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 15, color: "#94a3b8" }}>
                {rows.length === 0 ? "No data yet" : "No results for selected filters"}
              </div>
              {rows.length === 0 && "Upload a CSV and publish assessments to populate this table."}
              {rows.length > 0 && anyActive && (
                <button onClick={resetFilters} style={{ ...S.btn("secondary"), marginTop: 12, fontSize: 12 }}>Clear filters</button>
              )}
            </div>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={S.table}>
                  <thead>
                    <tr>{COLS.map(c => <th key={c} style={S.th}>{c}</th>)}</tr>
                  </thead>
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
                        <td style={{ ...S.td, fontSize: 11, fontFamily: "'DM Mono', monospace", color: row.mapped ? "#3b82f6" : "#94a3b8" }}>
                          {row.uniqueExamId}
                          {!row.mapped && <span title="No matching exam session" style={{ marginLeft: 6, color: "#f5a623" }}>⚠</span>}
                        </td>
                        <td style={S.td}>
                          {row.inviteStatus === "sent"
                            ? <span style={S.badge("#00c896")}>Sent</span>
                            : row.inviteStatus === "failed"
                            ? <span style={S.badge("#ff5555")}>Failed</span>
                            : <span style={S.badge("#94a3b8")}>Not Sent</span>}
                        </td>
                        <td style={{ ...S.td, maxWidth: 280 }}>
                          {row.userAssessmentLink ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                {row.isTinyUrl && (
                                  <span style={{ fontSize: 9, fontFamily: "'Inter', sans-serif", fontWeight: 700, color: "#7c3aed", background: "#f3e8ff", borderRadius: 3, padding: "1px 5px", width: "fit-content", letterSpacing: "0.05em" }}>TINY</span>
                                )}
                                <a href={row.userAssessmentLink} target="_blank" rel="noreferrer"
                                  style={{ color: "#00c896", textDecoration: "none", fontSize: 11, fontFamily: "'DM Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190, display: "inline-block" }}>
                                  {row.userAssessmentLink.length > 42 ? row.userAssessmentLink.slice(0, 42) + "…" : row.userAssessmentLink}
                                </a>
                              </div>
                              <button onClick={() => copyLink(row.userAssessmentLink)}
                                style={{ ...S.btn("secondary"), padding: "3px 10px", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>
                                Copy
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                          )}
                        </td>
                        {[["viewAssessmentUrl", "Config"], ["viewDetailsUrl", "Details"]].map(([field, label]) => (
                          <td key={field} style={{ ...S.td, maxWidth: 200 }}>
                            {row[field] ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <a href={row[field]} target="_blank" rel="noreferrer"
                                  style={{ color: "#3b82f6", textDecoration: "none", fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
                                  {label} ↗
                                </a>
                                <button onClick={() => copyLink(row[field])}
                                  style={{ ...S.btn("secondary"), padding: "3px 8px", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>
                                  Copy
                                </button>
                              </div>
                            ) : (
                              <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                            )}
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
                    {[["«", 1], ["‹", pg - 1]].map(([lbl, p]) => (
                      <button key={lbl} disabled={pg === 1} onClick={() => setPg(p)}
                        style={{ ...S.btn("secondary"), padding: "6px 12px", fontSize: 12, opacity: pg === 1 ? 0.35 : 1 }}>{lbl}</button>
                    ))}
                    <span style={{ padding: "6px 14px", fontSize: 12, color: "#475569", background: "#f1f5f9", borderRadius: 8 }}>{pg} / {pages}</span>
                    {[["›", pg + 1], ["»", pages]].map(([lbl, p]) => (
                      <button key={lbl} disabled={pg === pages} onClick={() => setPg(p)}
                        style={{ ...S.btn("secondary"), padding: "6px 12px", fontSize: 12, opacity: pg === pages ? 0.35 : 1 }}>{lbl}</button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
