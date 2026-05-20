import { auth } from "./firebase";
import { signOut } from "firebase/auth";
import { useAuth } from "./AuthContext";

const CSS = `@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d0e14; }`;

export default function PendingPage() {
  const { currentUser } = useAuth();

  return (
    <div style={{
      minHeight: "100vh", background: "#0d0e14",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Mono', monospace", color: "#e0e0e8",
    }}>
      <style>{CSS}</style>
      <div style={{ textAlign: "center", maxWidth: 440, padding: "0 24px" }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: "#f5a62314", border: "1px solid #f5a62340",
          margin: "0 auto 24px",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
        }}>
          ⏳
        </div>

        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, color: "#fff", marginBottom: 10 }}>
          Pending Approval
        </div>
        <div style={{ fontSize: 13, color: "#555a7a", lineHeight: 1.8, marginBottom: 6 }}>
          Your account is awaiting role assignment.
        </div>
        <div style={{ fontSize: 12, color: "#3a3d52", marginBottom: 28 }}>
          Signed in as <span style={{ color: "#7eb8ff" }}>{currentUser?.email}</span>
        </div>

        <div style={{
          fontSize: 12, color: "#555a7a", lineHeight: 1.8, marginBottom: 32,
          padding: "16px 20px", background: "#13141e",
          border: "1px solid #1e2030", borderRadius: 8, textAlign: "left",
        }}>
          An admin will review your signup and assign the appropriate role.
          This page updates automatically once access is granted — no need to refresh.
        </div>

        <button onClick={() => signOut(auth)} style={{
          background: "transparent", border: "1px solid #2e3044", borderRadius: 8,
          color: "#555a7a", padding: "10px 24px",
          fontFamily: "'Syne', sans-serif", fontWeight: 600, fontSize: 13, cursor: "pointer",
        }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}
