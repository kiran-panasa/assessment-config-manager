import { useState, useEffect } from "react";
import { db } from "./firebase";
import { useAuth } from "./AuthContext";
import {
  collection, onSnapshot, doc, updateDoc, setDoc,
  deleteDoc, serverTimestamp, query, where,
} from "firebase/firestore";

const ALL_PAGES = [
  { key: "assessments",  label: "Assessment Configurations" },
  { key: "bookings",     label: "Student Bookings" },
  { key: "create",       label: "Create Assessments" },
  { key: "invited",      label: "Invited Students" },
  { key: "credentials",  label: "Credentials Tab (server secret)" },
];

const labelStyle = {
  fontSize: 11, fontFamily: "'Inter', sans-serif", fontWeight: 700,
  letterSpacing: "0.06em", color: "#64748b", textTransform: "uppercase",
  marginBottom: 8, display: "block",
};

function PageToggle({ pageKey, label, checked, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 14px", borderRadius: 8, cursor: "pointer",
      background: checked ? "#f0fdf9" : "#f8fafc",
      border: `1px solid ${checked ? "#00c896" : "#e2e8f0"}`,
      fontSize: 12, color: checked ? "#059669" : "#64748b",
      fontFamily: "'Inter', sans-serif", fontWeight: 600,
      transition: "all 0.15s", userSelect: "none",
    }}>
      <span style={{
        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
        border: `2px solid ${checked ? "#00c896" : "#cbd5e1"}`,
        background: checked ? "#00c896" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, color: "#ffffff",
      }}>
        {checked ? "✓" : ""}
      </span>
      {label}
    </div>
  );
}

