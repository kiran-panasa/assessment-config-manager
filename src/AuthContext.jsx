import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { auth } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import { api } from "./api/client";

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser,  setCurrentUser]  = useState(null);
  const [userProfile,  setUserProfile]  = useState(null);
  const [allowedPages, setAllowedPages] = useState([]);
  const [authLoading,  setAuthLoading]  = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      const data = await api.get("/api/users/me");
      setUserProfile(data.profile);
      setAllowedPages(data.pages || []);
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
        return;
      }
      await loadProfile();
      setAuthLoading(false);
    });
    return unsub;
  }, [loadProfile]);

  return (
    <AuthContext.Provider value={{ currentUser, userProfile, allowedPages, authLoading, refreshProfile: loadProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
