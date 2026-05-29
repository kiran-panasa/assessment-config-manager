import { auth } from "../firebase";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

// ── In-memory GET cache (TTL: 60 seconds) ────────────────────────────────────
const _cache = new Map(); // path → { data, ts }
const CACHE_TTL = 60_000;

export function invalidateCache(path) {
  if (path) {
    // invalidate exact path and any path starting with it
    for (const key of _cache.keys()) {
      if (key === path || key.startsWith(path)) _cache.delete(key);
    }
  } else {
    _cache.clear();
  }
}

async function getToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

async function request(method, path, body) {
  // Return cached data for GET requests within TTL
  if (method === "GET") {
    const cached = _cache.get(path);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  }

  const token = await getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

  // Store successful GET responses in cache
  if (method === "GET") _cache.set(path, { data, ts: Date.now() });

  return data;
}

export const api = {
  get:    (path)       => request("GET",    path),
  post:   (path, body) => request("POST",   path, body),
  put:    (path, body) => request("PUT",    path, body),
  delete: (path)       => request("DELETE", path),
};

// SSE helper — returns an EventSource pointed at the backend
export function progressStream() {
  return new EventSource(`${BASE}/api/publish/progress`);
}

// Health check (no auth needed)
export async function checkHealth() {
  const res = await fetch(`${BASE}/api/health`);
  return res.ok;
}

// ── Local server helpers (for Playwright publish running on local machine) ────

const LOCAL_SERVER_KEY = "localServerUrl";

export function getLocalServerUrl() {
  try { return localStorage.getItem(LOCAL_SERVER_KEY) || ""; } catch { return ""; }
}

export function setLocalServerUrl(url) {
  try {
    if (url) localStorage.setItem(LOCAL_SERVER_KEY, url.replace(/\/$/, ""));
    else localStorage.removeItem(LOCAL_SERVER_KEY);
  } catch {}
}

async function localRequest(method, path, body) {
  const base = getLocalServerUrl();
  if (!base) throw new Error("Local server URL not set — enter it in the Credentials tab.");
  const token = await getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const localApi = {
  get:    (path)       => localRequest("GET",    path),
  post:   (path, body) => localRequest("POST",   path, body),
};

export function localProgressStream() {
  const base = getLocalServerUrl();
  if (!base) throw new Error("Local server URL not set.");
  return new EventSource(`${base}/api/publish/progress`);
}

export async function checkLocalHealth() {
  const base = getLocalServerUrl();
  if (!base) return false;
  try { const res = await fetch(`${base}/api/health`); return res.ok; } catch { return false; }
}
