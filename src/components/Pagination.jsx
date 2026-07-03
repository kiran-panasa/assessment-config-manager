import { memo } from "react";

const PAGE_SIZE = 20;

export default memo(function Pagination({ page, total, onPage, S }) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) return null;

  return (
    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:16,paddingTop:14,borderTop:"1px solid #f1f5f9" }}>
      <span style={{ fontSize:12,color:"#94a3b8",fontFamily:"'Inter',sans-serif" }}>
        {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE,total)} of {total}
      </span>
      <div style={{ display:"flex",gap:6 }}>
        <button disabled={page===1} onClick={()=>onPage(p=>p-1)} style={{ ...S.btn("secondary"),padding:"5px 12px",fontSize:12,opacity:page===1?0.4:1 }}>Prev</button>
        <button disabled={page===totalPages} onClick={()=>onPage(p=>p+1)} style={{ ...S.btn("secondary"),padding:"5px 12px",fontSize:12,opacity:page===totalPages?0.4:1 }}>Next</button>
      </div>
    </div>
  );
});
