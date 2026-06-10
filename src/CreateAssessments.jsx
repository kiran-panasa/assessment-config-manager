import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useAuth } from "./AuthContext";
import {
  localApi, checkLocalHealth, localProgressStream,
  getLocalServerUrl, setLocalServerUrl,
} from "./api/client";
import { getSettings, saveSettings, getSessions, getBookingsForDate } from "./api/firestore";


const LOG_COLOR = {
  success: "#00c896",
  error:   "#ff5555",
  warn:    "#f5a623",
  info:    "#7eb8ff",
  done:    "#00c896",
};

export default function CreateAssessments({ S, showToast }) {
  const { allowedPages } = useAuth();
  const canViewCredentials = allowedPages.includes("credentials");
  const [tab, setTab] = useState("run");
  const [serverOnline, setServerOnline] = useState(null);

  const [creds, setCreds] = useState({
    mobile: "", otp: "",
    apiEndpoint: "", apiToken: "",
    tinyUrlToken: "",
    topinLoginUrl: "https://accounts.ccbp.in/login?client_id=topin_config&auth_client_id=topin&call_back_url=https://config.topin.tech/&mode=otp",
  });
  const [credsSaved, setCredsSaved] = useState(false);
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [localUrl, setLocalUrl] = useState(() => getLocalServerUrl());

  const [examSessions, setExamSessions] = useState([]);
  const [bookingRows, setBookingRows] = useState([]);

  const [selDate, setSelDate] = useState("");
  const [running, setRunning] = useState(null);
  const [logs, setLogs] = useState([]);
  const [runStartTs, setRunStartTs] = useState(null);
  const logsEndRef = useRef(null);
  const esRef = useRef(null);
  const selDateRef = useRef(selDate);
  useEffect(() => { selDateRef.current = selDate; }, [selDate]);

  // Load credentials and all sessions once (for dates list)
  useEffect(() => {
    getSettings()
      .then(data => { if (data) setCreds(prev => ({ ...prev, ...data })); })
      .catch(() => {})
      .finally(() => setCredsLoaded(true));

    getSessions().then(data => setExamSessions(data || [])).catch(() => {});
  }, []);

  // When a date is selected, load only that date's bookings
  useEffect(() => {
    if (!selDate) { setBookingRows([]); return; }
    getBookingsForDate(selDate).then(data => setBookingRows(data || [])).catch(() => {});
  }, [selDate]);

  // Redirect away from credentials tab if permission is revoked mid-session
  useEffect(() => {
    if (tab === "credentials" && !canViewCredentials) setTab("run");
  }, [canViewCredentials, tab]);

  const startSSE = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const start = Date.now();
    setRunStartTs(start);
    const es = localProgressStream();
    esRef.current = es;
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setLogs(prev => [...prev, { type: data.type, message: data.message, ts: data.ts || Date.now(), id: (data.ts || Date.now()) + Math.random() }]);
      if (data.type === "done") {
        setRunning(null);
        es.close();
        esRef.current = null;
        showToast(data.message);
        // Refresh stats after job
        getSessions().then(d => setExamSessions(d || [])).catch(() => {});
        const d = selDateRef.current;
        if (d) getBookingsForDate(d).then(rows => setBookingRows(rows || [])).catch(() => {});
      }
    };
    es.onerror = () => {
      setLogs(prev => [...prev, { type: "error", message: "Lost connection to server.", ts: Date.now(), id: Date.now() + Math.random() }]);
      setRunning(null);
      es.close();
      esRef.current = null;
    };
  }, [showToast]);

  // Server health check (for local publish server)
  useEffect(() => {
    if (!credsLoaded) return;
    setServerOnline(null);

    const check = () => checkLocalHealth()
      .then(ok => setServerOnline(ok))
      .catch(() => setServerOnline(false));

    const checkJobStatus = () => localApi.get("/api/publish/status")
      .then(data => {
        if (data.jobRunning && !esRef.current) {
          setRunning("publish");
          startSSE();
        }
      })
      .catch(() => {});

    check();
    checkJobStatus();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, [credsLoaded, startSSE]);

  // Scroll progress log to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);


  const saveCreds = async () => {
    try {
      await saveSettings(creds);
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

  const handlePublish = async () => {
    if (!getLocalServerUrl()) { showToast("Set Local Server URL in Credentials tab first.", "error"); return; }
    if (!serverOnline) { showToast("Local server offline. Run: node src/index.js", "error"); return; }
    if (!creds.mobile || !creds.otp) { showToast("Enter Topin mobile and OTP in Credentials tab first.", "error"); return; }
    setLogs([]);
    setRunning("publish");
    startSSE();
    try {
      await localApi.post("/api/publish/run", {
        mobile: creds.mobile, otp: creds.otp,
        date: selDate || null,
        topinLoginUrl: creds.topinLoginUrl || null,
      });
    } catch (err) {
      addLog("error", err.message || "Server error");
      setRunning(null);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    }
  };

  const handleInvite = async () => {
    if (!getLocalServerUrl()) { showToast("Set Local Server URL in Credentials tab first.", "error"); return; }
    if (!serverOnline) { showToast("Local server offline. Run: node src/index.js", "error"); return; }
    if (!creds.apiEndpoint || !creds.apiToken) { showToast("Enter Invite API credentials first.", "error"); return; }
    setLogs([]);
    setRunning("invite");
    startSSE();
    try {
      await localApi.post("/api/publish/invite", {
        apiEndpoint: creds.apiEndpoint, apiToken: creds.apiToken,
        date: selDate || null,
      });
    } catch (err) {
      addLog("error", err.message || "Server error");
      setRunning(null);
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    }
  };

  const cancelJob = async () => {
    try { await localApi.post("/api/publish/cancel"); } catch { /* best-effort */ }
    setRunning(null);
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
  };

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
            {serverOnline === null ? "Checking…" : serverOnline ? "Server online" : "Server offline"}
          </span>
        </div>
      </div>

      <div style={S.body}>

        {/* ── Offline warning ── */}
        {serverOnline === false && (
          <div style={{ marginBottom: 24, padding: "16px 20px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, color: "#dc2626", lineHeight: 1.9 }}>
            <strong>Local server offline.</strong>{" "}
            Run <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: 4, fontFamily: "'DM Mono', monospace", color: "#e2e8f0" }}>node src/index.js</code> in the server directory, then refresh.
          </div>
        )}

        {/* ── CREDENTIALS TAB ── */}
        {tab === "credentials" && (
          <div style={{ animation: "fadeIn 0.2s ease" }}>
            <div style={S.sectionTitle}>Credentials</div>
            <div style={S.sectionSub}>All values are saved to Firestore and auto-loaded on every device.</div>

            {/* Local Server URL */}
            <div style={S.card}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 12, color: "#7c3aed", marginBottom: 18, textTransform: "uppercase", letterSpacing: "0.06em" }}>Local Publish Server</div>
              <div>
                <label style={S.label}>Local Server URL</label>
                <div style={{ display: "flex", gap: 10 }}>
                  <input style={{ ...S.input, flex: 1 }} type="url"
                    placeholder="http://localhost:3001"
                    value={localUrl}
                    onChange={e => setLocalUrl(e.target.value)} />
                  <button style={{ ...S.btn("primary"), whiteSpace: "nowrap", background: "#7c3aed" }}
                    onClick={() => { setLocalServerUrl(localUrl); showToast(localUrl ? "Local server URL saved." : "Local server URL cleared."); }}>
                    Save
                  </button>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                  Run <code style={{ background: "#1e293b", padding: "1px 5px", borderRadius: 3, fontFamily: "'DM Mono', monospace", color: "#e2e8f0", fontSize: 10 }}>node src/index.js</code> locally, then paste the URL here. Saved in browser only (not Firestore).
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
                  <label style={S.label}>OTP</label>
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

            {/* TinyURL */}
            <div style={S.card}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 12, color: "#2563eb", marginBottom: 18, textTransform: "uppercase", letterSpacing: "0.06em" }}>TinyURL</div>
              <div>
                <label style={S.label}>TinyURL API Token</label>
                <input style={S.input} type="password" placeholder="TinyURL Bearer token…"
                  value={creds.tinyUrlToken} onChange={e => setCreds(p => ({ ...p, tinyUrlToken: e.target.value }))} />
                <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                  Used to auto-shorten assessment links. Get from tinyurl.com/app/settings/api.
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
                [selDate ? stats.toInvite  : "—", "Invites Pending", "#f5a623"],
                [selDate ? stats.invited   : "—", "Invites Sent",    "#00c896"],
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
                  <button style={{ ...S.btn("secondary"), minWidth: 190, opacity: running ? 0.45 : 1, border: "1px solid #e2e8f0" }}
                    onClick={handleInvite} disabled={!!running}>
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
