import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { api } from "./api/client";
import {
  getAssessments,
  bulkSaveBookings, deleteBooking, bulkDeleteBookings,
  updateSession, deleteSession, bulkDeleteSessions,
  createLog,
} from "./api/firestore";
import { useData } from "./DataContext";
import { parseCSVLine, downloadCSV, parseSessionSkillLevel } from "./utils/csv";
import Pagination from "./components/Pagination";

// ── Constants ─────────────────────────────────────────────────────────────────

const PIN_CHARS = "ACDEFGHJKLMNPQRTUVWXYZ23456789";
const PAGE_SIZE = 20;

const T1_COLS = [
  ["Booking ID","bookingId"],["Student Name","studentName"],["NIAT ID","niatId"],
  ["Skill","skill"],["Level","skillLevel"],["Contest Date","contestDate"],
  ["Time Slot","timeSlot"],["Campus","campus"],["Slot Centre","slotCentre"],
  ["Batch","batch"],["Section","section"],["Attendance","attendance"],
  ["Status","status"],["Student UID","studentUid"],["Booked At","bookedAt"],
  ["Contest Link","contestLink"],["Classroom Details","classroomDetails"],
];
const T2_COLS = ["Assessment Title","Date","Start Time","End Time","Unique Exam ID","Students","EXIT PIN","Topin ID","Publish Status","Config Link","User Assessment Link","Details Link"];
const T3_COLS = ["Student Name","NIAT ID","Student UID","Skill","Level","Contest Date","Time Slot","Campus","Unique Exam ID","Invite"];

const T1_FILTER_INIT = { skill:"All",skillLevel:"All",timeSlot:"All",campus:"All",batch:"All",inviteStatus:"All" };
const T2_FILTER_INIT = { skill:"All",level:"All",startTimeSlot:"All",publishStatus:"All" };

// ── Booking helpers ───────────────────────────────────────────────────────────

function genPin() { let p = ""; for (let i=0;i<6;i++) p += PIN_CHARS[Math.floor(Math.random()*PIN_CHARS.length)]; return p; }

function timeToMins(t) {
  if (!t) return 0; const s = t.trim();
  const ap = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ap) { let h=parseInt(ap[1]),m=parseInt(ap[2]); const p=ap[3].toUpperCase(); if(p==="PM"&&h!==12) h+=12; if(p==="AM"&&h===12) h=0; return h*60+m; }
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/); if (h24) return parseInt(h24[1])*60+parseInt(h24[2]); return 0;
}
function minsToTime(m) { const h=Math.floor(m/60)%24,mm=m%60,p=h>=12?"PM":"AM",h12=h%12||12; return `${h12}:${String(mm).padStart(2,"0")} ${p}`; }
function minsToHHMM(m) { const h=Math.floor(m/60)%24,mm=m%60; return `${String(h).padStart(2,"0")}${String(mm).padStart(2,"0")}`; }

function toISODate(d) {
  if (!d) return "";
  const dm = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (dm) return `${dm[3]}-${dm[2].padStart(2,"0")}-${dm[1].padStart(2,"0")}`;
  const im = d.match(/^(\d{4})-(\d{2})-(\d{2})/); if (im) return `${im[1]}-${im[2]}-${im[3]}`;
  const dt = new Date(d); return isNaN(dt) ? d : dt.toISOString().slice(0,10);
}

function buildSessionKey(skill,level,date,timeSlot) { return `${skill}||${level}||${toISODate(date)}||${minsToHHMM(timeToMins(timeSlot))}`; }
function buildExamId(skill,level,date,timeSlot) { return `NG26_NIAT_GRIT_${skill.toUpperCase()}_L${level}_${toISODate(date)}_${minsToHHMM(timeToMins(timeSlot))}`; }

function processBookingRows(rows, existingBids, existingSessions, assessments, bufMins) {
  const existingSet = new Set(existingBids);
  const dupRows = rows.filter(r => existingSet.has(r.bookingId));
  const newRows = rows.filter(r => !existingSet.has(r.bookingId));
  const existingSessionMap = new Map();
  existingSessions.forEach(s => { if (s.sessionKey) existingSessionMap.set(s.sessionKey, s); });
  const pinMap = new Map();
  existingSessions.forEach(s => {
    if (s.exitPin && s.dateOfAssessment && s.startTimeSlot) {
      const pk = `${s.dateOfAssessment}||${minsToHHMM(timeToMins(s.startTimeSlot))}`;
      if (!pinMap.has(pk)) pinMap.set(pk, s.exitPin);
    }
  });
  const seenKeys = new Set(); const newSessions=[], reusedSessions=[], warnSessions=[];
  rows.forEach(row => {
    const key = row.sessionKey; if (seenKeys.has(key)) return; seenKeys.add(key);
    if (existingSessionMap.has(key)) { reusedSessions.push(existingSessionMap.get(key)); return; }
    const match = assessments.find(a => a.skill===row.skill && a.level===`L${row.skillLevel}`);
    const duration = parseInt(match?.duration)||0; const hasMissingConfig = !match||!match.duration;
    const startMins = timeToMins(row.timeSlot);
    const pinKey = `${toISODate(row.contestDate)}||${minsToHHMM(startMins)}`;
    if (!pinMap.has(pinKey)) pinMap.set(pinKey, genPin());
    const session = {
      assessmentTitle: `${row.skill} - L${row.skillLevel}`,
      dateOfAssessment: row.contestDate, startTimeSlot: minsToTime(startMins),
      endTimeSlot: minsToTime(startMins+duration+bufMins),
      uniqueExamId: buildExamId(row.skill,row.skillLevel,row.contestDate,row.timeSlot),
      exitPin: pinMap.get(pinKey), skill: row.skill, level: row.skillLevel, sessionKey: key, hasMissingConfig,
    };
    newSessions.push(session); if (hasMissingConfig) warnSessions.push(session);
  });
  return { rows, newRows, dupRows, newSessions, reusedSessions, warnSessions };
}

