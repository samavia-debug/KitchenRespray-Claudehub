"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` });
    setBusy(false);
    // Whether or not the address has an account is never shown: the same answer goes to everyone.
    if (error && /rate|too many|seconds/i.test(error.message)) return setError("Please wait a minute before asking for another email.");
    setSent(true);
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Forgot your password?</h1>
        {sent ? (
          <>
            <p className="subtitle">If that email has an account, we have sent a link to choose a new password. It can take a few minutes. Open the link on this same device and browser.</p>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Nothing arrived? Check your spam folder, or ask an Admin to reset it for you.</p>
          </>
        ) : (
          <>
            <p className="subtitle">Enter your work email and we will send you a link to choose a new one.</p>
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn" type="submit" disabled={busy} style={{ width: "100%", marginTop: "0.5rem" }}>
                {busy ? "Sending..." : "Send me a link"}
              </button>
            </form>
          </>
        )}
        <p style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
