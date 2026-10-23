"use client";

import { useState } from "react";
import { checkPassword } from "@/lib/auth/password-policy";

/** Change your own password. Anyone signed in can use it; the current password is asked for so a left-open computer cannot be used to lock the owner out. */
export default function ChangePasswordForm({ email }: { email?: string | null }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (!current) return setError("Enter your current password");
    const checked = checkPassword(next, email);
    if ("error" in checked) return setError(checked.error);
    if (next !== again) return setError("The two new passwords are not the same");

    setBusy(true);
    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Could not change the password");
      else {
        setDone(true);
        setCurrent("");
        setNext("");
        setAgain("");
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  const type = show ? "text" : "password";
  return (
    <form onSubmit={submit}>
      <div className="field">
        <label>Current password</label>
        <input type={type} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </div>
      <div className="field">
        <label>New password</label>
        <input type={type} value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
      </div>
      <div className="field">
        <label>New password again</label>
        <input type={type} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
      </div>
      <label style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Show the passwords
      </label>
      {error && <p className="error-text" style={{ marginTop: 0 }}>{error}</p>}
      {done && <p style={{ marginTop: 0, fontSize: "0.9rem" }}>Your password has been changed. Use the new one next time you sign in.</p>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? "Changing..." : "Change password"}
      </button>
    </form>
  );
}
