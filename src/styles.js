export const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f0f4f8; }
  @keyframes slideUp { from { transform: translateY(20px); opacity:0;} to { transform:translateY(0);opacity:1;} }
  @keyframes fadeIn { from {opacity:0;} to {opacity:1;} }
  ::-webkit-scrollbar { width: 5px; background: #f1f5f9; }
  ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
`;

export const S = {
  root: { minHeight:"100vh",background:"#f0f4f8",fontFamily:"'Inter',sans-serif",color:"#0f172a",display:"flex" },
  sidebar: { width:240,background:"#ffffff",borderRight:"1px solid #e2e8f0",display:"flex",flexDirection:"column",position:"fixed",top:0,left:0,bottom:0,zIndex:200,boxShadow:"2px 0 8px rgba(15,23,42,0.05)" },
  sidebarBrand: { padding:"24px 20px",borderBottom:"1px solid #e2e8f0",fontFamily:"'Inter',sans-serif",fontWeight:800,fontSize:15,color:"#0f172a",letterSpacing:"-0.3px",display:"flex",alignItems:"center",gap:10 },
  dot: { width:8,height:8,borderRadius:"50%",background:"#00c896",display:"inline-block",flexShrink:0 },
  sidebarNav: { padding:"12px 10px",flex:1 },
  sidebarItem: (active) => ({ display:"flex",alignItems:"center",gap:11,width:"100%",padding:"10px 12px",borderRadius:8,fontFamily:"'Inter',sans-serif",fontWeight:600,fontSize:12.5,cursor:"pointer",color:active?"#059669":"#64748b",background:active?"#f0fdf9":"transparent",border:"none",borderLeft:active?"2px solid #00c896":"2px solid transparent",textAlign:"left",transition:"all 0.15s",marginBottom:2 }),
  main: { marginLeft:240,flex:1,minWidth:0,display:"flex",flexDirection:"column" },
  header: { borderBottom:"1px solid #e2e8f0",padding:"0 48px",display:"flex",alignItems:"flex-end",gap:32,background:"#ffffff",position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 4px rgba(15,23,42,0.04)" },
  headerTitle: { fontFamily:"'Inter',sans-serif",fontWeight:700,fontSize:13,color:"#94a3b8",paddingBottom:20,paddingTop:20,marginRight:8 },
  nav: { display:"flex",gap:0 },
  navItem: (active) => ({ padding:"18px 18px",fontFamily:"'Inter',sans-serif",fontWeight:600,fontSize:13,cursor:"pointer",color:active?"#0f172a":"#94a3b8",background:"none",border:"none",borderBottom:active?"2px solid #00c896":"2px solid transparent",transition:"color 0.15s" }),
  body: { padding:"36px 48px",maxWidth:1300 },
  card: { background:"#ffffff",border:"1px solid #e2e8f0",borderRadius:12,padding:"28px 32px",marginBottom:24,boxShadow:"0 1px 4px rgba(15,23,42,0.04)" },
  label: { fontSize:11,fontFamily:"'Inter',sans-serif",fontWeight:600,letterSpacing:"0.06em",color:"#64748b",textTransform:"uppercase",marginBottom:8,display:"block" },
  select: { width:"100%",background:"#ffffff",border:"1px solid #dde3ed",borderRadius:8,color:"#0f172a",padding:"11px 14px",fontFamily:"'Inter',sans-serif",fontSize:13,outline:"none",appearance:"none",cursor:"pointer" },
  input: { width:"100%",background:"#ffffff",border:"1px solid #dde3ed",borderRadius:8,color:"#0f172a",padding:"11px 14px",fontFamily:"'Inter',sans-serif",fontSize:13,outline:"none" },
  btn: (variant="primary") => ({ padding:"11px 24px",borderRadius:8,fontFamily:"'Inter',sans-serif",fontWeight:600,fontSize:13,cursor:"pointer",background:variant==="primary"?"#00c896":variant==="danger"?"transparent":"#f1f5f9",color:variant==="primary"?"#fff":variant==="danger"?"#ef4444":"#475569",border:variant==="danger"?"1px solid #fecaca":"none",transition:"opacity 0.15s" }),
  grid2: { display:"grid",gridTemplateColumns:"1fr 1fr",gap:20 },
  sectionTitle: { fontFamily:"'Inter',sans-serif",fontWeight:800,fontSize:22,color:"#0f172a",marginBottom:6,letterSpacing:"-0.4px" },
  sectionSub: { fontSize:13,color:"#94a3b8",marginBottom:28 },
  table: { width:"100%",borderCollapse:"collapse",fontSize:13 },
  th: { fontFamily:"'Inter',sans-serif",fontWeight:600,fontSize:11,letterSpacing:"0.06em",color:"#94a3b8",textTransform:"uppercase",padding:"10px 14px",textAlign:"left",borderBottom:"1px solid #f1f5f9" },
  td: { padding:"12px 14px",borderBottom:"1px solid #f8fafc",verticalAlign:"middle" },
  badge: (color="#00c896") => ({ display:"inline-block",background:color+"18",color,borderRadius:4,padding:"2px 10px",fontSize:11,fontFamily:"'Inter',sans-serif",fontWeight:700,letterSpacing:"0.06em" }),
  pill: { display:"inline-flex",alignItems:"center",gap:8,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:20,padding:"5px 12px 5px 16px",fontSize:12,color:"#475569",margin:"4px" },
  pillX: { cursor:"pointer",fontSize:15,lineHeight:1,background:"none",border:"none",padding:0,color:"#ef4444" },
};
