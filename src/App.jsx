import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";
import { AuthProvider, useAuth } from "./AuthContext";

import { S, css } from "./styles";
import LoginPage  from "./LoginPage";
import PendingPage from "./PendingPage";

const AssessmentsPage   = lazy(() => import("./AssessmentsPage"));
const StudentBookings   = lazy(() => import("./StudentBookings"));
const CreateAssessments = lazy(() => import("./CreateAssessments"));
const InvitedStudents   = lazy(() => import("./InvitedStudents"));
const AdminPanel        = lazy(() => import("./AdminPanel"));
const InterviewerView   = lazy(() => import("./InterviewerView"));
const AboutPage         = lazy(() => import("./AboutPage"));

// ── Sub-components ────────────────────────────────────────────────────────────

function Toast({ message, type, onDone }) {
  useEffect(() => { const t=setTimeout(onDone,2200); return ()=>clearTimeout(t); },[]);
  return <div style={{ position:"fixed",bottom:32,right:32,zIndex:9999,background:type==="error"?"#ff4444":"#00c896",color:"#fff",padding:"12px 22px",borderRadius:8,fontFamily:"'Inter',sans-serif",fontSize:13,boxShadow:"0 4px 24px rgba(0,0,0,0.18)",animation:"slideUp 0.25s ease" }}>{message}</div>;
}

const IconAssessment = ({ color }) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>);
const IconBookings    = ({ color }) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>);
const IconCreate      = ({ color }) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>);
const IconInvited     = ({ color }) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>);
const IconAdmin       = ({ color }) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>);
const IconInterviews  = ({ color }) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="9" cy="16" r="2"/><path d="M15 14h2v4h-2z"/></svg>);
const IconAbout       = ({ color }) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>);

// ── Route guard ───────────────────────────────────────────────────────────────

function ProtectedRoute({ allowed, fallback = "/", children }) {
  return allowed ? children : <Navigate to={fallback} replace />;
}

// ── AppShell — Layout + Route rendering ───────────────────────────────────────

