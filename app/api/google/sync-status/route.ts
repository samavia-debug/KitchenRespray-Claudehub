import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Just the oldest Google connection's last_synced_at, for the sidebar's
 * freshness dot — google_connections itself has no RLS policy for
 * authenticated users at all (it holds raw OAuth tokens, service-role
 * only by design), so the sidebar can't query it directly. This route
 * exposes only the one timestamp that's actually needed, via the
 * service-role client, without exposing the table itself to the browser.
 */
export async function GET() {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("google_connections")
    .select("last_synced_at")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(1);

  return NextResponse.json({ oldestSyncAt: data?.[0]?.last_synced_at ?? null });
}
