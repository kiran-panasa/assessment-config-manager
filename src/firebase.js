import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDCKw2EE9RJ1-oPo1sdbgsU47ra3LbbpQc",
  authDomain: "assessment-config-manager.firebaseapp.com",
  projectId: "assessment-config-manager",
  storageBucket: "assessment-config-manager.firebasestorage.app",
  messagingSenderId: "567558097768",
  appId: "1:567558097768:web:aad46b095e48359fdf24dd",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
