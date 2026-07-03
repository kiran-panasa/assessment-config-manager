import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  getBadgeConfig, addBadgeTrack, removeBadgeTrack, addBadgeLevel, removeBadgeLevel,
  getBadgeEligibleStudents, bulkSaveBadgeStudents, deleteBadgeStudents,
} from "./api/firestore";
import { parseCSV, downloadCSV } from "./utils/csv";
import Pagination from "./components/Pagination";

const PAGE_SIZE = 20;

function parseBadgeCSV(text) {
  const { headers, rows } = parseCSV(text);
  if (rows.length === 0) return { error: "CSV must have a header row and at least one data row." };
  const REQUIRED = ["track", "level", "student uid"];
  const missing = REQUIRED.filter(c => !headers.includes(c));
  if (missing.length) return { error: `Missing required columns: ${missing.join(", ")}` };
  const data = rows
    .map(row => ({ track: row.get("track"), level: row.get("level"), studentUid: row.get("student uid") }))
    .filter(r => r.track && r.level && r.studentUid);
  if (data.length === 0) return { error: "No valid data rows found." };
  return { rows: data };
}

export default function BadgeEligibility({ S, showToast }) {
  const [subTab, setSubTab] = useState("upload");
  const [tracks, setTracks] = useState([]);
  const [levels, setLevels] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  // Upload state
  const [csvData, setCsvData] = useState(null);
  const [uploadMode, setUploadMode] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  // Students tab filters
  const [filterTrack, setFilterTrack] = useState("All");
  const [filterLevel, setFilterLevel] = useState("All");
  const [pg, setPg] = useState(1);
  const [deleteModal, setDeleteModal] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Config tab
  const [newTrack, setNewTrack] = useState("");
  const [newLevel, setNewLevel] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [config, studentsData] = await Promise.all([getBadgeConfig(), getBadgeEligibleStudents()]);
      setTracks(config.tracks);
      setLevels(config.levels);
      setStudents(studentsData);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Upload logic ──────────────────────────────────────────────────────────

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { showToast("Only .csv files accepted.", "error"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = parseBadgeCSV(ev.target.result);
      if (result.error) { showToast(result.error, "error"); setCsvData(null); setUploadMode(null); }
      else { setCsvData(result); setUploadMode(null); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const dupInfo = useMemo(() => {
    if (!csvData) return null;
    const existing = new Set(students.map(s => `${s.track}||${s.level}||${s.studentUid}`));
    const dups = csvData.rows.filter(r => existing.has(`${r.track}||${r.level}||${r.studentUid}`));
    const combos = [...new Set(csvData.rows.map(r => `${r.track} · ${r.level}`))];
    return { dupCount: dups.length, newCount: csvData.rows.length - dups.length, combos };
  }, [csvData, students]);

  const handleSave = async () => {
    if (!csvData || !uploadMode || saving) return;
    setSaving(true);
    try {
      const result = await bulkSaveBadgeStudents(csvData.rows, uploadMode);
      const msg = uploadMode === "replace"
        ? `Replaced ${result.replaced} old records. Added ${result.added} students.`
        : `Added ${result.added} students. Skipped ${result.skipped} duplicates.`;
      showToast(msg);
      setCsvData(null); setUploadMode(null);
      if (fileRef.current) fileRef.current.value = "";
      setSubTab("students");
      await loadData();
    } catch (err) { showToast(err.message, "error"); }
    setSaving(false);
  };

  // ── Students tab ──────────────────────────────────────────────────────────

  const filtered = useMemo(() =>
    students.filter(s =>
      (filterTrack === "All" || s.track === filterTrack) &&
      (filterLevel === "All" || s.level === filterLevel)
    ),
  [students, filterTrack, filterLevel]);

  const paged = filtered.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE);

  const summary = useMemo(() => {
    const map = new Map();
    students.forEach(s => {
      const k = `${s.track}||${s.level}`;
      map.set(k, (map.get(k) || 0) + 1);
    });
    return map;
  }, [students]);

  const handleDownloadCSV = () => {
    downloadCSV(
      filtered.map(r => [r.track, r.level, r.studentUid]),
      ["Track", "Level", "Student UID"],
      `badge-eligible-students${filterTrack !== "All" ? `-${filterTrack}` : ""}${filterLevel !== "All" ? `-${filterLevel}` : ""}.csv`
    );
  };

  const handleDelete = async () => {
    if (!deleteModal || deleting) return;
    setDeleting(true);
    try {
      const count = await deleteBadgeStudents(
        deleteModal.track === "All" ? null : deleteModal.track,
        deleteModal.level === "All" ? null : deleteModal.level,
      );
      showToast(`Deleted ${count} records.`);
      setDeleteModal(null);
      await loadData();
    } catch (err) { showToast(err.message, "error"); }
    setDeleting(false);
  };

  // ── Config tab ────────────────────────────────────────────────────────────

  const handleAddTrack = async () => {
    const t = newTrack.trim();
    if (!t) return;
    if (tracks.includes(t)) { showToast("Track already exists.", "error"); return; }
    try { await addBadgeTrack(t); setNewTrack(""); showToast("Track added."); await loadData(); }
    catch (err) { showToast(err.message, "error"); }
  };

  const handleRemoveTrack = async (t) => {
    try { await removeBadgeTrack(t); showToast("Track removed."); await loadData(); }
    catch (err) { showToast(err.message, "error"); }
  };

  const handleAddLevel = async () => {
    const l = newLevel.trim();
    if (!l) return;
    if (levels.includes(l)) { showToast("Level already exists.", "error"); return; }
    try { await addBadgeLevel(l); setNewLevel(""); showToast("Level added."); await loadData(); }
    catch (err) { showToast(err.message, "error"); }
  };

  const handleRemoveLevel = async (l) => {
    try { await removeBadgeLevel(l); showToast("Level removed."); await loadData(); }
    catch (err) { showToast(err.message, "error"); }
  };

  if (loading) return <div style={{ padding: "60px 0", color: "#94a3b8", fontFamily: "'Inter', sans-serif", fontSize: 14 }}>Loading…</div>;

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>

      {/* Sub-tab nav */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #e2e8f0", marginBottom: 28 }}>
        {[["upload", "Upload"], ["students", `Students (${students.length})`], ["config", "Tracks & Levels"]].map(([key, label]) => (
          <button key={key} style={{ ...S.navItem(subTab === key), paddingLeft: 0, paddingRight: 20 }} onClick={() => setSubTab(key)}>{label}</button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", paddingBottom: 18, paddingTop: 18, gap: 10 }}>
          <button onClick={loadData} style={{ ...S.btn("secondary"), padding: "5px 12px", fontSize: 11 }}>Refresh</button>
        </div>
      </div>

      {/* ── UPLOAD ── */}
      {subTab === "upload" && (
        <div style={{ animation: "fadeIn 0.2s ease" }}>
          <div style={S.sectionTitle}>Upload Eligible Students</div>
          <div style={S.sectionSub}>Upload a CSV with Track, Level, and Student UID to mark students as badge-eligible.</div>

          <div style={{ ...S.card, background: "#f8fafc", border: "1px solid #e2e8f0", padding: "16px 24px", marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
              <strong style={{ color: "#2563eb" }}>Required columns:</strong>{" "}
              <code style={{ background: "#1e293b", color: "#e2e8f0", padding: "1px 6px", borderRadius: 3, fontFamily: "'DM Mono', monospace", fontSize: 11 }}>Track</code>{" "}
              <code style={{ background: "#1e293b", color: "#e2e8f0", padding: "1px 6px", borderRadius: 3, fontFamily: "'DM Mono', monospace", fontSize: 11 }}>Level</code>{" "}
              <code style={{ background: "#1e293b", color: "#e2e8f0", padding: "1px 6px", borderRadius: 3, fontFamily: "'DM Mono', monospace", fontSize: 11 }}>Student UID</code>
            </div>
          </div>

          <div style={S.card}>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleFile} />

            {!csvData ? (
              <button style={{ ...S.btn("secondary"), border: "1px dashed #cbd5e1" }} onClick={() => fileRef.current?.click()}>
                Choose CSV File
              </button>
            ) : (
              <div>
                {/* Preview summary */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
                  {[
                    [csvData.rows.length, "Total rows", "#3b82f6"],
                    [dupInfo.newCount, "New students", "#00c896"],
                    [dupInfo.dupCount, "Duplicates found", "#f5a623"],
                  ].map(([val, lbl, color]) => (
                    <div key={lbl} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 18px" }}>
                      <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 22, color }}>{val}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{lbl}</div>
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom: 4, fontSize: 11, color: "#64748b", fontFamily: "'Inter', sans-serif", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Track · Level combinations in this file
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
                  {dupInfo.combos.map(c => (
                    <span key={c} style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, padding: "3px 10px", fontSize: 12, color: "#1d4ed8", fontFamily: "'Inter', sans-serif" }}>{c}</span>
                  ))}
                </div>

                {/* Mode selection */}
                <div style={{ marginBottom: 20, padding: "16px 20px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8 }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 13, color: "#d97706", marginBottom: 10 }}>
                    How should existing records be handled?
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      onClick={() => setUploadMode("append")}
                      style={{ ...S.btn("secondary"), padding: "9px 16px", fontSize: 12, border: `1px solid ${uploadMode === "append" ? "#00c896" : "#e2e8f0"}`, color: uploadMode === "append" ? "#059669" : "#475569" }}>
                      Append — add {dupInfo.newCount} new, skip {dupInfo.dupCount} duplicates
                    </button>
                    <button
                      onClick={() => setUploadMode("replace")}
                      style={{ ...S.btn("secondary"), padding: "9px 16px", fontSize: 12, border: `1px solid ${uploadMode === "replace" ? "#d97706" : "#e2e8f0"}`, color: uploadMode === "replace" ? "#d97706" : "#475569" }}>
                      Replace — delete existing records for these Track·Level combos, add all {csvData.rows.length} rows
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    style={{ ...S.btn("primary"), opacity: (!uploadMode || saving) ? 0.5 : 1 }}
                    disabled={!uploadMode || saving}
                    onClick={handleSave}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button style={S.btn("secondary")} onClick={() => { setCsvData(null); setUploadMode(null); if (fileRef.current) fileRef.current.value = ""; }}>
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── STUDENTS ── */}
      {subTab === "students" && (
        <div style={{ animation: "fadeIn 0.2s ease" }}>
          <div style={S.sectionTitle}>Eligible Students</div>
          <div style={S.sectionSub}>All students marked eligible, filterable by track and level.</div>

          {/* Summary cards */}
          {summary.size > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
              {[...summary.entries()].sort().map(([key, count]) => {
                const [track, level] = key.split("||");
                return (
                  <div key={key} style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 18px", minWidth: 160 }}>
                    <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 22, color: "#3b82f6" }}>{count}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{track}</div>
                    <div style={{ fontSize: 11, fontFamily: "'Inter', sans-serif", fontWeight: 700, color: "#94a3b8" }}>{level}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Filters + actions */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 20 }}>
            {[["Track", filterTrack, setFilterTrack, ["All", ...tracks]], ["Level", filterLevel, setFilterLevel, ["All", ...levels]]].map(([label, val, set, opts]) => (
              <div key={label}>
                <div style={{ ...S.label, marginBottom: 4 }}>{label}</div>
                <select style={{ ...S.select, width: "auto", minWidth: 160, padding: "7px 10px", fontSize: 12 }}
                  value={val} onChange={e => { set(e.target.value); setPg(1); }}>
                  {opts.map(o => <option key={o} value={o}>{o === "All" ? `All ${label}s` : o}</option>)}
                </select>
              </div>
            ))}
            {(filterTrack !== "All" || filterLevel !== "All") && (
              <button onClick={() => { setFilterTrack("All"); setFilterLevel("All"); setPg(1); }}
                style={{ ...S.btn("secondary"), padding: "7px 14px", fontSize: 12 }}>Reset</button>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {filtered.length > 0 && (
                <button onClick={handleDownloadCSV} style={{ ...S.btn("secondary"), padding: "7px 14px", fontSize: 12 }}>Download CSV</button>
              )}
              <button
                disabled={filtered.length === 0}
                onClick={() => setDeleteModal({ track: filterTrack, level: filterLevel, count: filtered.filter(s => s.inviteStatus !== "sent").length })}
                style={{ ...S.btn("danger"), padding: "7px 16px", fontSize: 12, opacity: filtered.length === 0 ? 0.35 : 1 }}>
                Delete {filtered.length > 0 ? `${filtered.length} records` : "…"}
              </button>
            </div>
          </div>

          <div style={S.card}>
            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", color: "#94a3b8", padding: "60px 0" }}>
                <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 15, color: "#94a3b8", marginBottom: 8 }}>
                  {students.length === 0 ? "No students uploaded yet" : "No results for selected filters"}
                </div>
                {students.length === 0 && "Upload a CSV in the Upload tab to get started."}
              </div>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Student UID</th>
                        <th style={S.th}>Track</th>
                        <th style={S.th}>Level</th>
                        <th style={S.th}>Uploaded At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.map(row => (
                        <tr key={row.id}
                          onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <td style={{ ...S.td, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{row.studentUid}</td>
                          <td style={S.td}>{row.track}</td>
                          <td style={S.td}><span style={S.badge("#3b82f6")}>{row.level}</span></td>
                          <td style={{ ...S.td, fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>
                            {row.uploadedAt ? new Date(row.uploadedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
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
        </div>
      )}

      {/* ── CONFIG ── */}
      {subTab === "config" && (
        <div style={{ animation: "fadeIn 0.2s ease" }}>
          <div style={S.sectionTitle}>Tracks & Levels</div>
          <div style={S.sectionSub}>Manage the track and level values used when uploading eligible students.</div>
          <div style={S.grid2}>
            <div style={S.card}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 15, color: "#0f172a", marginBottom: 20 }}>Tracks</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                <input style={{ ...S.input, flex: 1 }} placeholder="e.g. AI Systems Mastery"
                  value={newTrack} onChange={e => setNewTrack(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddTrack()} />
                <button style={{ ...S.btn("primary"), whiteSpace: "nowrap" }} onClick={handleAddTrack}>Add</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {tracks.length === 0
                  ? <div style={{ fontSize: 12, color: "#94a3b8" }}>No tracks added yet.</div>
                  : tracks.map(t => (
                    <div key={t} style={S.pill}>
                      {t}
                      <button style={S.pillX} onClick={() => handleRemoveTrack(t)}>×</button>
                    </div>
                  ))}
              </div>
            </div>
            <div style={S.card}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 15, color: "#0f172a", marginBottom: 20 }}>Levels</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                <input style={{ ...S.input, flex: 1 }} placeholder="e.g. Novice"
                  value={newLevel} onChange={e => setNewLevel(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAddLevel()} />
                <button style={{ ...S.btn("primary"), whiteSpace: "nowrap" }} onClick={handleAddLevel}>Add</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {levels.length === 0
                  ? <div style={{ fontSize: 12, color: "#94a3b8" }}>No levels added yet.</div>
                  : levels.map(l => (
                    <div key={l} style={S.pill}>
                      <span style={S.badge()}>{l}</span>
                      <button style={S.pillX} onClick={() => handleRemoveLevel(l)}>×</button>
                    </div>
                  ))}
              </div>
            </div>
          </div>
          <div style={{ ...S.card, background: "#f8fafc", border: "1px solid #e2e8f0", padding: "16px 24px" }}>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.8 }}>
              <strong style={{ color: "#2563eb" }}>Note:</strong> Removing a track or level does not delete student records already uploaded under them.
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Modal ── */}
      {deleteModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "32px 36px", maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 18, color: "#0f172a", marginBottom: 4 }}>Delete Records</div>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20 }}>This cannot be undone.</div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 18px", marginBottom: 24, fontSize: 13, color: "#475569", lineHeight: 1.7 }}>
              <strong>{filtered.length}</strong> records will be deleted
              {filterTrack !== "All" && <> for track <strong>{filterTrack}</strong></>}
              {filterLevel !== "All" && <> · level <strong>{filterLevel}</strong></>}
              {filterTrack === "All" && filterLevel === "All" && " (all records)"}
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={() => setDeleteModal(null)} style={{ ...S.btn("secondary"), padding: "10px 20px" }}>Cancel</button>
              <button disabled={deleting} onClick={handleDelete}
                style={{ ...S.btn("danger"), padding: "10px 20px", background: "#fee2e2", fontWeight: 700, opacity: deleting ? 0.5 : 1 }}>
                {deleting ? "Deleting…" : `Delete ${filtered.length} records`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