function AppShell() {
  const { currentUser, userProfile, allowedPages, authLoading } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type="success") => setToast({ message, type }), []);

  const prevRoleRef = useRef(null);
  useEffect(() => {
    if (!userProfile) { prevRoleRef.current = null; return; }
    const prev = prevRoleRef.current; prevRoleRef.current = userProfile.role;
    if (prev !== null && prev !== userProfile.role && userProfile.status === "active")
      showToast("Your access level has been changed by an admin.", "error");
  }, [userProfile?.role]);

  if (authLoading) return <div style={{ minHeight:"100vh",background:"#f0f4f8",display:"flex",alignItems:"center",justifyContent:"center" }}><style>{css}</style><span style={{ color:"#94a3b8",fontFamily:"'Inter',sans-serif",fontSize:14 }}>Loading…</span></div>;
  if (!currentUser) return <Navigate to="/login" replace />;
  if (!userProfile || userProfile.status !== "active") return <Navigate to="/pending" replace />;

  const isAdminRole = userProfile.role === "admin" || userProfile.role === "super-admin";

  const NAV_ITEMS = useMemo(() => [
    { key:"assessments", label:"Assessment Configurations", Icon:IconAssessment },
    { key:"bookings",    label:"Student Bookings",          Icon:IconBookings },
    { key:"create",      label:"Create Assessments",        Icon:IconCreate },
    { key:"invited",     label:"Invited Students",          Icon:IconInvited },
    { key:"interviews",  label:"Interview Schedule",        Icon:IconInterviews },
    ...(isAdminRole ? [{ key:"admin", label:"Admin Panel", Icon:IconAdmin }] : []),
    { key:"about", label:"About", Icon:IconAbout, alwaysUnlocked:true },
  ], [isAdminRole]);

  const currentPage = location.pathname.slice(1) || "assessments";

  return (
    <div style={S.root}>
      <style>{css}</style>
      <aside style={S.sidebar}>
        <div style={S.sidebarBrand}><span style={S.dot} />NxtWave Admin</div>
        <nav style={S.sidebarNav}>
          {NAV_ITEMS.map(({ key, label, Icon, alwaysUnlocked }) => {
            const active = currentPage === key;
            const locked = !alwaysUnlocked && key !== "admin" && !allowedPages.includes(key);
            return (
              <button key={key}
                style={{ ...S.sidebarItem(active), color:locked?"#cbd5e1":active?"#059669":"#64748b", cursor:locked?"not-allowed":"pointer" }}
                title={locked?"Contact admin for access":undefined}
                onClick={() => { if (locked) { showToast("Contact admin for access.", "error"); return; } navigate(`/${key}`); }}>
                <Icon color={locked?"#cbd5e1":active?"#059669":"#64748b"} />
                {label}
                {locked && <span style={{ marginLeft:"auto",fontSize:10,color:"#cbd5e1" }}>🔒</span>}
              </button>
            );
          })}
        </nav>
        <div style={{ padding:"14px 12px",borderTop:"1px solid #e2e8f0" }}>
          <div style={{ fontSize:11,color:"#0ea5e9",fontFamily:"'DM Mono',monospace",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingLeft:4 }}>{userProfile.displayName||userProfile.email}</div>
          <div style={{ fontSize:10,color:"#94a3b8",fontFamily:"'Inter',sans-serif",fontWeight:700,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.1em",paddingLeft:4 }}>{userProfile.role?userProfile.role.replace(/-/g," "):"No Role"}</div>
          <button onClick={()=>signOut(auth)} style={{ width:"100%",background:"transparent",border:"1px solid #e2e8f0",borderRadius:6,color:"#64748b",padding:"8px 12px",fontFamily:"'Inter',sans-serif",fontWeight:600,fontSize:11,cursor:"pointer",textAlign:"left" }}>Sign Out</button>
        </div>
      </aside>

      <div style={S.main} className="app-main">
        <Suspense fallback={<div style={{ padding:"80px 48px",color:"#94a3b8",fontFamily:"'Inter',sans-serif",fontSize:14 }}>Loading…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to={`/${allowedPages[0]||"assessments"}`} replace />} />
            <Route path="/assessments" element={<ProtectedRoute allowed={allowedPages.includes("assessments")||isAdminRole} fallback={`/${allowedPages[0]||"assessments"}`}><AssessmentsPage S={S} showToast={showToast} /></ProtectedRoute>} />
            <Route path="/bookings"    element={<ProtectedRoute allowed={allowedPages.includes("bookings")||isAdminRole}><StudentBookings  S={S} showToast={showToast} /></ProtectedRoute>} />
            <Route path="/create"      element={<ProtectedRoute allowed={allowedPages.includes("create")||isAdminRole}><CreateAssessments S={S} showToast={showToast} /></ProtectedRoute>} />
            <Route path="/invited"     element={<ProtectedRoute allowed={allowedPages.includes("invited")||isAdminRole}><InvitedStudents   S={S} showToast={showToast} /></ProtectedRoute>} />
            <Route path="/interviews"  element={<ProtectedRoute allowed={allowedPages.includes("interviews")||isAdminRole}><InterviewerView   S={S} showToast={showToast} /></ProtectedRoute>} />
            <Route path="/admin"       element={<ProtectedRoute allowed={isAdminRole}><AdminPanel S={S} showToast={showToast} /></ProtectedRoute>} />
            <Route path="/about"       element={<AboutPage S={S} />} />
            <Route path="*"            element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDone={()=>setToast(null)} />}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

function AppContent() {
  const { authLoading, currentUser } = useAuth();
  if (authLoading) return (
    <div style={{ minHeight:"100vh",background:"#f0f4f8",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12 }}>
      <style>{css}</style>
      <span style={{ color:"#94a3b8",fontFamily:"'Inter',sans-serif",fontSize:14 }}>Loading…</span>
    </div>
  );
  return (
    <Routes>
      <Route path="/login"   element={!currentUser ? <LoginPage /> : <Navigate to="/" replace />} />
      <Route path="/pending" element={<PendingPage />} />
      <Route path="/*"       element={<AppShell />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  );
}
