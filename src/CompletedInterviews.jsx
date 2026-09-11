import { useState, useEffect, useCallback } from "react";
import { getCompletedNiatInterviews } from "./api/firestore";
import { api } from "./api/client";
import { MASTERY_LABELS } from "./constants/niatMastery";

function verdictColor(v) {
  const s = (v || "").toLowerCase();
  if (s.includes("select") || s.includes("pass") || s.includes("recommend")) return "#00c896";
  if (s.includes("reject") || s.includes("fail")) return "#ef4444";
  return "#3b82f6";
}

export default function CompletedInterviews({ S, showToast }) {
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [syncError, setSyncError]   = useState(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const data = await getCompletedNiatInterviews(force);
      const sorted = data.sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
      setInterviews(sorted);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await api.post("/api/interviews/sync-completed");
      showToast(`Synced ${result.written} interview${result.written !== 1 ? "s" : ""}.`);
      await load(true); // the write just happened server-side — must bypass the cache
    } catch (err) {
      // Keep showing whatever was already loaded — do not clear `interviews`.
      setSyncError(err.message);
    }
    setSyncing(false);
  };

  if (loading) return (
    <div style={{ padding: "60px 0", color: "#94a3b8", fontFamily: "'Inter', sans-serif", fontSize: 14 }}>
      Loading…
    </div>
  );

  const grouped = { product: [], systems: [], other: [] };
  for (const iv of interviews) (grouped[iv.masteryType] || grouped.other).push(iv);

  const groupTable = (rows) => (
    <div style={S.card}>
      {rows.length === 0 ? (
        <div style={{ textAlign: "center", color: "#94a3b8", padding: "40px 0", fontSize: 13 }}>
          No completed interviews yet.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Candidate</th>
                <th style={S.th}>Interviewer</th>
                <th style={S.th}>Round</th>
                <th style={S.th}>Completed</th>
                <th style={S.th}>Verdict</th>
                <th style={S.th}>Links</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(iv => {
                const verdict = iv.feedback?.finalVerdict || iv.feedback?.overallRecommendation || "";
                return (
                  <tr key={iv.id}
                    onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={S.td}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>{iv.candidateName || "—"}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{iv.candidateEmail}</div>
                    </td>
                    <td style={S.td}>
                      <div style={{ fontSize: 12 }}>{iv.interviewerName || "—"}</div>
                      <div style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: "#94a3b8" }}>{iv.interviewerEmail}</div>
                    </td>
                    <td style={S.td}>{iv.round || "—"}</td>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>{(iv.completedAt || "").slice(0, 10) || "—"}</td>
                    <td style={S.td}>
                      {verdict
                        ? <span style={S.badge(verdictColor(verdict))}>{verdict}</span>
                        : <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>}
                    </td>
                    <td style={S.td}>
                      <div style={{ display: "flex", gap: 10 }}>
                        {iv.recordingUrl && (
                          <a href={iv.recordingUrl} target="_blank" rel="noreferrer"
                            style={{ color: "#3b82f6", textDecoration: "none", fontSize: 12 }}>Recording ↗</a>
                        )}
                        {iv.transcriptUrl && (
                          <a href={iv.transcriptUrl} target="_blank" rel="noreferrer"
                            style={{ color: "#3b82f6", textDecoration: "none", fontSize: 12 }}>Transcript ↗</a>
                        )}
                        {!iv.recordingUrl && !iv.transcriptUrl && <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={S.sectionTitle}>Completed Interviews</div>
          <div style={S.sectionSub}>NIAT interviews synced from Interview Coordinator.</div>
        </div>
        <button onClick={handleSync} disabled={syncing}
          style={{ ...S.btn("primary"), opacity: syncing ? 0.6 : 1 }}>
          {syncing ? "Syncing…" : "Sync Now"}
        </button>
      </div>

      {syncError && (
        <div style={{ marginBottom: 20, padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13, color: "#991b1b" }}>
          Could not sync with Interview Coordinator: {syncError}. Showing last-synced data below.
        </div>
      )}

      {grouped.other.length > 0 && (
        <div style={{ marginBottom: 20, padding: "12px 16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, fontSize: 13, color: "#92400e" }}>
          {grouped.other.length} NIAT interview{grouped.other.length !== 1 ? "s" : ""} couldn't be matched to Product Mastery or Systems Mastery
          by template name — shown below as Uncategorized.
        </div>
      )}

      {["product", "systems", "other"]
        .filter(key => key !== "other" || grouped.other.length > 0)
        .map(key => (
          <div key={key} style={{ marginBottom: 8 }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 14, color: "#0f172a", marginBottom: 10 }}>
              {MASTERY_LABELS[key]} ({grouped[key].length})
            </div>
            {groupTable(grouped[key])}
          </div>
        ))}
    </div>
  );
}
