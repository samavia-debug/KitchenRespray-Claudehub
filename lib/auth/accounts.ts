import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

/** Whether `password` is the right current password for this email. A throwaway client is used so it never touches anyone's session. */
export async function verifyPassword(email: string, password: string): Promise<boolean> {
  const client = createPlainClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) return false;
  // The sign-in only proved the password; nothing more is wanted from the session it made.
  await client.auth.signOut().catch(() => undefined);
  return true;
}

/** Sets a person's password. The detail of a failure goes to the log; the caller shows a plain message. */
export async function setUserPassword(userId: string, password: string): Promise<boolean> {
  const { error } = await createServiceClient().auth.admin.updateUserById(userId, { password });
  if (error) console.error("[auth] could not set a password:", error.message);
  return !error;
}
