import { useState, useEffect } from "react";

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
const STORAGE_KEY = "assessment-config-data";

function Toast({ message, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{
      position: "fixed", bottom: 32, right: 32, zIndex: 9999,
      background: type === "error" ? "#ff4444" : "#00c896",
      color: "#fff", padding: "12px 22px", borderRadius: 8,
      fontFamily: "'DM Mono', monospace", fontSize: 13,
      boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
      animation: "slideUp 0.25s ease",
    }}>
      {message}
    </div>
  );
}

const IconAssessment = ({ color }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);

const IconBookings = ({ color }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

function StudentBookings({ S }) {
  const columns = ["Student Name", "Email", "Skill", "Level", "Booking Date", "Status"];
  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={S.sectionTitle}>Student Bookings</div>
      <div style={S.sectionSub}>Student booking records fetched from Replit database.</div>
      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col} style={S.th}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={columns.length} style={{ ...S.td, textAlign: "center", padding: "60px 0", color: "#555a7a", fontSize: 13 }}>
                <div style={{ marginBottom: 10, fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#3a3d52" }}>
                  No data yet
                </div>
                Connect your Replit database to load student bookings.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function App() {
  const [assessments, setAssessments] = useState([]);
  const [skills, setSkills] = useState(DEFAULT_SKILLS);
  const [levels, setLevels] = useState(DEFAULT_LEVELS);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("assessments"); // assessments | bookings
  const [tab, setTab] = useState("entry"); // entry | manage | settings
  const [toast, setToast] = useState(null);

  const [selSkill, setSelSkill] = useState("");
  const [selLevel, setSelLevel] = useState("");
  const [configUrl, setConfigUrl] = useState("");
  const [editId, setEditId] = useState(null);

  const [newSkill, setNewSkill] = useState("");
  const [newLevel, setNewLevel] = useState("");

  const [filterSkill, setFilterSkill] = useState("All");
  const [filterLevel, setFilterLevel] = useState("All");

  const showToast = (message, type = "success") => setToast({ message, type });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.assessments) setAssessments(data.assessments);
        if (data.skills) setSkills(data.skills);
        if (data.levels) setLevels(data.levels);
      }
    } catch (_) {}
    setLoading(false);
  }, []);

  const persist = (newAssessments, newSkills, newLevels) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        assessments: newAssessments ?? assessments,
        skills: newSkills ?? skills,
        levels: newLevels ?? levels,
      }));
    } catch (_) {}
  };

  const isValidUrl = (url) => {
    try { new URL(url); return true; } catch { return false; }
  };

  const handleSave = () => {
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

    let updated;
    if (editId) {
      updated = assessments.map(a =>
        a.id === editId ? { ...a, skill: selSkill, level: selLevel, url: configUrl.trim() } : a
      );
      showToast("Assessment updated.");
    } else {
      updated = [...assessments, {
        id: Date.now().toString(),
        skill: selSkill, level: selLevel,
        url: configUrl.trim(),
        createdAt: new Date().toISOString(),
      }];
      showToast("Assessment saved.");
    }
    setAssessments(updated);
    persist(updated, null, null);
    setSelSkill(""); setSelLevel(""); setConfigUrl(""); setEditId(null);
  };

  const handleEdit = (a) => {
    setSelSkill(a.skill); setSelLevel(a.level); setConfigUrl(a.url);
    setEditId(a.id); setTab("entry");
  };

  const handleDelete = (id) => {
    const updated = assessments.filter(a => a.id !== id);
    setAssessments(updated);
    persist(updated, null, null);
    showToast("Deleted.");
  };

  const handleAddSkill = () => {
    const s = newSkill.trim();
    if (!s || skills.includes(s)) { showToast("Skill already exists or empty.", "error"); return; }
    const updated = [...skills, s];
    setSkills(updated); setNewSkill("");
    persist(null, updated, null);
    showToast("Skill added.");
  };

  const handleRemoveSkill = (s) => {
    const updated = skills.filter(x => x !== s);
    setSkills(updated);
    persist(null, updated, null);
    showToast("Skill removed.");
  };

  const handleAddLevel = () => {
    const l = newLevel.trim().toUpperCase();
    if (!l || levels.includes(l)) { showToast("Level exists or empty.", "error"); return; }
    const updated = [...levels, l];
    setLevels(updated); setNewLevel("");
    persist(null, null, updated);
    showToast("Level added.");
  };

  const handleRemoveLevel = (l) => {
    const updated = levels.filter(x => x !== l);
    setLevels(updated);
    persist(null, null, updated);
    showToast("Level removed.");
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
    root: {
      minHeight: "100vh",
      background: "#0d0e14",
      fontFamily: "'DM Mono', monospace",
      color: "#e0e0e8",
      display: "flex",
    },
    sidebar: {
      width: 240,
      background: "#0a0b10",
      borderRight: "1px solid #1e2030",
      display: "flex",
      flexDirection: "column",
      position: "fixed",
      top: 0, left: 0, bottom: 0,
      zIndex: 200,
    },
    sidebarBrand: {
      padding: "24px 20px",
      borderBottom: "1px solid #1e2030",
      fontFamily: "'Syne', sans-serif",
      fontWeight: 800,
      fontSize: 15,
      color: "#fff",
      letterSpacing: "-0.3px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      lineHeight: 1.3,
    },
    dot: {
      width: 8, height: 8, borderRadius: "50%",
      background: "#00c896", display: "inline-block",
      flexShrink: 0,
    },
    sidebarNav: {
      padding: "12px 10px",
      flex: 1,
    },
    sidebarItem: (active) => ({
      display: "flex",
      alignItems: "center",
      gap: 11,
      width: "100%",
      padding: "10px 12px",
      borderRadius: 8,
      fontFamily: "'Syne', sans-serif",
      fontWeight: 600,
      fontSize: 12.5,
      letterSpacing: "0.01em",
      cursor: "pointer",
      color: active ? "#fff" : "#555a7a",
      background: active ? "#1a1b24" : "transparent",
      border: "none",
      borderLeft: active ? "2px solid #00c896" : "2px solid transparent",
      textAlign: "left",
      transition: "all 0.15s",
      marginBottom: 2,
    }),
    main: {
      marginLeft: 240,
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
    },
    header: {
      borderBottom: "1px solid #1e2030",
      padding: "0 48px",
      display: "flex",
      alignItems: "flex-end",
      gap: 40,
      background: "#0d0e14",
      position: "sticky",
      top: 0,
      zIndex: 100,
    },
    headerTitle: {
      fontFamily: "'Syne', sans-serif",
      fontWeight: 700,
      fontSize: 13,
      color: "#3a3d52",
      paddingBottom: 20,
      paddingTop: 20,
      marginRight: 8,
    },
    nav: { display: "flex", gap: 0 },
    navItem: (active) => ({
      padding: "18px 22px",
      fontFamily: "'Syne', sans-serif",
      fontWeight: 600,
      fontSize: 13,
      letterSpacing: "0.04em",
      cursor: "pointer",
      color: active ? "#fff" : "#555a7a",
      background: "none",
      border: "none",
      borderBottom: active ? "2px solid #00c896" : "2px solid transparent",
      transition: "color 0.15s",
    }),
    body: { padding: "40px 48px", maxWidth: 1100 },
    card: {
      background: "#13141e",
      border: "1px solid #1e2030",
      borderRadius: 12,
      padding: "32px 36px",
      marginBottom: 24,
    },
    label: {
      fontSize: 11,
      fontFamily: "'Syne', sans-serif",
      fontWeight: 700,
      letterSpacing: "0.12em",
      color: "#555a7a",
      textTransform: "uppercase",
      marginBottom: 8,
      display: "block",
    },
    select: {
      width: "100%",
      background: "#0d0e14",
      border: "1px solid #2e3044",
      borderRadius: 8,
      color: "#e0e0e8",
      padding: "11px 14px",
      fontFamily: "'DM Mono', monospace",
      fontSize: 13,
      outline: "none",
      appearance: "none",
      cursor: "pointer",
    },
    input: {
      width: "100%",
      background: "#0d0e14",
      border: "1px solid #2e3044",
      borderRadius: 8,
      color: "#e0e0e8",
      padding: "11px 14px",
      fontFamily: "'DM Mono', monospace",
      fontSize: 13,
      outline: "none",
    },
    btn: (variant = "primary") => ({
      padding: "11px 24px",
      borderRadius: 8,
      fontFamily: "'Syne', sans-serif",
      fontWeight: 700,
      fontSize: 13,
      letterSpacing: "0.04em",
      cursor: "pointer",
      background: variant === "primary" ? "#00c896"
        : variant === "danger" ? "transparent"
        : "#1e2030",
      color: variant === "primary" ? "#0d0e14"
        : variant === "danger" ? "#ff5555"
        : "#aab",
      border: variant === "danger" ? "1px solid #ff5555" : "none",
      transition: "opacity 0.15s",
    }),
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 },
    grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 },
    sectionTitle: {
      fontFamily: "'Syne', sans-serif",
      fontWeight: 800,
      fontSize: 22,
      color: "#fff",
      marginBottom: 6,
    },
    sectionSub: {
      fontSize: 12,
      color: "#555a7a",
      marginBottom: 28,
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: 13,
    },
    th: {
      fontFamily: "'Syne', sans-serif",
      fontWeight: 700,
      fontSize: 11,
      letterSpacing: "0.1em",
      color: "#555a7a",
      textTransform: "uppercase",
      padding: "10px 16px",
      textAlign: "left",
      borderBottom: "1px solid #1e2030",
    },
    td: {
      padding: "14px 16px",
      borderBottom: "1px solid #1a1b24",
      verticalAlign: "middle",
    },
    badge: (color = "#00c896") => ({
      display: "inline-block",
      background: color + "18",
      color: color,
      borderRadius: 4,
      padding: "2px 10px",
      fontSize: 11,
      fontFamily: "'Syne', sans-serif",
      fontWeight: 700,
      letterSpacing: "0.08em",
    }),
    pill: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      background: "#1a1b24",
      border: "1px solid #2e3044",
      borderRadius: 20,
      padding: "5px 12px 5px 16px",
      fontSize: 12,
      color: "#c0c4d8",
      margin: "4px",
    },
    pillX: {
      cursor: "pointer",
      fontSize: 15,
      lineHeight: 1,
      background: "none",
      border: "none",
      padding: 0,
      color: "#ff5555",
    },
  };

  const NAV_ITEMS = [
    { key: "assessments", label: "Assessment Configurations", Icon: IconAssessment },
    { key: "bookings", label: "Student Bookings", Icon: IconBookings },
  ];

  if (loading) return (
    <div style={{ ...S.root, alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <span style={{ color: "#555a7a", fontFamily: "'Syne', sans-serif", fontSize: 14 }}>Loading...</span>
    </div>
  );

  return (
    <div style={S.root}>
      <style>{css}</style>

      {/* Sidebar */}
      <aside style={S.sidebar}>
        <div style={S.sidebarBrand}>
          <span style={S.dot} />
          NxtWave Admin
        </div>
        <nav style={S.sidebarNav}>
          {NAV_ITEMS.map(({ key, label, Icon }) => {
            const active = page === key;
            const color = active ? "#fff" : "#555a7a";
            return (
              <button key={key} style={S.sidebarItem(active)} onClick={() => setPage(key)}>
                <Icon color={color} />
                {label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div style={S.main}>

        {/* Assessment Configurations page */}
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

              {/* ENTRY TAB */}
              {tab === "entry" && (() => {
                const takenCombos = assessments
                  .filter(a => a.id !== editId)
                  .map(a => `${a.skill}::${a.level}`);
                const takenSet = new Set(takenCombos);
                const skillFullyTaken = (s) => levels.every(l => takenSet.has(`${s}::${l}`));
                const levelTakenForSkill = (l) => selSkill && takenSet.has(`${selSkill}::${l}`);

                return (
                  <div style={{ animation: "fadeIn 0.2s ease" }}>
                    <div style={S.sectionTitle}>{editId ? "Edit Assessment" : "Add Assessment"}</div>
                    <div style={S.sectionSub}>Select a skill and level, then paste the config URL.</div>

                    <div style={S.card}>
                      <div style={S.grid2}>
                        <div>
                          <label style={S.label}>Skill</label>
                          <select style={S.select} value={selSkill} onChange={e => { setSelSkill(e.target.value); setSelLevel(""); }}>
                            <option value="">— Select skill —</option>
                            {skills.map(s => {
                              const taken = skillFullyTaken(s);
                              return (
                                <option key={s} value={s} disabled={taken}>
                                  {s}{taken ? " (all levels filled)" : ""}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <div>
                          <label style={S.label}>Level</label>
                          <select style={S.select} value={selLevel} onChange={e => setSelLevel(e.target.value)} disabled={!selSkill}>
                            <option value="">{selSkill ? "— Select level —" : "— Pick a skill first —"}</option>
                            {levels.map(l => {
                              const taken = levelTakenForSkill(l);
                              return (
                                <option key={l} value={l} disabled={taken}>
                                  {l}{taken ? " (filled)" : ""}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      </div>

                      {selSkill && (
                        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {levels.map(l => {
                            const taken = takenSet.has(`${selSkill}::${l}`);
                            return (
                              <span key={l} style={{
                                fontSize: 11, fontFamily: "'Syne', sans-serif", fontWeight: 700,
                                padding: "3px 10px", borderRadius: 4,
                                background: taken ? "#ff555518" : "#00c89618",
                                color: taken ? "#ff5555" : "#00c896",
                                letterSpacing: "0.06em",
                              }}>
                                {l} {taken ? "✕ filled" : "✓ open"}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      <div style={{ marginTop: 20 }}>
                        <label style={S.label}>Config URL</label>
                        <input
                          style={S.input}
                          type="url"
                          placeholder="https://config.topin.tech/view-assessment/..."
                          value={configUrl}
                          onChange={e => setConfigUrl(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && handleSave()}
                        />
                      </div>

                      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
                        <button style={S.btn("primary")} onClick={handleSave}>
                          {editId ? "Update Assessment" : "Save Assessment"}
                        </button>
                        {editId && (
                          <button style={S.btn("secondary")} onClick={() => {
                            setEditId(null); setSelSkill(""); setSelLevel(""); setConfigUrl("");
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
                              <th style={S.th}>Skill</th>
                              <th style={S.th}>Level</th>
                              <th style={S.th}>URL</th>
                              <th style={S.th}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...assessments].reverse().slice(0, 5).map(a => (
                              <tr key={a.id}>
                                <td style={S.td}>{a.skill}</td>
                                <td style={S.td}><span style={S.badge()}>{a.level}</span></td>
                                <td style={{ ...S.td, maxWidth: 300 }}>
                                  <a href={a.url} target="_blank" rel="noreferrer"
                                    style={{ color: "#00c896", textDecoration: "none", fontSize: 12, wordBreak: "break-all" }}>
                                    {a.url.slice(0, 52)}…
                                  </a>
                                </td>
                                <td style={S.td}>
                                  <button style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12 }}
                                    onClick={() => handleEdit(a)}>Edit</button>
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

              {/* MANAGE TAB */}
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
                      <div style={{ textAlign: "center", color: "#555a7a", padding: "40px 0", fontSize: 13 }}>
                        No assessments found.
                      </div>
                    ) : (
                      <table style={S.table}>
                        <thead>
                          <tr>
                            <th style={S.th}>Skill</th>
                            <th style={S.th}>Level</th>
                            <th style={S.th}>Config URL</th>
                            <th style={S.th}>Added</th>
                            <th style={S.th}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map(a => (
                            <tr key={a.id} style={{ transition: "background 0.1s" }}
                              onMouseEnter={e => e.currentTarget.style.background = "#1a1b24"}
                              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                              <td style={S.td} title={a.skill}>{a.skill}</td>
                              <td style={S.td}><span style={S.badge()}>{a.level}</span></td>
                              <td style={{ ...S.td, maxWidth: 320 }}>
                                <a href={a.url} target="_blank" rel="noreferrer"
                                  style={{ color: "#7eb8ff", textDecoration: "none", fontSize: 12, wordBreak: "break-all" }}>
                                  {a.url.length > 55 ? a.url.slice(0, 55) + "…" : a.url}
                                </a>
                              </td>
                              <td style={{ ...S.td, fontSize: 11, color: "#555a7a", whiteSpace: "nowrap" }}>
                                {a.createdAt ? new Date(a.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                              </td>
                              <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button style={{ ...S.btn("secondary"), padding: "6px 14px", fontSize: 12 }}
                                    onClick={() => handleEdit(a)}>Edit</button>
                                  <button style={{ ...S.btn("danger"), padding: "6px 14px", fontSize: 12 }}
                                    onClick={() => handleDelete(a.id)}>Del</button>
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

              {/* SETTINGS TAB */}
              {tab === "settings" && (
                <div style={{ animation: "fadeIn 0.2s ease" }}>
                  <div style={S.sectionTitle}>Skills & Levels</div>
                  <div style={S.sectionSub}>Add or remove skills and difficulty levels used across assessments.</div>

                  <div style={S.grid2}>
                    <div style={S.card}>
                      <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#fff", marginBottom: 20 }}>
                        Skills
                      </div>
                      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                        <input style={{ ...S.input, flex: 1 }} placeholder="New skill name…"
                          value={newSkill} onChange={e => setNewSkill(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && handleAddSkill()} />
                        <button style={{ ...S.btn("primary"), whiteSpace: "nowrap" }} onClick={handleAddSkill}>Add</button>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap" }}>
                        {skills.map(s => (
                          <div key={s} style={S.pill}>
                            {s}
                            <button style={S.pillX} onClick={() => handleRemoveSkill(s)} title="Remove">×</button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={S.card}>
                      <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#fff", marginBottom: 20 }}>
                        Levels
                      </div>
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
                      <strong style={{ color: "#7eb8ff" }}>Note:</strong> Removing a skill or level does not delete assessments already stored under them. Those will still appear in the manage view.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Student Bookings page */}
        {page === "bookings" && (
          <div style={S.body}>
            <StudentBookings S={S} />
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
