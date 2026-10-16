import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, browserLocalPersistence, setPersistence } from "firebase/auth";
import { firebaseConfig } from "./firebaseConfig.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

const loginForm   = document.getElementById("loginForm");
const signedInDiv = document.getElementById("signedIn");
const errorDiv    = document.getElementById("error");
const emailInput  = document.getElementById("email");
const passInput   = document.getElementById("password");
const signInBtn   = document.getElementById("signInBtn");

function showError(msg) {
  errorDiv.textContent = msg;
  errorDiv.style.display = "block";
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginForm.style.display = "none";
    signedInDiv.style.display = "block";
    document.getElementById("signedInEmail").textContent = user.email;
  } else {
    loginForm.style.display = "block";
    signedInDiv.style.display = "none";
  }
});

signInBtn.addEventListener("click", async () => {
  errorDiv.style.display = "none";
  const email = emailInput.value.trim();
  const password = passInput.value;
  if (!email || !password) { showError("Enter email and password."); return; }
  signInBtn.disabled = true;
  signInBtn.textContent = "Signing in…";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    passInput.value = "";
  } catch (err) {
    showError(err.message || "Sign in failed.");
  }
  signInBtn.disabled = false;
  signInBtn.textContent = "Sign In";
});

document.getElementById("openRunnerBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("runner.html") });
});

document.getElementById("signOutBtn").addEventListener("click", () => {
  signOut(auth).catch(() => {});
});
