import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { syncGoogleConnections } from "@/lib/google/sync";

export const maxDuration = 60;

/**
 * Manual "Sync now" — Admin/Manager only. The cron also triggers this same
 * sync (see app/api/monitoring/cron/route.ts) roughly once a day; this
 * route exists for an immediate re-sync without waiting for that.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(["Admin", "Manager"]);
  if ("error" in auth) return auth.error;

  const websiteId = request.nextUrl.searchParams.get("websiteId") || undefined;
  const service = request.nextUrl.searchParams.get("service") || undefined;

  try {
    const results = await syncGoogleConnections(websiteId, { service });
    return NextResponse.json({
      success: true,
      synced: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Sync failed" }, { status: 500 });
  }
}
