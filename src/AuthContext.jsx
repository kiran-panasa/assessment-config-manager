import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { auth } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getMyProfile } from "./api/firestore";

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser,  setCurrentUser]  = useState(null);
  const [userProfile,  setUserProfile]  = useState(null);
  const [allowedPages, setAllowedPages] = useState([]);
  const [authLoading,  setAuthLoading]  = useState(true);

  const loadProfile = useCallback(async (uid) => {
    try {
      const data = await getMyProfile(uid);
      if (data) {
        setUserProfile(data.profile);
        setAllowedPages(data.pages || []);
      } else {
        setUserProfile(null);
        setAllowedPages([]);
      }
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
      await loadProfile(user.uid);
      setAuthLoading(false);
    });
    return unsub;
  }, [loadProfile]);

  const refreshProfile = useCallback(() => {
    if (auth.currentUser) loadProfile(auth.currentUser.uid);
  }, [loadProfile]);

  return (
    <AuthContext.Provider value={{ currentUser, userProfile, allowedPages, authLoading, serverWaking: false, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
