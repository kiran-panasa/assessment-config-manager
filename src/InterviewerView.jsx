import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { getInterviews, bulkCreateInterviews } from "./api/firestore";
import { parseCSVLine } from "./utils/csv";
import Pagination from "./components/Pagination";
import BadgeEligibility from "./BadgeEligibility";

const PAGE_SIZE = 20;

function parseInterviewCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { error: "CSV must have a header row and at least one data row." };

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  const get = (vals, ...keys) => {
    for (const key of keys) {
      const i = headers.indexOf(key);
      if (i >= 0 && vals[i]) return vals[i].trim();
    }
    return "";
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const candidateName = get(vals, "candidate name");
    if (!candidateName) continue;
    const panelistEmail = get(vals, "panelist email").toLowerCase();
    if (!panelistEmail) return { error: `Row ${i + 1}: "Panelist Email" column is required.` };

    rows.push({
      candidateUid:  get(vals, "candidate uid"),
      candidateName,
      resumeLink:    get(vals, "candidate resume", "resume link"),
      interviewDate: get(vals, "interview date"),
      interviewTime: get(vals, "interview time"),
      panelistEmail,
      panelistName:  get(vals, "interview panelist name", "panelist name"),
      boa:           get(vals, "boa"),
      meetLink:      get(vals, "meet link"),
      recordingLink: get(vals, "recording link"),
      status:        get(vals, "interview status", "status") || "Scheduled",
      role:          get(vals, "role"),
      round:         get(vals, "round"),
    });
  }

  if (rows.length === 0) return { error: "No valid data rows found." };
  return { rows };
}

function statusColor(s) {
  if (s === "Completed") return "#00c896";
  if (s === "Canceled")  return "#ef4444";
  return "#3b82f6";
}