function mapDbRow(r) {
  const lc = {}; Object.entries(r).forEach(([k,v]) => { lc[k.toLowerCase().replace(/_/g,"")] = String(v??"").trim(); });
  const g = (...keys) => { for (const k of keys) { const v=lc[k.replace(/[\s_]/g,"").toLowerCase()]; if (v!==undefined&&v!=="") return v; } return ""; };
  const skill=g("skill"),skillLevel=g("skilllevel","skill level","level"),contestDate=toISODate(g("contestdate","contest date","date")),timeSlot=g("timeslot","time slot","slot");
  return { bookingId:g("bookingid","booking id","id"),studentUid:g("studentuid","student uid","uid","userid","user id"),studentName:g("studentname","student name","name"),niatId:g("niatid","niat id","niat"),campus:g("campus"),slotCentre:g("slotcentre","slot centre","slotcenter","slot center","centre","center"),batch:g("batch"),section:g("section"),contestDate,timeSlot,skill,skillLevel,contestLink:g("contestlink","contest link","link"),classroomDetails:g("classroomdetails","classroom details","classroom"),bookedAt:g("bookedat","booked at","registeredat","registered at","createdat","created at"),attendance:g("attendance"),status:g("status"),sessionKey:buildSessionKey(skill,skillLevel,contestDate,timeSlot) };
}

function parseBookingCSV(text, existingBids, existingSessions, assessments, bufMins) {
  const lines = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim().split("\n");
  if (lines.length < 2) return { error: "CSV file is empty." };
  const rawHeaders = parseCSVLine(lines[0]); const hIdx = {};
  rawHeaders.forEach((h,i) => { hIdx[h.toLowerCase().trim()] = i; });
  const REQUIRED = ["booking id","skill","skill level","contest date","time slot"];
  const missing = REQUIRED.filter(c => hIdx[c]===undefined);
  if (missing.length) return { error: `Missing required columns: ${missing.join(", ")}` };
  const get = (vals,key) => (vals[hIdx[key.toLowerCase()]]??"").trim();
  const rows = [];
  for (let i=1;i<lines.length;i++) {
    if (!lines[i].trim()) continue;
    const vals=parseCSVLine(lines[i]),skill=get(vals,"skill"),skillLevel=get(vals,"skill level"),contestDate=toISODate(get(vals,"contest date")),timeSlot=get(vals,"time slot");
    rows.push({ bookingId:get(vals,"booking id"),studentUid:get(vals,"student uid"),studentName:get(vals,"student name"),niatId:get(vals,"niat id"),campus:get(vals,"campus"),slotCentre:get(vals,"slot centre"),batch:get(vals,"batch"),section:get(vals,"section"),contestDate,timeSlot,skill,skillLevel,contestLink:get(vals,"contest link"),classroomDetails:get(vals,"classroom details"),bookedAt:get(vals,"booked at"),attendance:get(vals,"attendance"),status:get(vals,"status"),sessionKey:buildSessionKey(skill,skillLevel,contestDate,timeSlot) });
  }
  if (rows.length===0) return { error: "No data rows found in CSV." };
  return processBookingRows(rows,existingBids,existingSessions,assessments,bufMins);
}

// ── StudentBookings component ─────────────────────────────────────────────────

