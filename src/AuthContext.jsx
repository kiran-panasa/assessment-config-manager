import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { auth } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import { api, invalidateCache } from "./api/client";

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

const RETRY_DELAYS = [2000, 4000, 6000, 8000]; // 4 retries, ~20s total max

async function fetchProfileWithRetry() {
  let lastErr;
  for (let i = 0; i <= RETRY_DELAYS.length; i++) {
    try {
      invalidateCache("/api/users/me");
      return await api.get("/api/users/me");
    } catch (err) {
      lastErr = err;
      if (i < RETRY_DELAYS.length) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[i]));
      }
    }
  }
  throw lastErr;
}

export function AuthProvider({ children }) {
  const [currentUser,  setCurrentUser]  = useState(null);
  const [userProfile,  setUserProfile]  = useState(null);
  const [allowedPages, setAllowedPages] = useState([]);
  const [authLoading,  setAuthLoading]  = useState(true);
  const [serverWaking, setServerWaking] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const data = await api.get("/api/users/me");
      setUserProfile(data.profile);
      setAllowedPages(data.pages || []);
      setServerWaking(false);
    } catch {
      setUserProfile(null);
      setAllowedPages([]);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (!user) {
        setUserProfile(null);
        setAllowedPages([]);
        setAuthLoading(false);
        setServerWaking(false);
        return;
      }

      // First attempt — fast path (server already warm)
      try {
        invalidateCache("/api/users/me");
        const data = await api.get("/api/users/me");
        setUserProfile(data.profile);
        setAllowedPages(data.pages || []);
        setServerWaking(false);
      } catch {
        // First attempt failed — server is likely cold-starting, retry with backoff
        setServerWaking(true);
        try {
          const data = await fetchProfileWithRetry();
          setUserProfile(data.profile);
          setAllowedPages(data.pages || []);
        } catch {
          setUserProfile(null);
          setAllowedPages([]);
        }
        setServerWaking(false);
      }

      setAuthLoading(false);
    });
    return unsub;
  }, [loadProfile]);

  return (
    <AuthContext.Provider value={{ currentUser, userProfile, allowedPages, authLoading, serverWaking, refreshProfile: loadProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
