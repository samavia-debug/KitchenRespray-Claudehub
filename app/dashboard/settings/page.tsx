"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Profile = {
  id: string;
  email: string;
  role: string;
};

const roles = ["Admin", "Manager", "Staff", "Viewer"];

const ROLE_COLOR: Record<string, string> = {
  Admin: "#b5502e",
  Manager: "#97690a",
  Staff: "#2e7d32",
  Viewer: "#6f6a63",
};

const ROLE_DESCRIPTIONS: { role: string; description: string }[] = [
  { role: "Admin", description: "Full access — manage websites, run checks, and manage team members/roles." },
  { role: "Manager", description: "Manage websites and run checks (add/edit sites, trigger scans). Cannot manage team members or change roles." },
  {
    role: "Staff",
    description:
      "Read-only access to all monitored websites today. Per-site assignment (Staff seeing only their assigned sites) is a planned enhancement, not built yet.",
  },
  { role: "Viewer", description: "Read-only access — currently identical to Staff. Kept as a separate role for future tighter restrictions." },
];

export default function SettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("Staff");
  const [adding, setAdding] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [editingEmailValue, setEditingEmailValue] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const [myNewPassword, setMyNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    const canvaStatus = searchParams.get("canva");
    if (canvaStatus === "connected") {
      setMessage("Canva connected successfully.");
    } else if (canvaStatus) {
      const msg = searchParams.get("msg");
      setMessage(`Canva connection failed (${canvaStatus})${msg ? `: ${msg}` : ""}`);
    }
  }, [searchParams]);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      setMyUserId(user.id);

      const { data: myProfile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (myProfile?.role !== "Admin") {
        router.replace("/dashboard");
        return;
      }

      setMyRole(myProfile.role);
      setAuthorized(true);

      const { data: allProfiles } = await supabase
        .from("profiles")
        .select("id, email, role")
        .order("email", { ascending: true });

      if (allProfiles) setProfiles(allProfiles as Profile[]);
      setLoading(false);
    }

    load();
  }, []);

  async function updateRole(id: string, newRoleValue: string) {
    setSavingId(id);
    setMessage(null);

    const { error } = await supabase
      .from("profiles")
      .update({ role: newRoleValue })
      .eq("id", id);

    setSavingId(null);

    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }

    setMessage("Role updated.");
    setProfiles((prev) =>
      prev.map((p) => (p.id === id ? { ...p, role: newRoleValue } : p))
    );
  }

  function startEditingEmail(id: string, currentEmail: string) {
    setEditingEmailId(id);
    setEditingEmailValue(currentEmail);
  }

  async function saveEmail(id: string) {
    if (!editingEmailValue.trim()) {
      setEditingEmailId(null);
      return;
    }

    setSavingId(id);
    setMessage(null);

    const { error } = await supabase
      .from("profiles")
      .update({ email: editingEmailValue.trim() })
      .eq("id", id);

    setSavingId(null);
    setEditingEmailId(null);

    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }

    setMessage("Email updated.");
    setProfiles((prev) =>
      prev.map((p) => (p.id === id ? { ...p, email: editingEmailValue.trim() } : p))
    );
  }

  async function handleDelete(id: string, email: string) {
    if (!confirm(`Remove ${email}? This deletes their login and access completely.`)) {
      return;
    }

    setDeletingId(id);
    setMessage(null);
    setTempPassword(null);

    try {
      const res = await fetch("/api/admin/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(`Error: ${data.error || "Could not remove team member"}`);
      } else {
        setMessage("Team member removed.");
        setProfiles((prev) => prev.filter((p) => p.id !== id));
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }

    setDeletingId(null);
  }

  async function handleResetPassword(id: string, email: string) {
    if (!confirm(`Reset password for ${email}? A new temporary password will be generated.`)) {
      return;
    }

    setResettingId(id);
    setMessage(null);
    setTempPassword(null);

    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(`Error: ${data.error || "Could not reset password"}`);
      } else {
        setTempPassword(data.tempPassword);
        setMessage(`Password reset for ${email}.`);
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }

    setResettingId(null);
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();

    if (!newEmail.trim()) {
      setMessage("Please enter an email address.");
      return;
    }

    setAdding(true);
    setMessage(null);
    setTempPassword(null);

    try {
      const res = await fetch("/api/admin/invite-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(`Error: ${data.error || "Could not add team member"}`);
      } else {
        setTempPassword(data.tempPassword);
        setMessage(`Team member added.`);
        setNewEmail("");
        setNewRole("Staff");

        const { data: allProfiles } = await supabase
          .from("profiles")
          .select("id, email, role")
          .order("email", { ascending: true });

        if (allProfiles) setProfiles(allProfiles as Profile[]);
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }

    setAdding(false);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();

    if (!myNewPassword || myNewPassword.length < 8) {
      setMessage("New password must be at least 8 characters.");
      return;
    }

    setChangingPassword(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: myNewPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(`Error: ${data.error || "Could not change password"}`);
      } else {
        setMessage("Password changed successfully.");
        setMyNewPassword("");
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }

    setChangingPassword(false);
  }

  if (loading || !authorized) {
    return (
      <>
        <div className="page-header">
          <h1>Settings</h1>
        </div>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
        <p>
          Account and team settings.
          {myRole && (
            <>
              {" "}
              Signed in as{" "}
              <span
                className="status-badge"
                style={{ background: `${ROLE_COLOR[myRole]}1a`, color: ROLE_COLOR[myRole] }}
              >
                {myRole}
              </span>
              .
            </>
          )}
        </p>
      </div>

      {message && (
        <div
          className="card"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
          }}
        >
          {message}
        </div>
      )}

      {tempPassword && (
        <div
          className="card"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
          }}
        >
          <strong>Temporary password:</strong> {tempPassword}
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
            Share this with the team member now — it won't be shown again. They can change it after logging in.
          </p>
        </div>
      )}

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2>Canva connection</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          Connect your Canva account so the dashboard can create designs on your behalf.
        </p>
        <a href="/api/canva/connect" className="btn">
          Connect to Canva
        </a>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2>Change my password</h2>
        <form onSubmit={handleChangePassword}>
          <div className="field">
            <label>New password</label>
            <input
              type="password"
              value={myNewPassword}
              onChange={(e) => setMyNewPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <button className="btn" type="submit" disabled={changingPassword}>
            {changingPassword ? "Changing..." : "Change password"}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2>Add team member</h2>
        <form onSubmit={handleAddUser}>
          <div className="grid-2">
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn" type="submit" disabled={adding}>
            {adding ? "Adding..." : "Add team member"}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2>Role permissions</h2>
        {ROLE_DESCRIPTIONS.map(({ role, description }) => (
          <div key={role} style={{ display: "flex", gap: "0.75rem", padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
            <span
              className="status-badge"
              style={{ background: `${ROLE_COLOR[role]}1a`, color: ROLE_COLOR[role], flexShrink: 0, minWidth: "5.5rem", justifyContent: "center" }}
            >
              {role}
            </span>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>{description}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Team members</h2>

        {profiles.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.85rem 0",
              borderBottom: "1px solid var(--border)",
              gap: "0.6rem",
              flexWrap: "wrap",
            }}
          >
            {editingEmailId === p.id ? (
              <input
                type="email"
                value={editingEmailValue}
                onChange={(e) => setEditingEmailValue(e.target.value)}
                onBlur={() => saveEmail(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEmail(p.id);
                }}
                autoFocus
                style={{ fontSize: "0.9rem", flex: 1 }}
              />
            ) : (
              <span
                style={{ fontSize: "0.9rem", cursor: "pointer" }}
                onClick={() => startEditingEmail(p.id, p.email)}
                title="Click to edit"
              >
                {p.email}
              </span>
            )}

            <select
              value={p.role}
              onChange={(e) => updateRole(p.id, e.target.value)}
              disabled={savingId === p.id}
              style={{ maxWidth: "160px", borderColor: ROLE_COLOR[p.role] || undefined, color: ROLE_COLOR[p.role] || undefined, fontWeight: 600 }}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            {p.id !== myUserId && (
              <>
                <button
                  className="btn-secondary btn"
                  style={{ fontSize: "0.8rem", padding: "0.4rem 0.7rem" }}
                  onClick={() => handleResetPassword(p.id, p.email)}
                  disabled={resettingId === p.id}
                >
                  {resettingId === p.id ? "Resetting..." : "Reset password"}
                </button>
                <button
                  className="btn-secondary btn"
                  style={{ fontSize: "0.8rem", padding: "0.4rem 0.7rem" }}
                  onClick={() => handleDelete(p.id, p.email)}
                  disabled={deletingId === p.id}
                >
                  {deletingId === p.id ? "Removing..." : "Delete"}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