export default function InterviewerView({ S, showToast }) {
  const { currentUser, userProfile } = useAuth();
  const isAdmin = userProfile?.role === "admin" || userProfile?.role === "super-admin";

  const [interviews, setInterviews]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState(isAdmin ? "all" : "list");
  const [filterDate, setFilterDate]   = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [pg, setPg]                   = useState(1);
  const [csvData, setCsvData]         = useState(null);
  const [uploading, setUploading]     = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const email = currentUser?.email || "";
      const data = await getInterviews(email, isAdmin);
      const sorted = data.sort((a, b) =>
        (a.interviewDate || "").localeCompare(b.interviewDate || "") ||
        (a.interviewTime || "").localeCompare(b.interviewTime || "")
      );
      setInterviews(sorted);
    } catch { /* silent */ }
    setLoading(false);
  }, [currentUser, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const dates = useMemo(() =>
    [...new Set(interviews.map(r => r.interviewDate))].filter(Boolean).sort(),
  [interviews]);

  const filtered = useMemo(() =>
    interviews.filter(r => {
      if (filterDate   !== "All" && r.interviewDate !== filterDate) return false;
      if (filterStatus !== "All" && (r.status || "Scheduled") !== filterStatus) return false;
      return true;
    }),
  [interviews, filterDate, filterStatus]);

  const paged = filtered.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = parseInterviewCSV(ev.target.result);
      if (result.error) { showToast(result.error, "error"); setCsvData(null); }
      else setCsvData(result.rows);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleUpload = async () => {
    if (!csvData?.length) return;
    setUploading(true);
    try {
      await bulkCreateInterviews(csvData);
      showToast(`${csvData.length} interview${csvData.length !== 1 ? "s" : ""} uploaded.`);
      setCsvData(null);
      load();
    } catch (err) {
      showToast("Upload failed: " + err.message, "error");
    }
    setUploading(false);
  };

  if (loading) return (
    <div style={{ padding: "80px 48px", color: "#94a3b8", fontFamily: "'Inter', sans-serif", fontSize: 14 }}>
      Loading…
    </div>
  );

  const interviewTable = (
    <div style={S.card}>
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: "#94a3b8", padding: "60px 0", fontSize: 13 }}>
          <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 15, color: "#94a3b8", marginBottom: 8 }}>
            {interviews.length === 0 ? "No interviews scheduled" : "No results for selected filters"}
          </div>
          {!isAdmin && interviews.length === 0 && "Your upcoming interviews will appear here once the admin uploads the schedule."}
        </div>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Candidate</th>
                  {isAdmin && <th style={S.th}>Panelist</th>}
                  <th style={S.th}>Role</th>
                  <th style={S.th}>Round</th>
                  <th style={S.th}>Date</th>
                  <th style={S.th}>Time</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Meet Link</th>
                  <th style={S.th}>Resume</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(r => (
                  <tr key={r.id}
                    onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={S.td}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>{r.candidateName || "—"}</div>
                      {r.candidateUid && (
                        <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: "#94a3b8", marginTop: 2 }}>
                          {r.candidateUid.slice(0, 8)}…
                        </div>
                      )}
                    </td>
                    {isAdmin && (
                      <td style={S.td}>
                        <div style={{ fontSize: 12 }}>{r.panelistName || "—"}</div>
                        <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: "#94a3b8" }}>{r.panelistEmail}</div>
                      </td>
                    )}
                    <td style={S.td}>{r.role || "—"}</td>
                    <td style={S.td}>{r.round || "—"}</td>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>{r.interviewDate || "—"}</td>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>{r.interviewTime || "—"}</td>
                    <td style={S.td}>
                      <span style={S.badge(statusColor(r.status || "Scheduled"))}>
                        {r.status || "Scheduled"}
                      </span>
                    </td>
                    <td style={S.td}>
                      {r.meetLink
                        ? <a href={r.meetLink} target="_blank" rel="noreferrer"
                            style={{ color: "#3b82f6", textDecoration: "none", fontSize: 12 }}>Join ↗</a>
                        : <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>}
                    </td>
                    <td style={S.td}>
                      {r.resumeLink
                        ? <a href={r.resumeLink} target="_blank" rel="noreferrer"
                            style={{ color: "#3b82f6", textDecoration: "none", fontSize: 12 }}>View ↗</a>
                        : <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={pg} total={filtered.length} onPage={setPg} S={S} />
        </>
      )}
    </div>
  );

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>

      {/* Header */}
      <div style={S.header}>
        <span style={S.headerTitle}>{isAdmin ? "Interview Schedule" : "My Interviews"}</span>
        {isAdmin && (
          <nav style={S.nav}>
            {[["all", "All Interviews"], ["upload", "Upload Schedule"], ["badge", "Badge Eligibility"]].map(([key, label]) => (
              <button key={key} style={S.navItem(tab === key)} onClick={() => setTab(key)}>{label}</button>
            ))}
          </nav>
        )}
        <div style={{ marginLeft: "auto", paddingBottom: 18, paddingTop: 18, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            {filtered.length !== interviews.length
              ? `${filtered.length} of ${interviews.length} interviews`
              : `${interviews.length} interview${interviews.length !== 1 ? "s" : ""}`}
          </span>
          <button onClick={load} style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12 }}>Refresh</button>
        </div>
      </div>

      <div style={S.body}>

        {/* ── UPLOAD TAB (admin only) ── */}
        {isAdmin && tab === "upload" && (
          <div style={{ animation: "fadeIn 0.2s ease" }}>
            <div style={S.sectionTitle}>Upload Interview Schedule</div>
            <div style={{ ...S.sectionSub, marginBottom: 24 }}>
              Upload a CSV to schedule interviews. Each row is assigned to a panelist by their email address.
            </div>

            <div style={S.card}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 12, color: "#2563eb", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Expected CSV Columns
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {[
                  ["Candidate UID", false], ["Candidate Name", true], ["Candidate Resume", false],
                  ["Interview Date", false], ["Interview Time", false],
                  ["Panelist Email", true], ["Interview Panelist Name", false],
                  ["BOA", false], ["Meet Link", false], ["Recording Link", false],
                  ["Interview status", false], ["Role", false], ["Round", false],
                ].map(([col, required]) => (
                  <span key={col} style={{
                    background: required ? "#eff6ff" : "#f1f5f9",
                    border: `1px solid ${required ? "#bfdbfe" : "#e2e8f0"}`,
                    borderRadius: 4, padding: "3px 10px", fontSize: 11,
                    fontFamily: "'DM Mono', monospace",
                    color: required ? "#1d4ed8" : "#475569",
                  }}>
                    {col}{required ? " *" : ""}
                  </span>
                ))}
              </div>
              <div style={{ marginBottom: 20, padding: "12px 16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, fontSize: 12, color: "#92400e", lineHeight: 1.7 }}>
                <strong>Panelist Email</strong> (marked *) is required — it links each interview row to the panelist's login account so they can see only their assigned interviews.
              </div>

              <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleFile} />

              {!csvData ? (
                <button style={{ ...S.btn("secondary"), border: "1px dashed #cbd5e1" }} onClick={() => fileRef.current?.click()}>
                  Choose CSV File
                </button>
              ) : (
                <div>
                  <div style={{ marginBottom: 16, padding: "12px 16px", background: "#f0fdf9", border: "1px solid #6ee7b7", borderRadius: 8, fontSize: 13, color: "#065f46", fontFamily: "'Inter', sans-serif" }}>
                    ✓ <strong>{csvData.length}</strong> interview{csvData.length !== 1 ? "s" : ""} ready to upload
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button style={{ ...S.btn("primary") }} disabled={uploading} onClick={handleUpload}>
                      {uploading ? "Uploading…" : `Upload ${csvData.length} Interview${csvData.length !== 1 ? "s" : ""}`}
                    </button>
                    <button style={{ ...S.btn("secondary") }} onClick={() => setCsvData(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── BADGE ELIGIBILITY (admin only) ── */}
        {isAdmin && tab === "badge" && (
          <BadgeEligibility S={S} showToast={showToast} />
        )}

        {/* ── ALL INTERVIEWS (admin) or MY INTERVIEWS (interviewer) ── */}
        {(!isAdmin || tab === "all") && (
          <div style={{ animation: "fadeIn 0.2s ease" }}>
            {!isAdmin && (
              <>
                <div style={S.sectionTitle}>My Interviews</div>
                <div style={{ ...S.sectionSub, marginBottom: 20 }}>Interviews assigned to you.</div>
              </>
            )}

            {/* Filters */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "#64748b", fontFamily: "'Inter', sans-serif", fontWeight: 600 }}>Date</span>
                <select style={{ ...S.select, width: "auto", minWidth: 150 }} value={filterDate}
                  onChange={e => { setFilterDate(e.target.value); setPg(1); }}>
                  <option value="All">All Dates</option>
                  {dates.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "#64748b", fontFamily: "'Inter', sans-serif", fontWeight: 600 }}>Status</span>
                <select style={{ ...S.select, width: "auto", minWidth: 140 }} value={filterStatus}
                  onChange={e => { setFilterStatus(e.target.value); setPg(1); }}>
                  {["All", "Scheduled", "Completed", "Canceled"].map(s => (
                    <option key={s} value={s}>{s === "All" ? "All Statuses" : s}</option>
                  ))}
                </select>
              </div>
              {(filterDate !== "All" || filterStatus !== "All") && (
                <button onClick={() => { setFilterDate("All"); setFilterStatus("All"); setPg(1); }}
                  style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12 }}>Reset</button>
              )}
            </div>

            {interviewTable}
          </div>
        )}

      </div>
    </div>
  );
}
