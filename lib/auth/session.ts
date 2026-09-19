import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type Role = "Admin" | "Manager" | "Staff";

export type SessionProfile = {
  user: { id: string; email?: string };
  profile: { id: string; email: string; role: Role } | null;
};

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, role")
    .eq("id", user.id)
    .single();

  return { user, profile: (profile as SessionProfile["profile"]) ?? null };
}

/**
 * For API routes. Returns the session/profile when the caller is
 * authenticated and holds one of `allowedRoles`, otherwise a ready-to-return
 * NextResponse (401 if not logged in, 403 if wrong role).
 */
export async function requireRole(
  allowedRoles: Role[]
): Promise<{ session: SessionProfile } | { error: NextResponse }> {
  const session = await getSessionProfile();

  if (!session) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  if (!session.profile || !allowedRoles.includes(session.profile.role)) {
    return { error: NextResponse.json({ error: "Not authorized" }, { status: 403 }) };
  }

  return { session };
}
