import { useState, useEffect, useRef, useMemo } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc, collection, onSnapshot } from "firebase/firestore";

// $0.000463/vCPU/min + $0.000231/GB/min  ≈ 0.5 vCPU + 512MB on Railway
const RATE_PER_MIN = 0.000348;
const FREE_TRIAL   = 5.00;

const LOG_COLOR = {
  success: "#00c896",
  error:   "#ff5555",
  warn:    "#f5a623",
  info:    "#7eb8ff",
  done:    "#00c896",
};

export default function CreateAssessments({ S, examSessions, bookingRows, showToast }) {
  const [tab, setTab] = useState("credentials");
  const [serverOnline, setServerOnline] = useState(null);

  const [creds, setCreds] = useState({
    mobile: "", otp: "",
    apiEndpoint: "", apiToken: "",
    uidField: "student_uid", assessIdField: "assessment_id",
    serverUrl: "http://localhost:3001",
    topinLoginUrl: "https://accounts.ccbp.in/login?client_id=topin_config&auth_client_id=topin&call_back_url=https://config.topin.tech/&mode=otp&WINDOW_MODE=IN_APP",
  });
  const [credsSaved, setCredsSaved] = useState(false);
  const [credsLoaded, setCredsLoaded] = useState(false);

  const [selDate, setSelDate] = useState("");
  const [running, setRunning] = useState(null);
  const [logs, setLogs] = useState([]);
  const [jobLogs, setJobLogs] = useState([]);
  const logsEndRef = useRef(null);
  const esRef = useRef(null);

  // Load credentials from Firestore
  useEffect(() => {
    getDoc(doc(db, "settings", "automation")).then(snap => {
      if (snap.exists()) setCreds(prev => ({ ...prev, ...snap.data() }));
      setCredsLoaded(true);
    }).catch(() => setCredsLoaded(true));
  }, []);

  // Load job logs for this month
  useEffect(() => {
    const month = new Date().toISOString().slice(0, 7);
    const unsub = onSnapshot(collection(db, "jobLogs"), snap => {
      const logs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(l => l.month === month)
        .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
      setJobLogs(logs);
    });
    return () => unsub();
  }, []);

  // Server health check — restarts whenever serverUrl changes
  useEffect(() => {
    if (!credsLoaded || !creds.serverUrl) return;
    setServerOnline(null);
    const isLocal = creds.serverUrl.includes("localhost") || creds.serverUrl.includes("127.0.0.1");
    const check = () =>
      fetch(`${creds.serverUrl}/health`, { signal: AbortSignal.timeout(isLocal ? 3000 : 40000) })
        .then(r => setServerOnline(r.ok))
        .catch(() => setServerOnline(false));
    check();
    const id = setInterval(check, isLocal ? 5000 : 15000);
    return () => clearInterval(id);
  }, [creds.serverUrl, credsLoaded]);

  // Scroll progress log to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── Credit calculations ───────────────────────────────────────────────────────
  const creditStats = useMemo(() => {
    const totalMinutes = jobLogs.reduce((sum, l) => sum + (l.durationMinutes || 0), 0);
    const estimatedCost = totalMinutes * RATE_PER_MIN;
    const percentUsed = Math.min((estimatedCost / FREE_TRIAL) * 100, 100);
    return { totalMinutes: Math.round(totalMinutes * 10) / 10, estimatedCost, percentUsed };
  }, [jobLogs]);

  const saveCreds = async () => {
    try {
      await setDoc(doc(db, "settings", "automation"), creds, { merge: true });
      setCredsSaved(true);
      showToast("Credentials saved.");
      setTimeout(() => setCredsSaved(false), 2000);
    } catch {
      showToast("Failed to save credentials.", "error");
    }
  };

  const availableDates = useMemo(() =>
    [...new Set(examSessions.map(s => s.dateOfAssessment))].filter(Boolean).sort(),
    [examSessions]);

  const stats = useMemo(() => {
    const sessions = selDate ? examSessions.filter(s => s.dateOfAssessment === selDate) : examSessions;
    const bookings = selDate ? bookingRows.filter(b => b.contestDate === selDate) : bookingRows;
    return {
      toPublish: sessions.filter(s => s.publishStatus !== "published").length,
      published: sessions.filter(s => s.publishStatus === "published").length,
      toInvite:  bookings.filter(b => b.inviteStatus !== "sent").length,
      invited:   bookings.filter(b => b.inviteStatus === "sent").length,
    };
  }, [examSessions, bookingRows, selDate]);

  const addLog = (type, message) =>
    setLogs(prev => [...prev, { type, message, id: Date.now() + Math.random() }]);

  const startSSE = () => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`${creds.serverUrl}/progress`);
    esRef.current = es;
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      addLog(data.type, data.message);
      if (data.type === "done") {
        setRunning(null);
        es.close();
        esRef.current = null;
        showToast(data.message);
      }
    };
    es.onerror = () => {
      addLog("error", "Lost connection to server.");
      setRunning(null);
      es.close();
      esRef.current = null;
    };
  };

  const handlePublish = async () => {
    if (!serverOnline) { showToast("Server offline. Check the Server URL in Credentials.", "error"); return; }
    if (!creds.mobile || !creds.otp) { showToast("Enter Topin mobile and OTP in Credentials tab first.", "error"); return; }
    setLogs([]);
    setRunning("publish");
    startSSE();
    try {
      await fetch(`${creds.serverUrl}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: creds.mobile, otp: creds.otp, date: selDate || null, topinLoginUrl: creds.topinLoginUrl || null }),
      });
    } catch {
      addLog("error", "Failed to reach server.");
      setRunning(null);
    }
  };

  const handleInvite = async () => {
    if (!serverOnline) { showToast("Server offline. Check the Server URL in Credentials.", "error"); return; }
    if (!creds.apiEndpoint || !creds.apiToken) { showToast("Enter Invite API credentials first.", "error"); return; }
    setLogs([]);
    setRunning("invite");
    startSSE();
    try {
      await fetch(`${creds.serverUrl}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiEndpoint:   creds.apiEndpoint,
          apiToken:      creds.apiToken,
          uidField:      creds.uidField      || "student_uid",
          assessIdField: creds.assessIdField || "assessment_id",
          date: selDate || null,
        }),
      });
    } catch {
      addLog("error", "Failed to reach server.");
      setRunning(null);
    }
  };

  const cancelJob = () => {
    setRunning(null);
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
  };

  const currentMonth = new Date().toLocaleString("default", { month: "long", year: "numeric" });

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>

      {/* ── Header ── */}
      <div style={S.header}>
        <span style={S.headerTitle}>Create Assessments</span>
        <nav style={S.nav}>
          {[["credentials","Credentials"], ["run","Select & Run"], ["usage","Credit Usage"]].map(([key, label]) => (
            <button key={key} style={S.navItem(tab === key)} onClick={() => setTab(key)}>{label}</button>
          ))}
        </nav>
        <div style={{ marginLeft: "auto", paddingBottom: 18, paddingTop: 18, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", flexShrink: 0,
            background: serverOnline === null ? "#f59e0b" : serverOnline ? "#00c896" : "#ef4444" }} />
          <span style={{ fontSize: 12, fontFamily: "'Inter', sans-serif",
            color: serverOnline === null ? "#d97706" : serverOnline ? "#059669" : "#ef4444" }}>
            {serverOnline === null
              ? (creds.serverUrl?.includes("localhost") ? "Checking…" : "Waking up server…")
              : serverOnline ? "Server online" : "Server offline"}
          </span>
        </div>
      </div>

      <div style={S.body}>

        {/* ── Offline warning ── */}
        {serverOnline === false && (
          <div style={{ marginBottom: 24, padding: "16px 20px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, color: "#dc2626", lineHeight: 1.9 }}>
            <strong style={{ color: "#dc2626" }}>Server is not reachable.</strong>{" "}
            {creds.serverUrl?.includes("localhost")
              ? <>Start it locally: <code style={{ background: "#1e293b", padding: "2px 8px", borderRadius: 4, fontFamily: "'DM Mono', monospace", color: "#e2e8f0" }}>cd scripts &amp;&amp; node server.js</code></>
              : "Check that your Railway service is running and the URL in Credentials is correct."}
          </div>
        )}

        {/* ── CREDENTIALS TAB ── */}
        {tab === "credentials" && (
          <div style={{ animation: "fadeIn 0.2s ease" }}>
            <div style={S.sectionTitle}>Credentials & Server</div>
            <div style={S.sectionSub}>All values are saved to Firestore and auto-loaded on every device.</div>

            {/* Server URL */}
            <div style={S.card}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 12, color: "#2563eb", marginBottom: 18, textTransform: "uppercase", letterSpacing: "0.06em" }}>Automation Server</div>
              <label style={S.label}>Server URL</label>
              <input style={S.input} type="url"
                placeholder="http://localhost:3001  or  https://your-app.railway.app"
                value={creds.serverUrl}
                onChange={e => setCreds(p => ({ ...p, serverUrl: e.target.value.trim() }))} />
              <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                Local: <code style={{ color: "#3b82f6" }}>http://localhost:3001</code> &nbsp;·&nbsp;
                Railway: paste your Railway service URL here — shared across all devices automatically.
              </div>
            </div>

            {/* Topin login */}
            <div style={S.card}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 12, color: "#2563eb", marginBottom: 18, textTransform: "uppercase", letterSpacing: "0.06em" }}>Topin Login</div>
              <div style={{ marginBottom: 20 }}>
                <label style={S.label}>Topin Login URL</label>
                <input style={S.input} type="url"
                  placeholder="https://accounts.ccbp.in/login?client_id=topin_config…"
                  value={creds.topinLoginUrl}
                  onChange={e => setCreds(p => ({ ...p, topinLoginUrl: e.target.value.trim() }))} />
                <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                  Update this if the Topin login page URL ever changes — no redeploy needed.
                </div>
              </div>
              <div style={S.grid2}>
                <div>
                  <label style={S.label}>Mobile Number</label>
                  <input style={S.input} type="tel" placeholder="9876543210"
                    value={creds.mobile} onChange={e => setCreds(p => ({ ...p, mobile: e.target.value }))} />
                </div>
                <div>
                  <label style={S.label}>Fixed OTP</label>
                  <input style={S.input} type="text" placeholder="123456" maxLength={8}
                    value={creds.otp} onChange={e => setCreds(p => ({ ...p, otp: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Invite API */}
            <div style={S.card}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 12, color: "#2563eb", marginBottom: 18, textTransform: "uppercase", letterSpacing: "0.06em" }}>Invite API</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.label}>API Endpoint</label>
                  <input style={S.input} type="url" placeholder="https://api.topin.tech/invite"
                    value={creds.apiEndpoint} onChange={e => setCreds(p => ({ ...p, apiEndpoint: e.target.value }))} />
                </div>
                <div>
                  <label style={S.label}>API Token</label>
                  <input style={S.input} type="password" placeholder="Bearer token…"
                    value={creds.apiToken} onChange={e => setCreds(p => ({ ...p, apiToken: e.target.value }))} />
                </div>
              </div>
              <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #e2e8f0" }}>
                <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 11, color: "#64748b", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>Payload Field Names</div>
                <div style={S.grid2}>
                  <div>
                    <label style={S.label}>Student UID field</label>
                    <input style={S.input} placeholder="student_uid"
                      value={creds.uidField} onChange={e => setCreds(p => ({ ...p, uidField: e.target.value }))} />
                  </div>
                  <div>
                    <label style={S.label}>Assessment ID field</label>
                    <input style={S.input} placeholder="assessment_id"
                      value={creds.assessIdField} onChange={e => setCreds(p => ({ ...p, assessIdField: e.target.value }))} />
                  </div>
                </div>
              </div>
            </div>

            <button style={{ ...S.btn("primary"), minWidth: 180 }} onClick={saveCreds}>
              {credsSaved ? "✓ Saved" : "Save Credentials"}
            </button>
          </div>
        )}

        {/* ── SELECT & RUN TAB ── */}
        {tab === "run" && (
          <div style={{ animation: "fadeIn 0.2s ease" }}>
            <div style={S.sectionTitle}>Select Date & Run</div>
            <div style={S.sectionSub}>Pick an assessment date, then publish sessions on Topin and send invites.</div>

            <div style={S.card}>
              <label style={S.label}>Assessment Date</label>
              <select style={{ ...S.select, maxWidth: 300 }} value={selDate} onChange={e => setSelDate(e.target.value)}>
                <option value="">— All dates —</option>
                {availableDates.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              {availableDates.length === 0 && (
                <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>No exam sessions found. Upload a CSV in Student Bookings first.</div>
              )}
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
              {[
                [stats.toPublish, "To Publish",     "#f5a623"],
                [stats.published, "Published",       "#00c896"],
                [stats.toInvite,  "Invites Pending", "#f5a623"],
                [stats.invited,   "Invites Sent",    "#00c896"],
              ].map(([val, lbl, color]) => (
                <div key={lbl} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 22px" }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 30, color }}>{val}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, fontFamily: "'Inter', sans-serif" }}>{lbl}</div>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div style={{ ...S.card, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <button style={{ ...S.btn("primary"), minWidth: 190, opacity: (running || !serverOnline) ? 0.45 : 1 }}
                  onClick={handlePublish} disabled={!!running || !serverOnline}>
                  {running === "publish" ? "Publishing…" : "Publish Sessions"}
                </button>
                <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>Opens browser · clones &amp; publishes on Topin</div>
              </div>
              <div>
                <button style={{ ...S.btn("secondary"), minWidth: 190, opacity: (running || !serverOnline) ? 0.45 : 1, border: "1px solid #e2e8f0" }}
                  onClick={handleInvite} disabled={!!running || !serverOnline}>
                  {running === "invite" ? "Inviting…" : "Invite Students"}
                </button>
                <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>Sends API invite to all pending students</div>
              </div>
              {running && (
                <button style={{ ...S.btn("danger"), minWidth: 110, marginLeft: "auto", alignSelf: "flex-start" }} onClick={cancelJob}>Cancel</button>
              )}
            </div>

            {/* Progress log */}
            {logs.length > 0 && (
              <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>Progress Log</span>
                  <button style={{ ...S.btn("secondary"), padding: "4px 12px", fontSize: 11 }} onClick={() => setLogs([])}>Clear</button>
                </div>
                <div style={{ background: "#0a0b10", padding: "16px 20px", maxHeight: 420, overflowY: "auto", fontFamily: "'DM Mono', monospace", fontSize: 12.5, lineHeight: 1.9 }}>
                  {logs.map(entry => (
                    <div key={entry.id} style={{ color: LOG_COLOR[entry.type] || "#e0e0e8" }}>{entry.message}</div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CREDIT USAGE TAB ── */}
        {tab === "usage" && (
          <div style={{ animation: "fadeIn 0.2s ease" }}>
            <div style={S.sectionTitle}>Credit Usage</div>
            <div style={S.sectionSub}>Active job time only — idle usage appears in your Railway dashboard. Rate: ~$0.021/hour (0.5 vCPU + 512MB).</div>

            {/* Summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
              {[
                [`${creditStats.totalMinutes} min`, `Active time — ${currentMonth}`, "#7eb8ff"],
                [`$${creditStats.estimatedCost.toFixed(4)}`, "Est. active cost", "#f5a623"],
                [`$${(FREE_TRIAL - creditStats.estimatedCost).toFixed(3)}`, "Trial credit remaining", "#00c896"],
              ].map(([val, lbl, color]) => (
                <div key={lbl} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 22px" }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 24, color }}>{val}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, fontFamily: "'Inter', sans-serif" }}>{lbl}</div>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div style={{ ...S.card, padding: "20px 24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontFamily: "'Inter', sans-serif", fontWeight: 700, color: "#0f172a" }}>Free Trial Usage</span>
                <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: "#64748b" }}>
                  ${creditStats.estimatedCost.toFixed(4)} of ${FREE_TRIAL.toFixed(2)}
                </span>
              </div>
              <div style={{ background: "#e2e8f0", borderRadius: 6, height: 10, overflow: "hidden" }}>
                <div style={{ width: `${creditStats.percentUsed}%`, height: "100%", background: creditStats.percentUsed > 80 ? "#ff5555" : creditStats.percentUsed > 50 ? "#f5a623" : "#00c896", borderRadius: 6, transition: "width 0.5s ease" }} />
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>
                Active compute only. For total spend including idle time, check your{" "}
                <a href="https://railway.app" target="_blank" rel="noreferrer" style={{ color: "#3b82f6" }}>Railway dashboard</a>.
              </div>
            </div>

            {/* Job history */}
            <div style={S.card}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 12, color: "#64748b", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Job History — {currentMonth}
              </div>
              {jobLogs.length === 0 ? (
                <div style={{ textAlign: "center", color: "#94a3b8", padding: "32px 0", fontSize: 13 }}>No jobs run this month yet.</div>
              ) : (
                <table style={S.table}>
                  <thead>
                    <tr>
                      {["Type", "Date", "Duration", "Result", "Est. Cost"].map(h => <th key={h} style={S.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {jobLogs.map(log => {
                      const cost = (log.durationMinutes || 0) * RATE_PER_MIN;
                      const result = log.type === "publish"
                        ? `${log.passed ?? 0} published, ${log.failed ?? 0} failed`
                        : `${log.sent ?? 0} sent, ${log.failed ?? 0} failed`;
                      return (
                        <tr key={log.id}
                          onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <td style={S.td}>
                            <span style={S.badge(log.type === "publish" ? "#3b82f6" : "#00c896")}>
                              {log.type}
                            </span>
                          </td>
                          <td style={{ ...S.td, whiteSpace: "nowrap", fontSize: 12 }}>
                            {log.loggedAt?.slice(0, 10) || "—"}
                          </td>
                          <td style={{ ...S.td, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                            {log.durationMinutes?.toFixed(1) || "—"} min
                          </td>
                          <td style={{ ...S.td, fontSize: 12, color: "#94a3b8" }}>{result}</td>
                          <td style={{ ...S.td, fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#f5a623" }}>
                            ${cost.toFixed(5)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ padding: "14px 18px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11, color: "#64748b", lineHeight: 1.8 }}>
              <strong style={{ color: "#2563eb" }}>Rate used:</strong> $0.000232/min CPU + $0.000116/min RAM = $0.000348/min total&nbsp;&nbsp;·&nbsp;&nbsp;
              <strong style={{ color: "#2563eb" }}>Free trial:</strong> $5.00 one-time (no credit card)
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
