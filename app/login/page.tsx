"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Reading the address (for the "password changed" and "link expired" notes) needs a Suspense boundary on a page that is built ahead of time.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>KitchenRespray Hub</h1>
        <p className="subtitle">Sign in to your team dashboard</p>
        {params.get("reset") === "done" && <p style={{ fontSize: "0.9rem" }}>Your password has been changed. Sign in with the new one.</p>}
        {params.get("error") === "link" && <p className="error-text">That link has expired or was already used. Ask for a new one below.</p>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <button className="btn" type="submit" disabled={loading} style={{ width: "100%", marginTop: "0.5rem" }}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p style={{ marginTop: "1rem", fontSize: "0.85rem", textAlign: "center" }}>
          <Link href="/forgot-password">Forgot password?</Link>
        </p>
      </div>
    </div>
  );
}
