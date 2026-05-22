import { useState } from "react";
import { auth, db } from "./firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { BOOTSTRAP_EMAIL } from "./AuthContext";

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f0f4f8; }
  .login-input:focus { border-color: #00b386 !important; box-shadow: 0 0 0 3px rgba(0,195,150,0.12) !important; }
  .login-btn-primary:hover { background: #00b386 !important; }
  .login-switch:hover { text-decoration: underline; }
`;

const FIREBASE_ERRORS = {
  "auth/user-not-found": "No account found with this email.",
  "auth/wrong-password": "Incorrect password.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/invalid-credential": "Invalid email or password.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
};

const EyeIcon = ({ open }) => open ? (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
) : (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

export default function LoginPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

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

  const switchMode = () => { setMode(m => m === "login" ? "signup" : "login"); setError(""); setShowPassword(false); setResetMode(false); setResetSent(false); };

  const handleReset = async (e) => {
    e.preventDefault();
    if (!email.trim()) { setError("Enter your email address first."); return; }
    setError(""); setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true);
    } catch (err) {
      setError(FIREBASE_ERRORS[err.code] || "Could not send reset email. Check the address and try again.");
    } finally { setLoading(false); }
  };

  const inputBase = {
    width: "100%", background: "#fff",
    border: "1px solid #dde3ed", borderRadius: 10,
    color: "#1a2033", padding: "11px 14px",
    fontFamily: "'Inter', sans-serif", fontSize: 14,
    outline: "none", boxSizing: "border-box",
    transition: "border-color 0.15s, box-shadow 0.15s",
  };

  const labelBase = {
    fontSize: 12, fontFamily: "'Inter', sans-serif", fontWeight: 600,
    color: "#64748b", marginBottom: 7, display: "block", letterSpacing: "0.01em",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #e8f5f0 0%, #f0f4f8 50%, #ebe8f5 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', sans-serif", color: "#1a2033",
    }}>
      <style>{CSS}</style>
      <div style={{ width: "100%", maxWidth: 420, padding: "0 20px" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, background: "#00c896",
            margin: "0 auto 16px",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 14px rgba(0,200,150,0.35)",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 22, color: "#0f172a", letterSpacing: "-0.4px" }}>
            NxtWave Admin
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 5 }}>
            {mode === "login" ? "Welcome back — sign in to continue" : "Create your account"}
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: "#fff", borderRadius: 16, padding: "32px 32px 28px",
          boxShadow: "0 4px 24px rgba(15,23,42,0.08), 0 1px 3px rgba(15,23,42,0.06)",
          border: "1px solid rgba(220,228,240,0.8)",
        }}>

          {/* ── Forgot password flow ── */}
          {resetMode ? (
            resetSent ? (
              <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a", marginBottom: 8 }}>Check your inbox</div>
                <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
                  A password reset link was sent to <strong>{email}</strong>.
                </div>
                <button onClick={() => { setResetMode(false); setResetSent(false); }} style={{
                  marginTop: 20, background: "none", border: "none", color: "#00b386",
                  cursor: "pointer", fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 13,
                }}>Back to sign in</button>
              </div>
            ) : (
              <form onSubmit={handleReset}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a", marginBottom: 6 }}>Reset password</div>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20, lineHeight: 1.5 }}>
                  Enter your email and we'll send a reset link.
                </div>
                <div style={{ marginBottom: error ? 14 : 20 }}>
                  <label style={labelBase}>Email address</label>
                  <input className="login-input" type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" required style={inputBase} />
                </div>
                {error && (
                  <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13, color: "#dc2626", lineHeight: 1.5 }}>{error}</div>
                )}
                <button type="submit" disabled={loading} className="login-btn-primary" style={{
                  width: "100%", padding: "12px", borderRadius: 10, fontFamily: "'Inter', sans-serif",
                  fontWeight: 600, fontSize: 14, cursor: loading ? "not-allowed" : "pointer",
                  background: "#00c896", color: "#fff", border: "none", opacity: loading ? 0.7 : 1,
                }}>{loading ? "Sending…" : "Send reset link"}</button>
                <div style={{ textAlign: "center", marginTop: 16 }}>
                  <button type="button" onClick={() => { setResetMode(false); setError(""); }} style={{
                    background: "none", border: "none", color: "#00b386", cursor: "pointer",
                    fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 13,
                  }}>Back to sign in</button>
                </div>
              </form>
            )
          ) : (
            <>
              <form onSubmit={handleSubmit}>

                {mode === "signup" && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelBase}>Full Name</label>
                    <input
                      className="login-input"
                      type="text" value={name} onChange={e => setName(e.target.value)}
                      placeholder="Your full name"
                      style={inputBase}
                    />
                  </div>
                )}

                <div style={{ marginBottom: 16 }}>
                  <label style={labelBase}>Email address</label>
                  <input
                    className="login-input"
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" required
                    style={inputBase}
                  />
                </div>

                <div style={{ marginBottom: error ? 14 : 22 }}>
                  <label style={labelBase}>Password</label>
                  <div style={{ position: "relative" }}>
                    <input
                      className="login-input"
                      type={showPassword ? "text" : "password"}
                      value={password} onChange={e => setPassword(e.target.value)}
                      placeholder={mode === "signup" ? "At least 6 characters" : "Enter your password"}
                      required
                      style={{ ...inputBase, paddingRight: 44 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      style={{
                        position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer",
                        color: "#94a3b8", padding: 2, display: "flex", alignItems: "center",
                      }}
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      <EyeIcon open={showPassword} />
                    </button>
                  </div>
                </div>

                {error && (
                  <div style={{
                    marginBottom: 16, padding: "10px 14px",
                    background: "#fef2f2", border: "1px solid #fecaca",
                    borderRadius: 8, fontSize: 13, color: "#dc2626", lineHeight: 1.5,
                  }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit" disabled={loading}
                  className="login-btn-primary"
                  style={{
                    width: "100%", padding: "12px", borderRadius: 10,
                    fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 14,
                    cursor: loading ? "not-allowed" : "pointer",
                    background: "#00c896", color: "#fff", border: "none",
                    opacity: loading ? 0.7 : 1,
                    transition: "background 0.15s, opacity 0.15s",
                    letterSpacing: "0.01em",
                  }}>
                  {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
                </button>
              </form>

              {mode === "login" && (
                <div style={{ textAlign: "center", marginTop: 14 }}>
                  <button onClick={() => { setResetMode(true); setError(""); }} style={{
                    background: "none", border: "none", color: "#94a3b8",
                    cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 12,
                  }}>Forgot password?</button>
                </div>
              )}

              <div style={{ textAlign: "center", marginTop: 14, fontSize: 13, color: "#94a3b8" }}>
                {mode === "login" ? "Don't have an account? " : "Already have an account? "}
                <button onClick={switchMode} className="login-switch" style={{
                  background: "none", border: "none", color: "#00b386",
                  cursor: "pointer", fontFamily: "'Inter', sans-serif",
                  fontWeight: 600, fontSize: 13, padding: 0,
                }}>
                  {mode === "login" ? "Sign up" : "Sign in"}
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "#cbd5e1" }}>
          NxtWave Internal Tool · Restricted Access
        </div>
      </div>
    </div>
  );
}
