import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runAndRecordCheck } from "@/lib/monitoring/record";
import { syncGoogleConnections } from "@/lib/google/sync";

const CONCURRENCY = 5;

// Matches /api/google/sync's own maxDuration — this route can now also run
// a Google sync pass in the same invocation, on the roughly-daily tick
// where connections are stale.
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Scheduled tick for every active website — triggered by an external
 * scheduler (cron-job.org) hitting this route with the CRON_SECRET bearer
 * token. Runs website health checks with bounded concurrency, only for
 * sites whose own monitoring_interval has actually elapsed, then a Google
 * Analytics/Search Console sync pass for whichever connections are stale
 * (see syncGoogleConnections above).
 */
async function runCron(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: websites, error } = await service
    .from("websites")
    .select("id, domain, monitoring_interval_minutes")
    .eq("is_active", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: latestChecks } = await service
    .from("website_latest_check")
    .select("website_id, checked_at");

  const lastCheckedMap = new Map<string, string>(
    (latestChecks || []).map((c: any) => [c.website_id, c.checked_at])
  );

  const now = Date.now();
  const due = (websites || []).filter((w) => {
    const last = lastCheckedMap.get(w.id);
    if (!last) return true;
    const elapsedMinutes = (now - new Date(last).getTime()) / 60_000;
    return elapsedMinutes >= w.monitoring_interval_minutes;
  });

  const results: { domain: string; ok: boolean; error?: string }[] = [];

  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const batch = due.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((w) => runAndRecordCheck(w.id, w.domain))
    );

    batchResults.forEach((result, idx) => {
      const domain = batch[idx].domain;
      if (result.status === "fulfilled") {
        results.push({ domain, ok: true });
      } else {
        results.push({ domain, ok: false, error: String(result.reason) });
      }
    });
  }

  // GA4/Search Console data itself only updates a few times a day, so each
  // connection is only re-synced once its own last_synced_at is 20+ hours
  // old (or was never set) — most ticks find nothing stale and no-op.
  // Staleness is tracked per connection rather than gated on one global
  // "last sync" check, so a run cut short by a function timeout partway
  // through 50+ connections doesn't leave the rest stuck stale for a full
  // day — whatever didn't get reached is still stale next tick.
  let googleSync: { synced: number; failed: number; error?: string };
  try {
    const syncResults = await syncGoogleConnections(undefined, { onlyStaleHours: 20 });
    googleSync = {
      synced: syncResults.filter((r) => r.ok).length,
      failed: syncResults.filter((r) => !r.ok).length,
    };
  } catch (err: any) {
    googleSync = { synced: 0, failed: 0, error: err.message };
  }

  return NextResponse.json({
    checkedCount: results.length,
    skippedCount: (websites?.length || 0) - due.length,
    results,
    googleSync,
  });
}

export async function GET(request: NextRequest) {
  return runCron(request);
}

export async function POST(request: NextRequest) {
  return runCron(request);
}