export default function AdminPanel({ S, showToast }) {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState("pending");
  const [pendingUsers, setPendingUsers] = useState([]);
  const [activeUsers, setActiveUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [pendingRoleMap, setPendingRoleMap] = useState({});
  const [userRoleMap, setUserRoleMap] = useState({});
  const [newRoleName, setNewRoleName] = useState("");
  const [newRolePages, setNewRolePages] = useState([]);
  const [saving, setSaving] = useState({});

  useEffect(() => {
    const unsubPending = onSnapshot(
      query(collection(db, "users"), where("status", "==", "pending")),
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
        setPendingUsers(data);
      }
    );
    const unsubActive = onSnapshot(
      query(collection(db, "users"), where("status", "==", "active")),
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        data.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
        setActiveUsers(data);
      }
    );
    const unsubRoles = onSnapshot(collection(db, "roles"), snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      setRoles(data);
    });
    return () => { unsubPending(); unsubActive(); unsubRoles(); };
  }, []);

  const roleOptions = roles.map(r => ({ value: r.key, label: r.name }));

  const fmtDate = (ts) => {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const setSavingKey = (id, val) => setSaving(s => ({ ...s, [id]: val }));

  const handleApprove = async (user) => {
    const role = pendingRoleMap[user.id];
    if (!role) { showToast("Select a role first.", "error"); return; }
    setSavingKey(user.id, true);
    try {
      await updateDoc(doc(db, "users", user.id), {
        role, status: "active",
        approvedAt: serverTimestamp(), approvedBy: currentUser.uid,
      });
      showToast(`${user.email} approved.`);
      setPendingRoleMap(m => { const n = { ...m }; delete n[user.id]; return n; });
    } catch { showToast("Failed to approve.", "error"); }
    setSavingKey(user.id, false);
  };

  const handleRoleChange = async (user) => {
    const newRole = userRoleMap[user.id];
    if (!newRole || newRole === user.role) return;
    setSavingKey(user.id, true);
    try {
      await updateDoc(doc(db, "users", user.id), { role: newRole });
      showToast(`Role updated for ${user.email}.`);
      setUserRoleMap(m => { const n = { ...m }; delete n[user.id]; return n; });
    } catch { showToast("Failed to update role.", "error"); }
    setSavingKey(user.id, false);
  };

  const handleRevoke = async (user) => {
    if (!window.confirm(`Revoke access for ${user.email}? They will be moved back to Pending.`)) return;
    setSavingKey(user.id + "_revoke", true);
    try {
      await updateDoc(doc(db, "users", user.id), { status: "pending", role: null });
      showToast(`Access revoked for ${user.email}.`);
    } catch { showToast("Failed to revoke access.", "error"); }
    setSavingKey(user.id + "_revoke", false);
  };

  const handleTogglePage = async (roleId, pageKey, currentPages) => {
    const newPages = currentPages.includes(pageKey)
      ? currentPages.filter(p => p !== pageKey)
      : [...currentPages, pageKey];
    try {
      await updateDoc(doc(db, "roles", roleId), { pages: newPages });
    } catch { showToast("Failed to update access.", "error"); }
  };

  const handleCreateRole = async () => {
    const name = newRoleName.trim();
    if (!name) { showToast("Enter a role name.", "error"); return; }
    const key = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (roles.find(r => r.key === key)) { showToast("A role with this name already exists.", "error"); return; }
    try {
      await setDoc(doc(db, "roles", key), { key, name, pages: newRolePages, isSystem: false, createdAt: serverTimestamp() });
      showToast(`Role "${name}" created.`);
      setNewRoleName(""); setNewRolePages([]);
    } catch { showToast("Failed to create role.", "error"); }
  };

  const handleDeleteRole = async (role) => {
    const inUse = [...activeUsers, ...pendingUsers].some(u => u.role === role.key);
    if (inUse) { showToast("Cannot delete — users are assigned to this role.", "error"); return; }
    try {
      await deleteDoc(doc(db, "roles", role.id));
      showToast(`Role "${role.name}" deleted.`);
    } catch { showToast("Failed to delete role.", "error"); }
  };

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={S.header}>
        <span style={S.headerTitle}>Admin Panel</span>
        <nav style={S.nav}>
          {[
            ["pending", `Pending (${pendingUsers.length})`],
            ["users", "All Users"],
            ["roles", "Roles & Access"],
          ].map(([key, label]) => (
            <button key={key} style={S.navItem(activeTab === key)} onClick={() => setActiveTab(key)}>
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div style={S.body}>

        {/* ── PENDING USERS ── */}
        {activeTab === "pending" && (
          <>
            <div style={S.sectionTitle}>Pending Approval</div>
            <div style={{ ...S.sectionSub, marginBottom: 24 }}>New signups waiting for role assignment.</div>
            <div style={S.card}>
              {pendingUsers.length === 0 ? (
                <div style={{ textAlign: "center", color: "#94a3b8", padding: "50px 0", fontSize: 13 }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 15, color: "#94a3b8", marginBottom: 8 }}>
                    No pending requests
                  </div>
                  All signups have been reviewed.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Email</th>
                        <th style={S.th}>Name</th>
                        <th style={S.th}>Requested</th>
                        <th style={S.th}>Assign Role</th>
                        <th style={S.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingUsers.map(user => (
                        <tr key={user.id}
                          onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <td style={{ ...S.td, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{user.email}</td>
                          <td style={S.td}>{user.displayName || "—"}</td>
                          <td style={{ ...S.td, fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>{fmtDate(user.createdAt)}</td>
                          <td style={S.td}>
                            <select
                              style={{ ...S.select, width: 180, padding: "8px 12px", fontSize: 12 }}
                              value={pendingRoleMap[user.id] || ""}
                              onChange={e => setPendingRoleMap(m => ({ ...m, [user.id]: e.target.value }))}>
                              <option value="">— Select role —</option>
                              {roleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                          </td>
                          <td style={S.td}>
                            <button
                              disabled={!pendingRoleMap[user.id] || saving[user.id]}
                              onClick={() => handleApprove(user)}
                              style={{ ...S.btn("primary"), padding: "7px 18px", fontSize: 12, opacity: (!pendingRoleMap[user.id] || saving[user.id]) ? 0.5 : 1 }}>
                              {saving[user.id] ? "…" : "Approve"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── ALL USERS ── */}
        {activeTab === "users" && (
          <>
            <div style={S.sectionTitle}>All Users</div>
            <div style={{ ...S.sectionSub, marginBottom: 24 }}>Manage roles for active users.</div>
            <div style={S.card}>
              {activeUsers.length === 0 ? (
                <div style={{ textAlign: "center", color: "#94a3b8", padding: "50px 0", fontSize: 13 }}>No active users yet.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Email</th>
                        <th style={S.th}>Name</th>
                        <th style={S.th}>Current Role</th>
                        <th style={S.th}>Change Role</th>
                        <th style={S.th}></th>
                        <th style={S.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeUsers.map(user => {
                        const isSelf = user.id === currentUser?.uid;
                        const selected = userRoleMap[user.id] ?? user.role ?? "";
                        const hasChange = selected !== (user.role ?? "");
                        return (
                          <tr key={user.id}
                            onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            <td style={{ ...S.td, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                              {user.email}
                              {isSelf && <span style={{ marginLeft: 8, fontSize: 10, color: "#059669", fontFamily: "'Inter', sans-serif", fontWeight: 700 }}>YOU</span>}
                            </td>
                            <td style={S.td}>{user.displayName || "—"}</td>
                            <td style={S.td}>
                              {user.role
                                ? <span style={S.badge("#3b82f6")}>{roles.find(r => r.key === user.role)?.name || user.role}</span>
                                : <span style={S.badge("#94a3b8")}>No Role</span>}
                            </td>
                            <td style={S.td}>
                              <select
                                style={{ ...S.select, width: 180, padding: "8px 12px", fontSize: 12, opacity: isSelf ? 0.35 : 1 }}
                                disabled={isSelf}
                                value={selected}
                                onChange={e => setUserRoleMap(m => ({ ...m, [user.id]: e.target.value }))}>
                                {roleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                              </select>
                            </td>
                            <td style={S.td}>
                              <button
                                disabled={!hasChange || isSelf || saving[user.id]}
                                onClick={() => handleRoleChange(user)}
                                style={{ ...S.btn("primary"), padding: "7px 18px", fontSize: 12, opacity: (!hasChange || isSelf || saving[user.id]) ? 0.35 : 1 }}>
                                {saving[user.id] ? "…" : "Save"}
                              </button>
                            </td>
                            <td style={S.td}>
                              <button
                                disabled={isSelf || saving[user.id + "_revoke"]}
                                onClick={() => handleRevoke(user)}
                                style={{ ...S.btn("danger"), padding: "7px 18px", fontSize: 12, opacity: (isSelf || saving[user.id + "_revoke"]) ? 0.35 : 1 }}>
                                {saving[user.id + "_revoke"] ? "…" : "Revoke"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── ROLES & ACCESS ── */}
        {activeTab === "roles" && (
          <>
            <div style={S.sectionTitle}>Roles & Access</div>
            <div style={{ ...S.sectionSub, marginBottom: 24 }}>
              Toggle page access per role. Changes apply immediately for all users on that role.
            </div>

            {roles.map(role => (
              <div key={role.id} style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 15, color: "#0f172a" }}>{role.name}</span>
                    <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: "#94a3b8" }}>{role.key}</span>
                    {role.isSystem && <span style={S.badge("#94a3b8")}>System</span>}
                  </div>
                  {!role.isSystem && (
                    <button onClick={() => handleDeleteRole(role)}
                      style={{ ...S.btn("danger"), padding: "5px 14px", fontSize: 11 }}>Delete</button>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {ALL_PAGES.map(p => (
                    <PageToggle
                      key={p.key}
                      pageKey={p.key}
                      label={p.label}
                      checked={(role.pages || []).includes(p.key)}
                      onClick={() => handleTogglePage(role.id, p.key, role.pages || [])}
                    />
                  ))}
                </div>
              </div>
            ))}

            <div style={{ ...S.card, border: "1px dashed #e2e8f0" }}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 14, color: "#0f172a", marginBottom: 18 }}>
                Create New Role
              </div>
              <div style={{ marginBottom: 18 }}>
                <label style={labelStyle}>Role Name</label>
                <input
                  style={{ ...S.input, maxWidth: 320 }}
                  placeholder="e.g. Operations Lead"
                  value={newRoleName}
                  onChange={e => setNewRoleName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCreateRole()}
                />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={labelStyle}>Page Access</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {ALL_PAGES.map(p => (
                    <PageToggle
                      key={p.key}
                      pageKey={p.key}
                      label={p.label}
                      checked={newRolePages.includes(p.key)}
                      onClick={() => setNewRolePages(ps =>
                        ps.includes(p.key) ? ps.filter(k => k !== p.key) : [...ps, p.key]
                      )}
                    />
                  ))}
                </div>
              </div>
              <button onClick={handleCreateRole}
                style={{ ...S.btn("primary"), padding: "10px 24px", fontSize: 13 }}>
                Create Role
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
