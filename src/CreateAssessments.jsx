import { useState, useEffect, useRef, useMemo } from "react";
import { db } from "./firebase";
import { useAuth } from "./AuthContext";
import { doc, getDoc, setDoc } from "firebase/firestore";


const LOG_COLOR = {
  success: "#00c896",
  error:   "#ff5555",
  warn:    "#f5a623",
  info:    "#7eb8ff",
  done:    "#00c896",
};

export default function CreateAssessments({ S, examSessions, bookingRows, showToast }) {
  const { allowedPages } = useAuth();
  const canViewCredentials = allowedPages.includes("credentials");
  const [tab, setTab] = useState("run");
  const [serverOnline, setServerOnline] = useState(null);

  const [creds, setCreds] = useState({
    mobile: "", otp: "",
    apiEndpoint: "", apiToken: "",
    serverUrl: "http://localhost:3001",
    serverSecret: "",
    topinLoginUrl: "https://accounts.ccbp.in/login?client_id=topin_config&auth_client_id=topin&call_back_url=https://config.topin.tech/&mode=otp&WINDOW_MODE=IN_APP",
  });
  const [credsSaved, setCredsSaved] = useState(false);
  const [credsLoaded, setCredsLoaded] = useState(false);

  const [selDate, setSelDate] = useState("");
  const [running, setRunning] = useState(null);
  const [logs, setLogs] = useState([]);
  const [runStartTs, setRunStartTs] = useState(null);
  const logsEndRef = useRef(null);
  const esRef = useRef(null);

  // Load credentials from Firestore
  useEffect(() => {
    getDoc(doc(db, "settings", "automation")).then(snap => {
      if (snap.exists()) setCreds(prev => ({ ...prev, ...snap.data() }));
      setCredsLoaded(true);
    }).catch(() => setCredsLoaded(true));
  }, []);


  // Redirect away from credentials tab if permission is revoked mid-session
  useEffect(() => {
    if (tab === "credentials" && !canViewCredentials) setTab("run");
  }, [canViewCredentials, tab]);

  // Server health check — restarts whenever serverUrl changes
  useEffect(() => {
    if (!credsLoaded || !creds.serverUrl) return;
    setServerOnline(null);
    const isLocal = creds.serverUrl.includes("localhost") || creds.serverUrl.includes("127.0.0.1");
    const headers = creds.serverSecret ? { "x-server-token": creds.serverSecret } : {};

    const check = () =>
      fetch(`${creds.serverUrl}/health`, { signal: AbortSignal.timeout(isLocal ? 3000 : 40000), headers })
        .then(r => setServerOnline(r.ok))
        .catch(() => setServerOnline(false));

    // On load, check if a job is already running on the server (e.g. page was refreshed
    // mid-publish). If so, restore the running state and reconnect the SSE stream so the
    // Cancel button reappears and new log lines keep flowing in.
    const checkJobStatus = () =>
      fetch(`${creds.serverUrl}/status`, { signal: AbortSignal.timeout(5000), headers })
        .then(r => r.json())
        .then(data => {
          if (data.jobRunning && !esRef.current) {
            setRunning("publish");
            startSSE();
          }
        })
        .catch(() => {});

    check();
    checkJobStatus();
    const id = setInterval(check, isLocal ? 5000 : 15000);
    return () => clearInterval(id);
  }, [creds.serverUrl, creds.serverSecret, credsLoaded]);

  // Scroll progress log to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);


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

  const addLog = (type, message, ts = Date.now()) =>
    setLogs(prev => [...prev, { type, message, ts, id: ts + Math.random() }]);

  const startSSE = () => {
    if (esRef.current) esRef.current.close();
    const start = Date.now();
    setRunStartTs(start);
    const es = new EventSource(`${creds.serverUrl}/progress`);
    esRef.current = es;
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      addLog(data.type, data.message, data.ts || Date.now());
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
      const res = await fetch(`${creds.serverUrl}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(creds.serverSecret ? { "x-server-token": creds.serverSecret } : {}) },
        body: JSON.stringify({ mobile: creds.mobile, otp: creds.otp, date: selDate || null, topinLoginUrl: creds.topinLoginUrl || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error || `Server error (${res.status})`;
        addLog("error", msg);
        setRunning(null);
        if (esRef.current) { esRef.current.close(); esRef.current = null; }
      }
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
      const res = await fetch(`${creds.serverUrl}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(creds.serverSecret ? { "x-server-token": creds.serverSecret } : {}) },
        body: JSON.stringify({ apiEndpoint: creds.apiEndpoint, apiToken: creds.apiToken, date: selDate || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error || `Server error (${res.status})`;
        addLog("error", msg);
        setRunning(null);
        if (esRef.current) { esRef.current.close(); esRef.current = null; }
      }
    } catch {
      addLog("error", "Failed to reach server.");
      setRunning(null);
    }
  };

  const cancelJob = async () => {
    try {
      await fetch(`${creds.serverUrl}/cancel`, {
        method: "POST",
        headers: creds.serverSecret ? { "x-server-token": creds.serverSecret } : {},
      });
    } catch { /* best-effort */ }
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
          {[["run","Select & Run"], ...(canViewCredentials ? [["credentials","Credentials"]] : [])].map(([key, label]) => (
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
                placeholder="http://localhost:3001  or  https://your-app.onrender.com"
                value={creds.serverUrl}
                onChange={e => setCreds(p => ({ ...p, serverUrl: e.target.value.trim() }))} />
              <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                Local: <code style={{ color: "#3b82f6" }}>http://localhost:3001</code> &nbsp;·&nbsp;
                Render: paste your Render service URL here — shared across all devices automatically.
              </div>
              <div style={{ marginTop: 18 }}>
                <label style={S.label}>Server Secret</label>
                <input style={S.input} type="password"
                  placeholder="Must match SERVER_SECRET on Render (leave blank for local dev)"
                  value={creds.serverSecret}
                  onChange={e => setCreds(p => ({ ...p, serverSecret: e.target.value }))} />
                <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                  Set <code style={{ color: "#3b82f6" }}>SERVER_SECRET</code> in Render → Environment, then paste the same value here.
                  Requests without a matching token will be rejected with 401.
                </div>
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
                  <label style={S.label}>API Key</label>
                  <input style={S.input} type="password" placeholder="X-API-KEY value…"
                    value={creds.apiToken} onChange={e => setCreds(p => ({ ...p, apiToken: e.target.value }))} />
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
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button style={{ ...S.btn("primary"), minWidth: 190, opacity: (running || !serverOnline) ? 0.45 : 1 }}
                    onClick={handlePublish} disabled={!!running || !serverOnline}>
                    {running === "publish" ? "Publishing…" : "Publish Sessions"}
                  </button>
                  {running === "publish" && (
                    <button style={{ ...S.btn("danger"), minWidth: 90 }} onClick={cancelJob}>Stop</button>
                  )}
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>Opens browser · clones &amp; publishes on Topin</div>
              </div>
              <div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button style={{ ...S.btn("secondary"), minWidth: 190, opacity: (running || !serverOnline) ? 0.45 : 1, border: "1px solid #e2e8f0" }}
                    onClick={handleInvite} disabled={!!running || !serverOnline}>
                    {running === "invite" ? "Inviting…" : "Invite Students"}
                  </button>
                  {running === "invite" && (
                    <button style={{ ...S.btn("danger"), minWidth: 90 }} onClick={cancelJob}>Stop</button>
                  )}
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>Sends API invite to all pending students</div>
              </div>
            </div>

            {/* Progress log */}
            {logs.length > 0 && (
              <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>Progress Log</span>
                  <button style={{ ...S.btn("secondary"), padding: "4px 12px", fontSize: 11 }} onClick={() => { setLogs([]); setRunStartTs(null); }}>Clear</button>
                </div>
                <div style={{ background: "#0a0b10", padding: "16px 20px", maxHeight: 420, overflowY: "auto", fontFamily: "'DM Mono', monospace", fontSize: 12.5, lineHeight: 1.9 }}>
                  {logs.map((entry) => {
                    const elapsed = runStartTs ? Math.max(0, Math.round((entry.ts - runStartTs) / 1000)) : 0;
                    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
                    const ss = String(elapsed % 60).padStart(2, "0");
                    return (
                      <div key={entry.id} style={{ display: "flex", gap: 10, color: LOG_COLOR[entry.type] || "#e0e0e8" }}>
                        <span style={{ color: "#3a4a5c", flexShrink: 0, userSelect: "none" }}>[{mm}:{ss}]</span>
                        <span>{entry.message}</span>
                      </div>
                    );
                  })}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}
          </div>
        )}


      </div>
    </div>
  );
}
