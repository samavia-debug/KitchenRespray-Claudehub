"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ChangePasswordForm from "../change-password-form";

/** Everyone's own account: who they are signed in as, and their password. Open to every role, unlike Settings. */
export default function AccountPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email ?? null);
      const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setRole(data?.role ?? null);
    }
    load();
  }, []);

  return (
    <>
      <div className="page-header">
        <h1>My account</h1>
        <p>
          {email ? (
            <>
              Signed in as <strong>{email}</strong>
              {role ? ` (${role})` : ""}.
            </>
          ) : (
            "Your sign-in details."
          )}
        </p>
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <h2>Change my password</h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.88rem", color: "var(--muted)" }}>
          Choose something only you know. If you have forgotten it, sign out and use <em>Forgot password?</em> on the sign-in page, or ask an Admin to reset it.
        </p>
        <ChangePasswordForm email={email} />
      </div>
    </>
  );
}