export default function StudentBookings({ S, showToast }) {
  const [bookTab, setBookTab]       = useState("upload");
  const [bufferTime, setBufferTime] = useState("30");
  const [csvData, setCsvData]       = useState(null);
  const [dupChoice, setDupChoice]   = useState(null);
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef(null);
  const [dbDate, setDbDate]         = useState("");
  const [dbFetching, setDbFetching] = useState(false);
  const [dbFetchResult, setDbFetchResult] = useState(null);

  const { bookingRows, examSessions, setBookingRows, setExamSessions, dataLoading, refreshData, selectedDate, loadForDate } = useData();

  const [assessments, setAssessments] = useState([]);
  const [loading, setLoading] = useState(true);

  const [t1Filters, setT1Filters] = useState(T1_FILTER_INIT);
  const [t2Filters, setT2Filters] = useState(T2_FILTER_INIT);
  const [t3Date, setT3Date]       = useState("All");
  const [t1Page, setT1Page]       = useState(1);
  const [t2Page, setT2Page]       = useState(1);
  const [t3Page, setT3Page]       = useState(1);
  const [deleteModal, setDeleteModal] = useState(null);
  const [deleting, setDeleting]   = useState(false);
  const [markModal, setMarkModal] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const assessmentsData = await getAssessments();
      setAssessments(assessmentsData || []);
    } catch (err) { showToast(err.message, "error"); }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDateChange = useCallback((date) => {
    loadForDate(date);
    setT1Filters(T1_FILTER_INIT); setT2Filters(T2_FILTER_INIT);
    setT1Page(1); setT2Page(1); setT3Page(1);
  }, [loadForDate]);

  const existingBids = useMemo(() => bookingRows.map(r=>r.bookingId), [bookingRows]);
  const existingDocIdMap = useMemo(() => { const m=new Map(); bookingRows.forEach(r=>m.set(r.bookingId,r.id)); return m; }, [bookingRows]);
  const sessionMap = useMemo(() => { const m=new Map(); examSessions.forEach(s=>{ if(s.sessionKey) m.set(s.sessionKey,s); }); return m; }, [examSessions]);
  const userMapping = useMemo(()=>bookingRows.map(row=>{ const s=row.sessionKey?sessionMap.get(row.sessionKey):null; return {...row,uniqueExamId:s?.uniqueExamId??"—",mapped:!!s}; }),[bookingRows,sessionMap]);
  const sessionStudentCount = useMemo(()=>{ const m=new Map(); bookingRows.forEach(r=>{ if(r.sessionKey) m.set(r.sessionKey,(m.get(r.sessionKey)||0)+1); }); return m; },[bookingRows]);

  const t1Opts = useMemo(()=>({ skill:[...new Set(bookingRows.map(r=>r.skill))].filter(Boolean).sort(),skillLevel:[...new Set(bookingRows.map(r=>r.skillLevel))].filter(Boolean).sort(),timeSlot:[...new Set(bookingRows.map(r=>r.timeSlot))].filter(Boolean).sort(),campus:[...new Set(bookingRows.map(r=>r.campus))].filter(Boolean).sort(),batch:[...new Set(bookingRows.map(r=>r.batch))].filter(Boolean).sort() }),[bookingRows]);
  const t2Opts = useMemo(()=>{ const skills=new Set(),levels=new Set(),times=new Set(); examSessions.forEach(s=>{ const{skill,level}=parseSessionSkillLevel(s.assessmentTitle); if(skill)skills.add(skill); if(level)levels.add(level); if(s.startTimeSlot)times.add(s.startTimeSlot); }); return{skill:[...skills].sort(),level:[...levels].sort(),startTimeSlot:[...times].sort()}; },[examSessions]);

  const t1Filtered = useMemo(()=>bookingRows.filter(r=>{ const f=t1Filters; if(f.skill!=="All"&&r.skill!==f.skill)return false; if(f.skillLevel!=="All"&&r.skillLevel!==f.skillLevel)return false; if(f.timeSlot!=="All"&&r.timeSlot!==f.timeSlot)return false; if(f.campus!=="All"&&r.campus!==f.campus)return false; if(f.batch!=="All"&&r.batch!==f.batch)return false; if(f.inviteStatus!=="All"){ const st=r.inviteStatus||"not_sent"; if(st!==f.inviteStatus)return false; } return true; }),[bookingRows,t1Filters]);
  const t2Filtered = useMemo(()=>examSessions.filter(s=>{ const f=t2Filters; const{skill,level}=parseSessionSkillLevel(s.assessmentTitle); if(f.skill!=="All"&&skill!==f.skill)return false; if(f.level!=="All"&&level!==f.level)return false; if(f.startTimeSlot!=="All"&&s.startTimeSlot!==f.startTimeSlot)return false; if(f.publishStatus!=="All"){ const st=s.publishStatus||"pending"; if(st!==f.publishStatus)return false; } return true; }),[examSessions,t2Filters]);
  const t3Dates = useMemo(()=>[...new Set(userMapping.map(r=>r.contestDate))].filter(Boolean).sort(),[userMapping]);
  const t3Filtered = t3Date==="All"?userMapping:userMapping.filter(r=>r.contestDate===t3Date);
  const t1AnyActive = Object.values(t1Filters).some(v=>v!=="All");
  const t2AnyActive = Object.values(t2Filters).some(v=>v!=="All");
  const rowsToSave = useMemo(()=>csvData?(dupChoice==="overwrite"?csvData.rows:csvData.newRows):[],[csvData,dupChoice]);

  const processFile = async (file, buf) => {
    if (!file) { setCsvData(null); setDupChoice(null); return; }
    if (!file.name.toLowerCase().endsWith(".csv")) { showToast("Only .csv files accepted.", "error"); return; }
    const text = await file.text();
    const result = parseBookingCSV(text, existingBids, examSessions, assessments, buf);
    if (result.error) { showToast(result.error, "error"); setCsvData(null); return; }
    setCsvData(result); setDupChoice(result.dupRows.length===0?"skip":null);
  };

  const handleFetchFromDB = async () => {
    if (!dbDate) { showToast("Select a date first.", "error"); return; }
    setDbFetching(true); setCsvData(null); setDupChoice(null); setDbFetchResult(null);
    if (fileRef.current) fileRef.current.value="";
    try {
      const data = await api.get(`/api/bookings/fetch-db?date=${dbDate}`);
      if (!data.rows?.length) { showToast(`No bookings found for ${dbDate}.`, "error"); return; }
      const rows = data.rows.map(mapDbRow);
      const result = processBookingRows(rows, existingBids, examSessions, assessments, parseInt(bufferTime)||0);
      setCsvData({ ...result, source:"db", dbDate }); setDupChoice(result.dupRows.length===0?"skip":null);
      setDbFetchResult({ count: data.count, date: dbDate, rows });
    } catch (err) { showToast(err.message, "error"); }
    setDbFetching(false);
  };

  const handleFile = (e) => { const file=e.target.files[0]; processFile(file, parseInt(bufferTime)||0); };
  const handleBufferChange = (val) => { setBufferTime(val); if (fileRef.current?.files[0]) processFile(fileRef.current.files[0], parseInt(val)||0); };

  const handleSave = async () => {
    if (!csvData||!dupChoice||processing) return;
    setProcessing(true);
    const batchId = Date.now().toString();
    try {
      const bookingOps = rowsToSave.map(row => {
        const existId = existingDocIdMap.get(row.bookingId);
        if (existId && dupChoice==="overwrite") return { type:"update", id:existId, data:row };
        if (!existId) return { type:"set", data:row };
        return null;
      }).filter(Boolean);
      await bulkSaveBookings(bookingOps, csvData.newSessions, batchId);
      await createLog({ action: "csv_upload", batchId, bookings: rowsToSave.length, sessions: csvData.newSessions.length });
      showToast(`Saved: ${rowsToSave.length} bookings, ${csvData.newSessions.length} new sessions.`);
      setCsvData(null); setDupChoice(null); if (fileRef.current) fileRef.current.value="";
      setBookTab("bookings");
      await refreshData();
    } catch (err) { showToast(err.message, "error"); }
    setProcessing(false);
  };

  const handleDeleteBooking = async (id) => {
    try {
      await deleteBooking(id);
      await createLog({ action: "booking_deleted", id });
      showToast("Booking deleted.");
      setBookingRows(r => r.filter(x => x.id !== id));
    } catch (err) { showToast(err.message, "error"); }
  };

  const handleDeleteSession = async (id) => {
    try {
      await deleteSession(id);
      await createLog({ action: "session_deleted", id });
      showToast("Session deleted.");
      setExamSessions(s => s.filter(x => x.id !== id));
    } catch (err) { showToast(err.message, "error"); }
  };

  const handleMarkPublished = async () => {
    if (!markModal || !markModal.topinId.trim()) return;
    try {
      const updates = {
        topinAssessmentId: markModal.topinId.trim(), assessmentLink: markModal.link.trim() || null,
        publishStatus: "published", publishedAt: new Date().toISOString(), publishError: null,
      };
      await updateSession(markModal.session.id, updates);
      await createLog({ action: "manual_publish", sessionId: markModal.session.id });
      setExamSessions(ss => ss.map(s => s.id === markModal.session.id ? { ...s, ...updates } : s));
      showToast("Session marked as published."); setMarkModal(null);
    } catch (err) { showToast(err.message, "error"); }
  };

  const handleResetSession = async (id) => {
    if (!window.confirm("Reset to Pending?")) return;
    try {
      const updates = { publishStatus: "pending", topinAssessmentId: null, assessmentLink: null, publishError: null };
      await updateSession(id, updates);
      setExamSessions(ss => ss.map(s => s.id === id ? { ...s, ...updates } : s));
      showToast("Session reset.");
    } catch (err) { showToast(err.message, "error"); }
  };

  const openDeleteModal = (table) => {
    if (table==="bookings") { const toDelete=t1Filtered.filter(r=>r.inviteStatus!=="sent"),blocked=t1Filtered.filter(r=>r.inviteStatus==="sent").length; setDeleteModal({table:"bookings",tableName:"Slot Bookings",toDelete,blocked}); }
    else { const toDelete=t2Filtered.filter(s=>s.publishStatus!=="published"),blocked=t2Filtered.filter(s=>s.publishStatus==="published").length; setDeleteModal({table:"sessions",tableName:"Unique Assessments",toDelete,blocked}); }
  };

  const handleBulkDelete = async () => {
    if (!deleteModal||deleting) return; setDeleting(true);
    try {
      const ids = new Set(deleteModal.toDelete.map(r => r.id));
      if (deleteModal.table === "bookings") {
        await bulkDeleteBookings([...ids]);
        setBookingRows(r => r.filter(x => !ids.has(x.id)));
        setT1Filters(T1_FILTER_INIT); setT1Page(1);
      } else {
        await bulkDeleteSessions([...ids]);
        setExamSessions(s => s.filter(x => !ids.has(x.id)));
        setT2Filters(T2_FILTER_INIT); setT2Page(1);
      }
      await createLog({ action: "bulk_delete", table: deleteModal.table, count: ids.size });
      showToast(`Deleted ${ids.size} records.`); setDeleteModal(null);
    } catch (err) { showToast(err.message, "error"); }
    setDeleting(false);
  };

  const downloadBookingsCSV = () => {
    const headers = ["Booking ID","Student UID","Student Name","NIAT ID","Campus","Slot Centre","Batch","Section","Contest Date","Time Slot","Skill","Skill Level","Contest Link","Classroom Details","Booked At","Attendance","Status"];
    const fields  = ["bookingId","studentUid","studentName","niatId","campus","slotCentre","batch","section","contestDate","timeSlot","skill","skillLevel","contestLink","classroomDetails","bookedAt","attendance","status"];
    downloadCSV(t1Filtered.map(r => fields.map(f => r[f])), headers, `bookings${selectedDate?`-${selectedDate}`:""}.csv`);
  };

  if (loading || dataLoading) return <div style={{ padding:"80px 48px",color:"#94a3b8",fontFamily:"'Inter',sans-serif",fontSize:14 }}>Loading…</div>;

  return (
    <div style={{ animation:"fadeIn 0.2s ease" }}>
      <div style={S.header}>
        <span style={S.headerTitle}>Student Bookings</span>
        <nav style={S.nav}>
          {[["upload","Upload CSV"],["bookings","Slot Bookings"],["assessments","Unique Assessments"],["users","User Mapping"]].map(([key,label])=>(
            <button key={key} style={S.navItem(bookTab===key)} onClick={()=>setBookTab(key)}>{label}</button>
          ))}
        </nav>
        <div style={{ marginLeft:"auto",paddingBottom:18,paddingTop:18,display:"flex",alignItems:"center",gap:12 }}>
          <input type="date" style={{ ...S.input,width:160,padding:"5px 10px",fontSize:12 }} value={selectedDate} onChange={e=>handleDateChange(e.target.value)} />
          {selectedDate&&<span style={{ fontSize:12,color:"#94a3b8" }}>{bookingRows.length} bookings · {examSessions.length} sessions</span>}
          {selectedDate&&<button onClick={refreshData} style={{ ...S.btn("secondary"),padding:"4px 10px",fontSize:11 }}>Refresh</button>}
        </div>
      </div>

      <div style={S.body}>

        {bookTab==="upload" && (
          <>
            <div style={S.sectionTitle}>Add Bookings</div>
            <div style={S.sectionSub}>Generates Slot Bookings, Unique Assessments, and User Mapping.</div>
            <div style={S.card}>
              <div style={{ fontFamily:"'Inter',sans-serif",fontWeight:700,fontSize:14,color:"#0f172a",marginBottom:4 }}>Fetch from Replit DB</div>
              <div style={{ fontSize:12,color:"#64748b",marginBottom:16 }}>Pull bookings from the Replit Postgres database for a specific contest date.</div>
              <div style={{ display:"flex",gap:12,alignItems:"flex-end",flexWrap:"wrap" }}>
                <div>
                  <label style={S.label}>Contest Date</label>
                  <input type="date" style={{ ...S.input,width:200 }} value={dbDate} onChange={e=>{ setDbDate(e.target.value); setCsvData(null); setDupChoice(null); setDbFetchResult(null); }} />
                </div>
                <button disabled={!dbDate||dbFetching} onClick={handleFetchFromDB} style={{ ...S.btn("primary"),opacity:(!dbDate||dbFetching)?0.5:1 }}>{dbFetching?"Fetching…":"Fetch from DB"}</button>
                {dbFetchResult && <button onClick={()=>downloadCSV(dbFetchResult.rows.map(r=>["bookingId","studentUid","studentName","niatId","campus","slotCentre","batch","section","contestDate","timeSlot","skill","skillLevel","contestLink","classroomDetails","bookedAt","attendance","status"].map(f=>r[f])),["Booking ID","Student UID","Student Name","NIAT ID","Campus","Slot Centre","Batch","Section","Contest Date","Time Slot","Skill","Skill Level","Contest Link","Classroom Details","Booked At","Attendance","Status"],`bookings-db-${dbFetchResult.date}.csv`)} style={{ ...S.btn("secondary"),display:"flex",alignItems:"center",gap:6 }}>↓ Download CSV</button>}
              </div>
              {dbFetchResult && <div style={{ marginTop:12,padding:"10px 14px",background:"#f0fdf9",border:"1px solid #6ee7b7",borderRadius:8,fontSize:13,color:"#065f46",fontFamily:"'Inter',sans-serif" }}>✓ <strong>{dbFetchResult.count}</strong> bookings fetched for <strong>{dbFetchResult.date}</strong></div>}
            </div>

            <div style={{ display:"flex",alignItems:"center",gap:12,margin:"4px 0" }}>
              <div style={{ flex:1,height:1,background:"#e2e8f0" }} />
              <span style={{ fontSize:11,color:"#94a3b8",fontFamily:"'Inter',sans-serif",fontWeight:600,letterSpacing:"0.05em" }}>OR UPLOAD CSV</span>
              <div style={{ flex:1,height:1,background:"#e2e8f0" }} />
            </div>

            <div style={S.card}>
              <div style={S.grid2}>
                <div>
                  <label style={S.label}>Booking CSV File</label>
                  <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ ...S.input,cursor:"pointer",paddingTop:9 }} />
                </div>
                <div>
                  <label style={S.label}>Buffer Time (minutes)</label>
                  <input type="number" min="0" style={S.input} value={bufferTime} onChange={e=>handleBufferChange(e.target.value)} placeholder="e.g. 30" />
                </div>
              </div>

              {csvData&&csvData.dupRows.length>0&&(
                <div style={{ marginTop:24,padding:"16px 20px",background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:8 }}>
                  <div style={{ fontFamily:"'Inter',sans-serif",fontWeight:700,fontSize:13,color:"#d97706",marginBottom:8 }}>⚠ {csvData.dupRows.length} duplicate Booking ID{csvData.dupRows.length>1?"s":""} found</div>
                  <div style={{ fontSize:12,color:"#92400e",marginBottom:14 }}>How should they be handled?</div>
                  <div style={{ display:"flex",gap:10,flexWrap:"wrap" }}>
                    <button onClick={()=>setDupChoice("skip")} style={{ ...S.btn("secondary"),padding:"8px 16px",fontSize:12,border:`1px solid ${dupChoice==="skip"?"#00c896":"#e2e8f0"}`,color:dupChoice==="skip"?"#00c896":"#64748b" }}>Skip — save {csvData.newRows.length} new rows</button>
                    <button onClick={()=>setDupChoice("overwrite")} style={{ ...S.btn("secondary"),padding:"8px 16px",fontSize:12,border:`1px solid ${dupChoice==="overwrite"?"#d97706":"#e2e8f0"}`,color:dupChoice==="overwrite"?"#d97706":"#64748b" }}>Overwrite — save all {csvData.rows.length} rows</button>
                    <button onClick={()=>{ setCsvData(null); setDupChoice(null); if(fileRef.current)fileRef.current.value=""; }} style={{ ...S.btn("danger"),padding:"8px 16px",fontSize:12 }}>Cancel</button>
                  </div>
                </div>
              )}

              {csvData&&dupChoice&&(
                <div style={{ marginTop:24 }}>
                  <div style={{ fontFamily:"'Inter',sans-serif",fontWeight:700,fontSize:12,color:"#64748b",marginBottom:14,letterSpacing:"0.1em",textTransform:"uppercase" }}>Ready to save</div>
                  <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20 }}>
                    {[[rowsToSave.length,"Booking rows","#00c896"],[csvData.newSessions.length,"New exam sessions","#3b82f6"],[csvData.reusedSessions.length,"Sessions reused","#64748b"]].map(([val,lbl,color])=>(
                      <div key={lbl} style={{ background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"14px 18px" }}>
                        <div style={{ fontFamily:"'Inter',sans-serif",fontWeight:800,fontSize:22,color }}>{val}</div>
                        <div style={{ fontSize:11,color:"#64748b",marginTop:4 }}>{lbl}</div>
                      </div>
                    ))}
                  </div>
                  {csvData.warnSessions.length>0&&<div style={{ marginBottom:16,padding:"12px 16px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,fontSize:12,color:"#2563eb",lineHeight:1.7 }}>⚠ {csvData.warnSessions.length} session(s) have no matching Assessment Config.</div>}
                  <div style={{ display:"flex",gap:12 }}>
                    <button style={{ ...S.btn("primary"),opacity:(processing||rowsToSave.length===0)?0.5:1 }} onClick={handleSave} disabled={processing||rowsToSave.length===0}>{processing?"Saving…":"Save All"}</button>
                    <button style={S.btn("secondary")} onClick={()=>{ setCsvData(null); setDupChoice(null); if(fileRef.current)fileRef.current.value=""; }}>Discard</button>
                  </div>
                </div>
              )}
            </div>
            <div style={{ ...S.card,background:"#f8fafc",border:"1px solid #e2e8f0",padding:"20px 24px" }}>
              <div style={{ fontSize:12,color:"#64748b",lineHeight:1.9 }}>
                <strong style={{ color:"#2563eb" }}>Required columns:</strong> Booking ID, Skill, Skill Level, Contest Date, Time Slot
              </div>
            </div>
          </>
        )}

        {bookTab==="bookings"&&(
          <>
            <div style={{ marginBottom:20 }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:8 }}>
                <div><div style={S.sectionTitle}>Slot Bookings</div><div style={{ ...S.sectionSub,marginBottom:0 }}>All raw booking rows.</div></div>
              </div>
              <div style={{ display:"flex",flexWrap:"wrap",gap:10,alignItems:"flex-end" }}>
                {[{key:"skill",label:"Skill",opts:t1Opts.skill},{key:"skillLevel",label:"Level",opts:t1Opts.skillLevel},{key:"timeSlot",label:"Time Slot",opts:t1Opts.timeSlot},{key:"campus",label:"Campus",opts:t1Opts.campus},{key:"batch",label:"Batch",opts:t1Opts.batch},{key:"inviteStatus",label:"Invite",opts:["sent","failed","not_sent"],display:{sent:"Sent",failed:"Failed",not_sent:"Not Sent"}}].map(({key,label,opts,display})=>(
                  <div key={key}><div style={{ ...S.label,marginBottom:4 }}>{label}</div>
                  <select style={{ ...S.select,width:"auto",minWidth:110,padding:"7px 10px",fontSize:12 }} value={t1Filters[key]} onChange={e=>{ setT1Filters(f=>({...f,[key]:e.target.value})); setT1Page(1); }}>
                    <option value="All">All</option>{opts.map(v=><option key={v} value={v}>{display?display[v]:v}</option>)}
                  </select></div>
                ))}
                <div style={{ display:"flex",gap:8,alignItems:"flex-end",marginLeft:"auto" }}>
                  {t1AnyActive&&<button onClick={()=>{ setT1Filters(T1_FILTER_INIT); setT1Page(1); }} style={{ ...S.btn("secondary"),padding:"7px 14px",fontSize:12 }}>Reset</button>}
                  {t1AnyActive&&t1Filtered.length>0&&<button onClick={downloadBookingsCSV} style={{ ...S.btn("secondary"),padding:"7px 14px",fontSize:12 }}>Download CSV</button>}
                  <button disabled={!t1AnyActive} onClick={()=>openDeleteModal("bookings")} style={{ ...S.btn("danger"),padding:"7px 16px",fontSize:12,opacity:!t1AnyActive?0.35:1 }}>Delete {t1AnyActive?`${t1Filtered.filter(r=>r.inviteStatus!=="sent").length} records`:"…"}</button>
                </div>
              </div>
            </div>
            <div style={S.card}>
              {t1Filtered.length===0?(<div style={{ textAlign:"center",color:"#555a7a",padding:"60px 0",fontSize:13 }}><div style={{ marginBottom:10,fontFamily:"'Inter',sans-serif",fontWeight:700,fontSize:15,color:"#94a3b8" }}>{!selectedDate?"Select a date above to load data":bookingRows.length===0?"No bookings for this date":"No results for selected filters"}</div></div>):(
                <>
                  <div style={{ overflowX:"auto" }}>
                    <table style={S.table}><thead><tr>{T1_COLS.map(([h])=><th key={h} style={S.th}>{h}</th>)}<th style={S.th}></th></tr></thead>
                    <tbody>{t1Filtered.slice((t1Page-1)*PAGE_SIZE,t1Page*PAGE_SIZE).map(row=>(
                      <tr key={row.id} onMouseEnter={e=>e.currentTarget.style.background="#f8fafc"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        {T1_COLS.map(([,k])=>(<td key={k} style={{ ...S.td,whiteSpace:"nowrap",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis" }}>{k==="status"?<span style={S.badge(row[k]?.toLowerCase()==="active"?"#00c896":"#555a7a")}>{row[k]||"—"}</span>:k==="attendance"?<span style={S.badge(row[k]?.toLowerCase()==="present"?"#00c896":row[k]?"#f5a623":"#555a7a")}>{row[k]||"—"}</span>:k==="contestLink"&&row[k]?<a href={row[k]} target="_blank" rel="noreferrer" style={{ color:"#3b82f6",textDecoration:"none",fontSize:11 }}>Link ↗</a>:(row[k]||"—")}</td>))}
                        <td style={S.td}><button style={{ ...S.btn("danger"),padding:"5px 12px",fontSize:11 }} onClick={()=>handleDeleteBooking(row.id)}>Del</button></td>
                      </tr>
                    ))}</tbody></table>
                  </div>
                  <Pagination page={t1Page} total={t1Filtered.length} onPage={setT1Page} S={S} />
                </>
              )}
            </div>
          </>
        )}

        {bookTab==="assessments"&&(
          <>
            <div style={{ marginBottom:20 }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:8 }}>
                <div><div style={S.sectionTitle}>Unique Assessments</div><div style={{ ...S.sectionSub,marginBottom:0 }}>One row per unique exam slot.</div></div>
              </div>
              <div style={{ display:"flex",flexWrap:"wrap",gap:10,alignItems:"flex-end" }}>
                {[{key:"skill",label:"Skill",opts:t2Opts.skill},{key:"level",label:"Level",opts:t2Opts.level},{key:"startTimeSlot",label:"Time Slot",opts:t2Opts.startTimeSlot},{key:"publishStatus",label:"Status",opts:["pending","published","failed"],display:{pending:"Pending",published:"Published",failed:"Failed"}}].map(({key,label,opts,display})=>(
                  <div key={key}><div style={{ ...S.label,marginBottom:4 }}>{label}</div>
                  <select style={{ ...S.select,width:"auto",minWidth:110,padding:"7px 10px",fontSize:12 }} value={t2Filters[key]} onChange={e=>{ setT2Filters(f=>({...f,[key]:e.target.value})); setT2Page(1); }}>
                    <option value="All">All</option>{opts.map(v=><option key={v} value={v}>{display?display[v]:v}</option>)}
                  </select></div>
                ))}
                <div style={{ display:"flex",gap:8,alignItems:"flex-end",marginLeft:"auto" }}>
                  {t2AnyActive&&<button onClick={()=>{ setT2Filters(T2_FILTER_INIT); setT2Page(1); }} style={{ ...S.btn("secondary"),padding:"7px 14px",fontSize:12 }}>Reset</button>}
                  {t2Filtered.length>0&&<button style={{ ...S.btn("secondary"),padding:"7px 14px",fontSize:12 }} onClick={()=>downloadCSV(t2Filtered.map(s=>[s.assessmentTitle,s.dateOfAssessment,s.startTimeSlot,s.endTimeSlot,s.uniqueExamId,sessionStudentCount.get(s.sessionKey)??0,s.exitPin,s.topinAssessmentId??"",s.publishStatus??"pending",s.viewAssessmentUrl??"",s.assessmentLink??"",s.viewDetailsUrl??""]),["Assessment Title","Date","Start Time","End Time","Unique Exam ID","Students","EXIT PIN","Topin ID","Publish Status","Config Link","User Assessment Link","Details Link"],`unique-assessments${selectedDate?`-${selectedDate}`:""}.csv`)}>Download CSV</button>}
                  <button disabled={!t2AnyActive} onClick={()=>openDeleteModal("sessions")} style={{ ...S.btn("danger"),padding:"7px 16px",fontSize:12,opacity:!t2AnyActive?0.35:1 }}>Delete {t2AnyActive?`${t2Filtered.filter(s=>s.publishStatus!=="published").length} records`:"…"}</button>
                </div>
              </div>
            </div>
            <div style={S.card}>
              {t2Filtered.length===0?(<div style={{ textAlign:"center",color:"#555a7a",padding:"60px 0" }}><div style={{ fontFamily:"'Inter',sans-serif",fontWeight:700,fontSize:15,color:"#94a3b8",marginBottom:10 }}>{!selectedDate?"Select a date above to load data":examSessions.length===0?"No sessions for this date":"No results"}</div></div>):(
                <>
                  <div style={{ overflowX:"auto" }}>
                    <table style={S.table}><thead><tr>{T2_COLS.map(c=><th key={c} style={S.th}>{c}</th>)}<th style={S.th}></th></tr></thead>
                    <tbody>{t2Filtered.slice((t2Page-1)*PAGE_SIZE,t2Page*PAGE_SIZE).map(s=>(
                      <tr key={s.id} onMouseEnter={e=>e.currentTarget.style.background="#f8fafc"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <td style={S.td}>{s.assessmentTitle}{s.hasMissingConfig&&<span title="Duration unknown" style={{ marginLeft:6,fontSize:11,color:"#f5a623" }}>⚠</span>}</td>
                        <td style={{ ...S.td,whiteSpace:"nowrap" }}>{s.dateOfAssessment}</td>
                        <td style={{ ...S.td,whiteSpace:"nowrap" }}>{s.startTimeSlot}</td>
                        <td style={{ ...S.td,whiteSpace:"nowrap" }}>{s.endTimeSlot}</td>
                        <td style={{ ...S.td,fontSize:11,color:"#3b82f6",fontFamily:"'DM Mono',monospace" }}>{s.uniqueExamId}</td>
                        <td style={{ ...S.td,textAlign:"center",fontWeight:700,color:"#0f172a" }}>{sessionStudentCount.get(s.sessionKey)??0}</td>
                        <td style={S.td}><span style={{ ...S.badge("#ff9966"),fontFamily:"'DM Mono',monospace",letterSpacing:"0.2em",fontSize:13 }}>{s.exitPin}</span></td>
                        <td style={{ ...S.td,fontSize:11,color:"#3b82f6",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap" }}>{s.topinAssessmentId?s.topinAssessmentId.slice(0,8)+"…":"—"}</td>
                        <td style={S.td}>{s.publishStatus==="published"?<span style={S.badge("#00c896")}>Published</span>:s.publishStatus==="failed"?<span style={S.badge("#ff5555")}>Failed</span>:<span style={S.badge("#555a7a")}>Pending</span>}</td>
                        <td style={{ ...S.td,whiteSpace:"nowrap" }}>{s.viewAssessmentUrl?<a href={s.viewAssessmentUrl} target="_blank" rel="noreferrer" style={{ color:"#3b82f6",textDecoration:"none",fontSize:11,fontFamily:"'DM Mono',monospace" }}>Config ↗</a>:<span style={{ color:"#94a3b8",fontSize:12 }}>—</span>}</td>
                        <td style={{ ...S.td,whiteSpace:"nowrap" }}>{s.assessmentLink?<a href={s.assessmentLink} target="_blank" rel="noreferrer" style={{ color:"#3b82f6",textDecoration:"none",fontSize:11,fontFamily:"'DM Mono',monospace" }}>User Link ↗</a>:<span style={{ color:"#94a3b8",fontSize:12 }}>—</span>}</td>
                        <td style={{ ...S.td,whiteSpace:"nowrap" }}>{s.viewDetailsUrl?<a href={s.viewDetailsUrl} target="_blank" rel="noreferrer" style={{ color:"#3b82f6",textDecoration:"none",fontSize:11,fontFamily:"'DM Mono',monospace" }}>Details ↗</a>:<span style={{ color:"#94a3b8",fontSize:12 }}>—</span>}</td>
                        <td style={S.td}>
                          <div style={{ display:"flex",gap:6 }}>
                            {s.publishStatus!=="published"?<button onClick={()=>setMarkModal({session:s,topinId:s.topinAssessmentId||"",link:s.assessmentLink||""})} style={{ ...S.btn("secondary"),padding:"5px 10px",fontSize:11,border:"1px solid #3b82f6",color:"#3b82f6",whiteSpace:"nowrap" }}>Mark Published</button>:<button onClick={()=>handleResetSession(s.id)} style={{ ...S.btn("secondary"),padding:"5px 10px",fontSize:11,border:"1px solid #f5a623",color:"#f5a623",whiteSpace:"nowrap" }}>Reset</button>}
                            <button style={{ ...S.btn("danger"),padding:"5px 12px",fontSize:11 }} onClick={()=>handleDeleteSession(s.id)}>Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}</tbody></table>
                  </div>
                  <Pagination page={t2Page} total={t2Filtered.length} onPage={setT2Page} S={S} />
                </>
              )}
            </div>
          </>
        )}

        {bookTab==="users"&&(
          <>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12 }}>
              <div><div style={S.sectionTitle}>User Mapping</div><div style={{ ...S.sectionSub,marginBottom:0 }}>Each student mapped to their Unique Exam ID.</div></div>
              <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                  <span style={{ ...S.label,marginBottom:0,whiteSpace:"nowrap" }}>Filter by date</span>
                  <select style={{ ...S.select,width:170 }} value={t3Date} onChange={e=>{ setT3Date(e.target.value); setT3Page(1); }}>
                    <option value="All">All Dates</option>
                    {t3Dates.map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                {t3Filtered.length>0&&<button style={{ ...S.btn("secondary"),padding:"7px 14px",fontSize:12 }} onClick={()=>downloadCSV(t3Filtered.map(r=>[r.studentName,r.niatId,r.studentUid,r.skill,r.skillLevel,r.contestDate,r.timeSlot,r.campus??"",r.uniqueExamId,r.inviteStatus==="sent"?"Sent":r.inviteStatus==="failed"?"Failed":"Not Sent"]),["Student Name","NIAT ID","Student UID","Skill","Level","Contest Date","Time Slot","Campus","Unique Exam ID","Invite Status"],`user-mapping${t3Date!=="All"?`-${t3Date}`:""}.csv`)}>Download CSV</button>}
              </div>
            </div>
            <div style={S.card}>
              {t3Filtered.length===0?(<div style={{ textAlign:"center",color:"#555a7a",padding:"60px 0" }}><div style={{ fontFamily:"'Inter',sans-serif",fontWeight:700,fontSize:15,color:"#94a3b8",marginBottom:10 }}>{userMapping.length===0?"No data yet":"No results"}</div></div>):(
                <>
                  <div style={{ overflowX:"auto" }}>
                    <table style={S.table}><thead><tr>{T3_COLS.map(c=><th key={c} style={S.th}>{c}</th>)}</tr></thead>
                    <tbody>{t3Filtered.slice((t3Page-1)*PAGE_SIZE,t3Page*PAGE_SIZE).map((row,i)=>(
                      <tr key={row.id||i} onMouseEnter={e=>e.currentTarget.style.background="#f8fafc"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <td style={S.td}>{row.studentName||"—"}</td><td style={S.td}>{row.niatId||"—"}</td>
                        <td style={{ ...S.td,fontSize:11,fontFamily:"'DM Mono',monospace" }}>{row.studentUid||"—"}</td>
                        <td style={S.td}>{row.skill||"—"}</td><td style={S.td}>{row.skillLevel||"—"}</td>
                        <td style={{ ...S.td,whiteSpace:"nowrap" }}>{row.contestDate||"—"}</td>
                        <td style={{ ...S.td,whiteSpace:"nowrap" }}>{row.timeSlot||"—"}</td>
                        <td style={S.td}>{row.campus||"—"}</td>
                        <td style={{ ...S.td,fontSize:11,fontFamily:"'DM Mono',monospace",color:row.mapped?"#3b82f6":"#94a3b8" }}>{row.uniqueExamId}{!row.mapped&&<span title="No matching exam session" style={{ marginLeft:6,color:"#f5a623" }}>⚠</span>}</td>
                        <td style={S.td}>{row.inviteStatus==="sent"?<span style={S.badge("#00c896")}>Sent</span>:row.inviteStatus==="failed"?<span style={S.badge("#ff5555")}>Failed</span>:<span style={S.badge("#555a7a")}>Not Sent</span>}</td>
                      </tr>
                    ))}</tbody></table>
                  </div>
                  <Pagination page={t3Page} total={t3Filtered.length} onPage={setT3Page} S={S} />
                </>
              )}
            </div>
          </>
        )}
      </div>

      {markModal&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999 }}>
          <div style={{ background:"#fff",borderRadius:12,padding:"32px 36px",maxWidth:480,width:"90%",boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ fontFamily:"'Inter',sans-serif",fontWeight:800,fontSize:18,color:"#0f172a",marginBottom:4 }}>Mark as Published</div>
            <div style={{ fontSize:13,color:"#94a3b8",marginBottom:24 }}>{markModal.session.assessmentTitle} — {markModal.session.dateOfAssessment} {markModal.session.startTimeSlot}</div>
            <div style={{ marginBottom:16 }}>
              <label style={{ fontSize:11,fontFamily:"'Inter',sans-serif",fontWeight:700,letterSpacing:"0.06em",color:"#64748b",textTransform:"uppercase",marginBottom:6,display:"block" }}>Topin Assessment ID <span style={{ color:"#ef4444" }}>*</span></label>
              <input style={{ width:"100%",background:"#fff",border:"1px solid #dde3ed",borderRadius:8,color:"#0f172a",padding:"10px 14px",fontFamily:"'DM Mono',monospace",fontSize:13,outline:"none" }} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={markModal.topinId} onChange={e=>setMarkModal(m=>({...m,topinId:e.target.value}))} />
            </div>
            <div style={{ marginBottom:24 }}>
              <label style={{ fontSize:11,fontFamily:"'Inter',sans-serif",fontWeight:700,letterSpacing:"0.06em",color:"#64748b",textTransform:"uppercase",marginBottom:6,display:"block" }}>Assessment Link <span style={{ color:"#94a3b8",fontWeight:400,textTransform:"none" }}>(optional)</span></label>
              <input style={{ width:"100%",background:"#fff",border:"1px solid #dde3ed",borderRadius:8,color:"#0f172a",padding:"10px 14px",fontFamily:"'DM Mono',monospace",fontSize:12,outline:"none" }} placeholder="https://assessment.topin.tech/…" value={markModal.link} onChange={e=>setMarkModal(m=>({...m,link:e.target.value}))} />
            </div>
            <div style={{ display:"flex",gap:12,justifyContent:"flex-end" }}>
              <button onClick={()=>setMarkModal(null)} style={{ padding:"10px 20px",borderRadius:8,fontFamily:"'Inter',sans-serif",fontWeight:600,fontSize:13,cursor:"pointer",background:"#f1f5f9",color:"#475569",border:"none" }}>Cancel</button>
              <button disabled={!markModal.topinId.trim()} onClick={handleMarkPublished} style={{ padding:"10px 20px",borderRadius:8,fontFamily:"'Inter',sans-serif",fontWeight:700,fontSize:13,cursor:"pointer",background:"#3b82f6",color:"#fff",border:"none",opacity:!markModal.topinId.trim()?0.4:1 }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {deleteModal&&(
        <div style={{ position:"fixed",inset:0,background:"rgba(15,23,42,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999 }}>
          <div style={{ background:"#fff",borderRadius:12,padding:"32px 36px",maxWidth:460,width:"90%",boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ fontFamily:"'Inter',sans-serif",fontWeight:800,fontSize:18,color:"#0f172a",marginBottom:4 }}>Delete {deleteModal.tableName}</div>
            <div style={{ fontSize:13,color:"#94a3b8",marginBottom:24 }}>This action cannot be undone.</div>
            <div style={{ background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"16px 20px",marginBottom:24 }}>
              {deleteModal.toDelete.length>0?<div style={{ fontSize:13,color:"#059669",fontFamily:"'Inter',sans-serif",fontWeight:600,marginBottom:deleteModal.blocked>0?6:0 }}>✓ {deleteModal.toDelete.length} record{deleteModal.toDelete.length!==1?"s":""} will be deleted</div>:<div style={{ fontSize:13,color:"#94a3b8" }}>No deletable records match the current filters.</div>}
              {deleteModal.blocked>0&&<div style={{ fontSize:13,color:"#ef4444",fontFamily:"'Inter',sans-serif",fontWeight:600 }}>✗ {deleteModal.blocked} blocked — {deleteModal.table==="bookings"?"invite already sent":"already published on Topin"}</div>}
            </div>
            <div style={{ display:"flex",gap:12,justifyContent:"flex-end" }}>
              <button onClick={()=>setDeleteModal(null)} style={{ ...S.btn("secondary"),padding:"10px 20px" }}>Cancel</button>
              <button disabled={deleting||deleteModal.toDelete.length===0} onClick={handleBulkDelete} style={{ ...S.btn("danger"),padding:"10px 20px",background:"#fee2e2",fontWeight:700,opacity:(deleting||deleteModal.toDelete.length===0)?0.5:1 }}>{deleting?"Deleting…":`Delete ${deleteModal.toDelete.length} record${deleteModal.toDelete.length!==1?"s":""}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
