import { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc, onSnapshot, collection, getDocs, setDoc, serverTimestamp,
} from "firebase/firestore";

const BOOTSTRAP_EMAIL = "kiran.p@nxtwave.tech";

const DEFAULT_ROLES = [
  { key: "content-team", name: "Content Team", pages: ["assessments"], isSystem: true },
  { key: "central-ops",  name: "Central Ops",  pages: ["bookings", "invited"], isSystem: true },
  { key: "admin",        name: "Admin",         pages: ["assessments", "bookings", "create", "invited", "credentials"], isSystem: true },
];

async function seedRoles() {
  const snap = await getDocs(collection(db, "roles"));
  if (!snap.empty) return;
  for (const role of DEFAULT_ROLES) {
    await setDoc(doc(db, "roles", role.key), { ...role, createdAt: serverTimestamp() });
  }
}

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export { BOOTSTRAP_EMAIL };

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [allowedPages, setAllowedPages] = useState([]);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => { seedRoles(); }, []);

  useEffect(() => {
    let unsubUser = null;
    let unsubRole = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (unsubUser) { unsubUser(); unsubUser = null; }
      if (unsubRole) { unsubRole(); unsubRole = null; }

      if (!user) {
        setUserProfile(null);
        setAllowedPages([]);
        setAuthLoading(false);
        return;
      }

      unsubUser = onSnapshot(doc(db, "users", user.uid), (snap) => {
        if (!snap.exists()) {
          setUserProfile(null);
          setAllowedPages([]);
          setAuthLoading(false);
          return;
        }

        const profile = { id: snap.id, ...snap.data() };
        setUserProfile(profile);

        if (unsubRole) { unsubRole(); unsubRole = null; }

        if (!profile.role || profile.status !== "active") {
          setAllowedPages([]);
          setAuthLoading(false);
          return;
        }

        unsubRole = onSnapshot(doc(db, "roles", profile.role), (roleSnap) => {
          setAllowedPages(roleSnap.exists() ? roleSnap.data().pages ?? [] : []);
          setAuthLoading(false);
        });
      });
    });

    return () => {
      unsubAuth();
      if (unsubUser) unsubUser();
      if (unsubRole) unsubRole();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, userProfile, allowedPages, authLoading }}>
      {children}
    </AuthContext.Provider>
  );
}
