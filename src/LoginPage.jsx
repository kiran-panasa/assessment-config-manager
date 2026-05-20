import { useState } from "react";
import { auth, db } from "./firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { BOOTSTRAP_EMAIL } from "./AuthContext";

const CSS = `@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&display=swap');
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d0e14; }`;

const FIREBASE_ERRORS = {
  "auth/user-not-found": "No account found with this email.",
  "auth/wrong-password": "Incorrect password.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/invalid-credential": "Invalid email or password.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
};

const inputStyle = {
  width: "100%", background: "#0d0e14", border: "1px solid #2e3044",
  borderRadius: 8, color: "#e0e0e8", padding: "11px 14px",
  fontFamily: "'DM Mono', monospace", fontSize: 13, outline: "none", boxSizing: "border-box",
};

const labelStyle = {
  fontSize: 11, fontFamily: "'Syne', sans-serif", fontWeight: 700,
  letterSpacing: "0.12em", color: "#555a7a", textTransform: "uppercase",
  marginBottom: 8, display: "block",
};

export default function LoginPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "signup") {
        const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const isBootstrap = email.trim().toLowerCase() === BOOTSTRAP_EMAIL.toLowerCase();
        await setDoc(doc(db, "users", user.uid), {
          email: user.email,
          displayName: name.trim() || email.split("@")[0],
          role: isBootstrap ? "admin" : null,
          status: isBootstrap ? "active" : "pending",
          createdAt: serverTimestamp(),
          approvedAt: isBootstrap ? serverTimestamp() : null,
          approvedBy: isBootstrap ? "system" : null,
        });
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err) {
      setError(FIREBASE_ERRORS[err.code] || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => { setMode(m => m === "login" ? "signup" : "login"); setError(""); };

  return (
    <div style={{
      minHeight: "100vh", background: "#0d0e14",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Mono', monospace", color: "#e0e0e8",
    }}>
      <style>{CSS}</style>
      <div style={{ width: "100%", maxWidth: 400, padding: "0 24px" }}>

        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%", background: "#00c89620",
            border: "1px solid #00c896", margin: "0 auto 16px",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#00c896" }} />
          </div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, color: "#fff" }}>
            NxtWave Admin
          </div>
          <div style={{ fontSize: 12, color: "#555a7a", marginTop: 6 }}>
            {mode === "login" ? "Sign in to your account" : "Request access"}
          </div>
        </div>

        <div style={{ background: "#13141e", border: "1px solid #1e2030", borderRadius: 12, padding: 32 }}>
          <form onSubmit={handleSubmit}>
            {mode === "signup" && (
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Full Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Your name" style={inputStyle} />
              </div>
            )}

            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required style={inputStyle} />
            </div>

            <div style={{ marginBottom: error ? 16 : 24 }}>
              <label style={labelStyle}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "Min. 6 characters" : "Your password"}
                required style={inputStyle} />
            </div>

            {error && (
              <div style={{
                marginBottom: 20, padding: "10px 14px",
                background: "#ff444414", border: "1px solid #ff444440",
                borderRadius: 8, fontSize: 12, color: "#ff7777",
              }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              width: "100%", padding: 12, borderRadius: 8,
              fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14,
              cursor: loading ? "not-allowed" : "pointer",
              background: "#00c896", color: "#0d0e14", border: "none",
              opacity: loading ? 0.6 : 1, transition: "opacity 0.15s",
            }}>
              {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: "#555a7a" }}>
            {mode === "login" ? "Don't have an account? " : "Already have an account? "}
            <button onClick={switchMode} style={{
              background: "none", border: "none", color: "#00c896",
              cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 12, padding: 0,
            }}>
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
