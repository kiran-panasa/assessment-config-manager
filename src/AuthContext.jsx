import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { auth } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getMyProfile } from "./api/firestore";

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

const CACHE_KEY = (uid) => `nw_profile_${uid}`;

export function AuthProvider({ children }) {
  const [currentUser,  setCurrentUser]  = useState(null);
  const [userProfile,  setUserProfile]  = useState(null);
  const [allowedPages, setAllowedPages] = useState([]);
  const [authLoading,  setAuthLoading]  = useState(true);

  // Fetches profile from Firestore and writes result to sessionStorage.
  // Never clears state on error when cache is present — stale data is better than a flash to /pending.
  const loadProfile = useCallback(async (uid) => {
    try {
      const data = await getMyProfile(uid);
      if (data) {
        setUserProfile(data.profile);
        setAllowedPages(data.pages || []);
        try {
          sessionStorage.setItem(CACHE_KEY(uid), JSON.stringify({ profile: data.profile, pages: data.pages || [] }));
        } catch {}
      } else {
        setUserProfile(null);
        setAllowedPages([]);
        try { sessionStorage.removeItem(CACHE_KEY(uid)); } catch {}
      }
    } catch {
      // Firestore unavailable — keep whatever state is already set (cache or null)
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

      // Hydrate from sessionStorage for instant render — eliminates auth waterfall on return visits
      try {
        const raw = sessionStorage.getItem(CACHE_KEY(user.uid));
        if (raw) {
          const { profile, pages } = JSON.parse(raw);
          setUserProfile(profile);
          setAllowedPages(pages || []);
          setAuthLoading(false);
          loadProfile(user.uid); // background revalidation, non-blocking
          return;
        }
      } catch {}

      // No cache: full Firestore load (first visit or after sign-out)
      await loadProfile(user.uid);
      setAuthLoading(false);
    });
    return unsub;
  }, [loadProfile]);

  const refreshProfile = useCallback(() => {
    if (auth.currentUser) return loadProfile(auth.currentUser.uid);
  }, [loadProfile]);

  const value = useMemo(
    () => ({ currentUser, userProfile, allowedPages, authLoading, refreshProfile }),
    [currentUser, userProfile, allowedPages, authLoading, refreshProfile]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
