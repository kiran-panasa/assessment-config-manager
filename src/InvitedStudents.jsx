import { useState, useMemo } from "react";

const PAGE_SIZE = 20;

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
  "Contest Date", "Time Slot", "Unique Exam ID", "Invite", "User Assessment Link",
];

export default function InvitedStudents({ S, bookingRows, examSessions, showToast }) {
  const [dateFilter, setDateFilter] = useState("All");
  const [pg, setPg] = useState(1);

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
        userAssessmentLink: s?.assessmentLink ? deriveUserLink(s.assessmentLink) : null,
        mapped: !!s,
      };
    }), [bookingRows, sessionMap]);

  const dates = useMemo(() =>
    [...new Set(rows.map(r => r.contestDate))].filter(Boolean).sort(),
    [rows]);

  const filtered = dateFilter === "All" ? rows : rows.filter(r => r.contestDate === dateFilter);
  const pages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE);

  const copyLink = (link) => {
    navigator.clipboard.writeText(link).then(() => showToast("Link copied!")).catch(() => showToast("Copy failed.", "error"));
  };

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={S.header}>
        <span style={S.headerTitle}>Invited Students</span>
        <div style={{ marginLeft: "auto", paddingBottom: 18, paddingTop: 18, fontSize: 12, color: "#94a3b8" }}>
          {rows.length} students
        </div>
      </div>

      <div style={S.body}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={S.sectionTitle}>Invited Students</div>
            <div style={{ ...S.sectionSub, marginBottom: 0 }}>All students with their personalised assessment links.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ ...S.label, marginBottom: 0, whiteSpace: "nowrap" }}>Filter by date</span>
            <select style={{ ...S.select, width: 170 }} value={dateFilter} onChange={e => { setDateFilter(e.target.value); setPg(1); }}>
              <option value="All">All Dates</option>
              {dates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div style={S.card}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: "center", color: "#94a3b8", padding: "60px 0", fontSize: 13 }}>
              <div style={{ marginBottom: 10, fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 15, color: "#94a3b8" }}>
                {rows.length === 0 ? "No data yet" : "No results for selected date"}
              </div>
              {rows.length === 0 && "Upload a CSV and publish assessments to populate this table."}
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
                              <a href={row.userAssessmentLink} target="_blank" rel="noreferrer"
                                style={{ color: "#00c896", textDecoration: "none", fontSize: 11, fontFamily: "'DM Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190, display: "inline-block" }}>
                                {row.userAssessmentLink.length > 42 ? row.userAssessmentLink.slice(0, 42) + "…" : row.userAssessmentLink}
                              </a>
                              <button onClick={() => copyLink(row.userAssessmentLink)}
                                style={{ ...S.btn("secondary"), padding: "3px 10px", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>
                                Copy
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                          )}
                        </td>
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
