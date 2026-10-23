"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { checkPassword } from "@/lib/auth/password-policy";
import { createClient } from "@/lib/supabase/client";

/** Where the link in a password-reset email lands: the person is already signed in by the link, and chooses a new password. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        setEmail(data.user?.email ?? null);
        setReady(true);
      });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const checked = checkPassword(next, email);
    if ("error" in checked) return setError(checked.error);
    if (next !== again) return setError("The two passwords are not the same");

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: checked.value });
    if (error) {
      setBusy(false);
      return setError(/same|different/i.test(error.message) ? "Choose a password you have not used before" : "Could not set the password. Please ask for a new link and try again.");
    }
    // The reset link has done its job: sign out so the new password is what is used from now on.
    await supabase.auth.signOut();
    router.push("/login?reset=done");
  }

  const type = show ? "text" : "password";
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Choose a new password</h1>
        {!ready && <p className="subtitle">One moment...</p>}
        {ready && !email && (
          <>
            <p className="subtitle">This link has expired or was already used. Reset links only work once, and only in the browser you asked from.</p>
            <p style={{ fontSize: "0.9rem" }}>
              <Link href="/forgot-password">Ask for a new link</Link>
            </p>
          </>
        )}
        {ready && email && (
          <>
            <p className="subtitle">For {email}</p>
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="new">New password</label>
                <input id="new" type={type} value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required />
              </div>
              <div className="field">
                <label htmlFor="again">New password again</label>
                <input id="again" type={type} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
              </div>
              <label style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
                Show the passwords
              </label>
              {error && <p className="error-text">{error}</p>}
              <button className="btn" type="submit" disabled={busy} style={{ width: "100%", marginTop: "0.5rem" }}>
                {busy ? "Saving..." : "Set new password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
