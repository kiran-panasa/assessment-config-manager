import { useState, useEffect, useCallback } from "react";
import {
  getAssessments, createAssessment, updateAssessment, deleteAssessment,
  getConfig, addSkill, removeSkill, addLevel, removeLevel,
  createLog,
} from "./api/firestore";

const DEFAULT_SKILLS = [
  "Applied Gen AI Development", "Computational Thinking",
  "Critical Thinking & Communication", "CS Fundamentals",
  "Quantitative Reasoning", "Server-Side Engineering",
  "SQL", "UI Engineering", "DS & ML",
];
const DEFAULT_LEVELS = ["L1", "L2", "L3"];

export default function AssessmentsPage({ S, showToast }) {
  const [assessments, setAssessments] = useState([]);
  const [skills, setSkills]           = useState(DEFAULT_SKILLS);
  const [levels, setLevels]           = useState(DEFAULT_LEVELS);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState("entry");
  const [selSkill, setSelSkill]       = useState("");
  const [selLevel, setSelLevel]       = useState("");
  const [configUrl, setConfigUrl]     = useState("");
  const [selDuration, setSelDuration] = useState("");
  const [editId, setEditId]           = useState(null);
  const [newSkill, setNewSkill]       = useState("");
  const [newLevel, setNewLevel]       = useState("");
  const [filterSkill, setFilterSkill] = useState("All");
  const [filterLevel, setFilterLevel] = useState("All");

  const loadData = useCallback(async () => {
    try {
      const [assessmentsData, configData] = await Promise.all([getAssessments(), getConfig()]);
      setAssessments(assessmentsData || []);
      if (configData.skills?.length) setSkills(configData.skills);
      if (configData.levels?.length) setLevels(configData.levels);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const isValidUrl = (url) => { try { new URL(url); return true; } catch { return false; } };

  const handleSave = async () => {
    if (!selSkill||!selLevel||!configUrl.trim()) { showToast("Fill in all fields.", "error"); return; }
    if (!isValidUrl(configUrl.trim())) { showToast("Enter a valid URL.", "error"); return; }
    const duplicate = assessments.find(a=>a.skill===selSkill&&a.level===selLevel&&a.id!==editId);
    if (duplicate) { showToast(`${selSkill} - ${selLevel} already exists.`, "error"); return; }
    try {
      if (editId) {
        const updated = { skill: selSkill, level: selLevel, url: configUrl.trim(), duration: selDuration };
        await updateAssessment(editId, updated);
        await createLog({ action: "updated", assessmentId: editId, skill: selSkill, level: selLevel });
        setAssessments(as => as.map(a => a.id === editId ? { ...a, ...updated } : a));
        showToast("Assessment updated.");
      } else {
        const newDoc = { skill: selSkill, level: selLevel, url: configUrl.trim(), duration: selDuration };
        const id = await createAssessment(newDoc);
        await createLog({ action: "created", assessmentId: id, skill: selSkill, level: selLevel });
        setAssessments(as => [...as, { id, ...newDoc }]);
        showToast("Assessment saved.");
      }
      setSelSkill(""); setSelLevel(""); setConfigUrl(""); setSelDuration(""); setEditId(null);
    } catch (err) { showToast(err.message, "error"); }
  };

  const handleEdit   = (a) => { setSelSkill(a.skill); setSelLevel(a.level); setConfigUrl(a.url); setSelDuration(a.duration?String(a.duration):""); setEditId(a.id); setTab("entry"); };
  const handleDelete = async (id) => {
    const a = assessments.find(x => x.id === id);
    try {
      await deleteAssessment(id);
      await createLog({ action: "deleted", assessmentId: id, skill: a?.skill });
      setAssessments(as => as.filter(x => x.id !== id));
      showToast("Deleted.");
    } catch (err) { showToast(err.message, "error"); }
  };

  const handleAddSkill = async () => {
    const s = newSkill.trim();
    if (!s || skills.includes(s)) { showToast("Skill already exists or empty.", "error"); return; }
    try {
      await addSkill(s);
      await createLog({ action: "skill_added", skill: s });
      setSkills(sk => [...sk, s]);
      setNewSkill(""); showToast("Skill added.");
    } catch (err) { showToast(err.message, "error"); }
  };
  const handleRemoveSkill = async (s) => {
    try {
      await removeSkill(s);
      await createLog({ action: "skill_removed", skill: s });
      setSkills(sk => sk.filter(x => x !== s));
      showToast("Skill removed.");
    } catch (err) { showToast(err.message, "error"); }
  };
  const handleAddLevel = async () => {
    const l = newLevel.trim().toUpperCase();
    if (!l || levels.includes(l)) { showToast("Level exists or empty.", "error"); return; }
    try {
      await addLevel(l);
      await createLog({ action: "level_added", level: l });
      setLevels(lv => [...lv, l]);
      setNewLevel(""); showToast("Level added.");
    } catch (err) { showToast(err.message, "error"); }
  };
  const handleRemoveLevel = async (l) => {
    try {
      await removeLevel(l);
      await createLog({ action: "level_removed", level: l });
      setLevels(lv => lv.filter(x => x !== l));
      showToast("Level removed.");
    } catch (err) { showToast(err.message, "error"); }
  };

  const filtered = assessments.filter(a=>(filterSkill==="All"||a.skill===filterSkill)&&(filterLevel==="All"||a.level===filterLevel));

  if (loading) return <div style={{ padding:"80px 48px",color:"#94a3b8",fontFamily:"'Inter',sans-serif",fontSize:14 }}>Loading…</div>;

  return (
    <>
      <div style={S.header}>
        <span style={S.headerTitle}>Assessment Configurations</span>
        <nav style={S.nav}>{[["entry","Add / Edit"],["manage","All Assessments"],["settings","Skills & Levels"]].map(([key,label])=>(<button key={key} style={S.navItem(tab===key)} onClick={()=>setTab(key)}>{label}</button>))}</nav>
        <div style={{ marginLeft:"auto",paddingBottom:18,paddingTop:18,fontSize:12,color:"#94a3b8" }}>{assessments.length} assessment{assessments.length!==1?"s":""}</div>
      </div>
      <div style={S.body}>
        {tab==="entry" && <AssessmentEntryTab
          assessments={assessments} skills={skills} levels={levels}
          selSkill={selSkill} selLevel={selLevel} configUrl={configUrl}
          selDuration={selDuration} editId={editId}
          setSelSkill={setSelSkill} setSelLevel={setSelLevel}
          setConfigUrl={setConfigUrl} setSelDuration={setSelDuration}
          setEditId={setEditId}
          handleSave={handleSave} handleEdit={handleEdit}
          S={S}
        />}
        {tab==="manage"&&(<div style={{ animation:"fadeIn 0.2s ease" }}>
          <div style={S.sectionTitle}>All Assessments</div><div style={S.sectionSub}>View, filter, edit or delete stored assessment configs.</div>
          <div style={{ display:"flex",gap:16,marginBottom:24 }}>
            <div style={{ flex:1 }}><label style={S.label}>Filter by Skill</label><select style={S.select} value={filterSkill} onChange={e=>setFilterSkill(e.target.value)}><option value="All">All Skills</option>{skills.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div style={{ width:160 }}><label style={S.label}>Filter by Level</label><select style={S.select} value={filterLevel} onChange={e=>setFilterLevel(e.target.value)}><option value="All">All Levels</option>{levels.map(l=><option key={l} value={l}>{l}</option>)}</select></div>
          </div>
          <div style={S.card}>{filtered.length===0?(<div style={{ textAlign:"center",color:"#555a7a",padding:"40px 0",fontSize:13 }}>No assessments found.</div>):(<table style={S.table}><thead><tr><th style={S.th}>Skill</th><th style={S.th}>Level</th><th style={S.th}>Duration</th><th style={S.th}>Config URL</th><th style={S.th}></th></tr></thead><tbody>{filtered.map(a=>(<tr key={a.id} onMouseEnter={e=>e.currentTarget.style.background="#f8fafc"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}><td style={S.td}>{a.skill}</td><td style={S.td}><span style={S.badge()}>{a.level}</span></td><td style={{ ...S.td,color:"#94a3b8" }}>{a.duration?`${a.duration} min`:"—"}</td><td style={{ ...S.td,maxWidth:300 }}><a href={a.url} target="_blank" rel="noreferrer" style={{ color:"#3b82f6",textDecoration:"none",fontSize:12,wordBreak:"break-all" }}>{a.url.length>50?a.url.slice(0,50)+"…":a.url}</a></td><td style={{ ...S.td,whiteSpace:"nowrap" }}><div style={{ display:"flex",gap:8 }}><button style={{ ...S.btn("secondary"),padding:"6px 14px",fontSize:12 }} onClick={()=>handleEdit(a)}>Edit</button><button style={{ ...S.btn("danger"),padding:"6px 14px",fontSize:12 }} onClick={()=>handleDelete(a.id)}>Del</button></div></td></tr>))}</tbody></table>)}</div>
        </div>)}
        {tab==="settings"&&(<div style={{ animation:"fadeIn 0.2s ease" }}>
          <div style={S.sectionTitle}>Skills & Levels</div><div style={S.sectionSub}>Add or remove skills and difficulty levels.</div>
          <div style={S.grid2}>
            <div style={S.card}><div style={{ fontFamily:"'Inter',sans-serif",fontWeight:700,fontSize:15,color:"#0f172a",marginBottom:20 }}>Skills</div><div style={{ display:"flex",gap:10,marginBottom:20 }}><input style={{ ...S.input,flex:1 }} placeholder="New skill name…" value={newSkill} onChange={e=>setNewSkill(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddSkill()} /><button style={{ ...S.btn("primary"),whiteSpace:"nowrap" }} onClick={handleAddSkill}>Add</button></div><div style={{ display:"flex",flexWrap:"wrap" }}>{skills.map(s=><div key={s} style={S.pill}>{s}<button style={S.pillX} onClick={()=>handleRemoveSkill(s)}>×</button></div>)}</div></div>
            <div style={S.card}><div style={{ fontFamily:"'Inter',sans-serif",fontWeight:700,fontSize:15,color:"#0f172a",marginBottom:20 }}>Levels</div><div style={{ display:"flex",gap:10,marginBottom:20 }}><input style={{ ...S.input,flex:1 }} placeholder="e.g. L3…" value={newLevel} onChange={e=>setNewLevel(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddLevel()} /><button style={{ ...S.btn("primary"),whiteSpace:"nowrap" }} onClick={handleAddLevel}>Add</button></div><div style={{ display:"flex",flexWrap:"wrap" }}>{levels.map(l=><div key={l} style={S.pill}><span style={S.badge()}>{l}</span><button style={S.pillX} onClick={()=>handleRemoveLevel(l)}>×</button></div>)}</div></div>
          </div>
          <div style={{ ...S.card,background:"#f8fafc",border:"1px solid #e2e8f0",padding:"20px 24px" }}><div style={{ fontSize:12,color:"#64748b",lineHeight:1.8 }}><strong style={{ color:"#2563eb" }}>Note:</strong> Removing a skill or level does not delete assessments already stored under them.</div></div>
        </div>)}
      </div>
    </>
  );
}

// Extracted from the IIFE-in-JSX pattern — now a proper named component
function AssessmentEntryTab({ assessments, skills, levels, selSkill, selLevel, configUrl, selDuration, editId, setSelSkill, setSelLevel, setConfigUrl, setSelDuration, setEditId, handleSave, handleEdit, S }) {
  const takenCombos = assessments.filter(a=>a.id!==editId).map(a=>`${a.skill}::${a.level}`);
  const takenSet = new Set(takenCombos);
  const skillFullyTaken = (s) => levels.every(l => takenSet.has(`${s}::${l}`));
  const levelTaken = (l) => selSkill && takenSet.has(`${selSkill}::${l}`);

  return (
    <div style={{ animation:"fadeIn 0.2s ease" }}>
      <div style={S.sectionTitle}>{editId?"Edit Assessment":"Add Assessment"}</div>
      <div style={S.sectionSub}>Select skill and level, paste the config URL, and set the assessment duration.</div>
      <div style={S.card}>
        <div style={S.grid2}>
          <div><label style={S.label}>Skill</label><select style={S.select} value={selSkill} onChange={e=>{ setSelSkill(e.target.value); setSelLevel(""); }}><option value="">— Select skill —</option>{skills.map(s=>{ const t=skillFullyTaken(s); return <option key={s} value={s} disabled={t}>{s}{t?" (all levels filled)":""}</option>; })}</select></div>
          <div><label style={S.label}>Level</label><select style={S.select} value={selLevel} onChange={e=>setSelLevel(e.target.value)} disabled={!selSkill}><option value="">{selSkill?"— Select level —":"— Pick a skill first —"}</option>{levels.map(l=>{ const t=levelTaken(l); return <option key={l} value={l} disabled={t}>{l}{t?" (filled)":""}</option>; })}</select></div>
        </div>
        {selSkill&&(<div style={{ marginTop:12,display:"flex",gap:8,flexWrap:"wrap" }}>{levels.map(l=>{ const t=takenSet.has(`${selSkill}::${l}`); return (<span key={l} style={{ fontSize:11,fontFamily:"'Inter',sans-serif",fontWeight:700,padding:"3px 10px",borderRadius:4,background:t?"#fee2e2":"#dcfce7",color:t?"#dc2626":"#059669" }}>{l} {t?"✕ filled":"✓ open"}</span>); })}</div>)}
        <div style={{ marginTop:20 }}><label style={S.label}>Config URL</label><input style={S.input} type="url" placeholder="https://config.topin.tech/view-assessment/…" value={configUrl} onChange={e=>setConfigUrl(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSave()} /></div>
        <div style={{ marginTop:16 }}><label style={S.label}>Assessment Duration (minutes)</label><input style={{ ...S.input,maxWidth:220 }} type="number" min="0" placeholder="e.g. 60" value={selDuration} onChange={e=>setSelDuration(e.target.value)} /><div style={{ marginTop:6,fontSize:11,color:"#94a3b8" }}>Used to compute End Time. Leave blank to treat as 0.</div></div>
        <div style={{ marginTop:24,display:"flex",gap:12 }}><button style={S.btn("primary")} onClick={handleSave}>{editId?"Update":"Save Assessment"}</button>{editId&&<button style={S.btn("secondary")} onClick={()=>{ setEditId(null); setSelSkill(""); setSelLevel(""); setConfigUrl(""); setSelDuration(""); }}>Cancel Edit</button>}</div>
      </div>
      {assessments.length>0&&(<div style={S.card}><div style={{ fontFamily:"'Inter',sans-serif",fontWeight:700,fontSize:13,color:"#94a3b8",marginBottom:16,letterSpacing:"0.08em",textTransform:"uppercase" }}>Recent Entries</div><table style={S.table}><thead><tr><th style={S.th}>Skill</th><th style={S.th}>Level</th><th style={S.th}>Duration</th><th style={S.th}>URL</th><th style={S.th}></th></tr></thead><tbody>{[...assessments].reverse().slice(0,5).map(a=>(<tr key={a.id}><td style={S.td}>{a.skill}</td><td style={S.td}><span style={S.badge()}>{a.level}</span></td><td style={{ ...S.td,color:"#94a3b8" }}>{a.duration?`${a.duration} min`:"—"}</td><td style={{ ...S.td,maxWidth:280 }}><a href={a.url} target="_blank" rel="noreferrer" style={{ color:"#00c896",textDecoration:"none",fontSize:12 }}>{a.url.slice(0,48)}…</a></td><td style={S.td}><button style={{ ...S.btn("secondary"),padding:"6px 14px",fontSize:12 }} onClick={()=>handleEdit(a)}>Edit</button></td></tr>))}</tbody></table></div>)}
    </div>
  );
}
