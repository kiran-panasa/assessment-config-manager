import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth } from "./firebase";
import { signOut } from "firebase/auth";
import { useAuth } from "./AuthContext";

export default function PendingPage() {
  const { currentUser, userProfile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (userProfile?.status === "active") {
      navigate("/", { replace: true });
    }
  }, [userProfile, navigate]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #e8f5f0 0%, #f0f4f8 50%, #ebe8f5 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', sans-serif", color: "#0f172a",
    }}>
      <div style={{ textAlign: "center", maxWidth: 440, padding: "0 24px" }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: "#fef9c3", border: "1px solid #fde047",
          margin: "0 auto 24px",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
        }}>
          ⏳
        </div>

        <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 22, color: "#0f172a", marginBottom: 10 }}>
          Pending Approval
        </div>
        <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.8, marginBottom: 6 }}>
          Your account is awaiting role assignment.
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 28 }}>
          Signed in as <span style={{ color: "#0ea5e9" }}>{currentUser?.email}</span>
        </div>

        <div style={{
          fontSize: 12, color: "#64748b", lineHeight: 1.8, marginBottom: 32,
          padding: "16px 20px", background: "#ffffff",
          border: "1px solid #e2e8f0", borderRadius: 8, textAlign: "left",
          boxShadow: "0 1px 4px rgba(15,23,42,0.04)",
        }}>
          An admin will review your signup and assign the appropriate role.
          This page updates automatically once access is granted — no need to refresh.
        </div>

        <button onClick={() => signOut(auth)} style={{
          background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8,
          color: "#64748b", padding: "10px 24px",
          fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 13, cursor: "pointer",
        }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}
