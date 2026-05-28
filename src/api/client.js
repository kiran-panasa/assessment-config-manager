import { auth } from "../firebase";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function getToken() {
  const user = auth.currentUser;
  if (!user) return null;
  // Force refresh if within 5 minutes of expiry
  return user.getIdToken();
}

async function request(method, path, body) {
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
  return data;
}

export const api = {
  get:    (path)        => request("GET",    path),
  post:   (path, body)  => request("POST",   path, body),
  put:    (path, body)  => request("PUT",    path, body),
  delete: (path)        => request("DELETE", path),
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
