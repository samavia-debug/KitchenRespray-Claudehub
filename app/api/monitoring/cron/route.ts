import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runAndRecordCheck, runAndRecordSecurityCheck } from "@/lib/monitoring/record";
import { syncGoogleConnections } from "@/lib/google/sync";
import { isConnecteamConfigured } from "@/lib/connecteam/client";
import { notifySlack, notifyWhatsApp } from "@/lib/monitoring/notify";
import { sendComplianceAlerts } from "@/lib/compliance/service";
import { bookingsWriteEnabled, graphConfig } from "@/lib/bookings/config";
import { bookingsRanRecently, runBookingsSync } from "@/lib/bookings/service";

const CONCURRENCY = 5;
// Health checks are all network waits on different sites, so more of them can run side by side.
const CHECK_CONCURRENCY = 10;

// The scheduler (cron-job.org) stops waiting after 30 seconds, so this tick keeps itself to about 24. Every
// stage below is picked up where it left off on the next tick (each site, scan and connection has its own
// "last done" time), so running out of budget only means a little work is left for later. The Connecteam
// syncs have their own tick at /api/connecteam/cron so they do not compete for this time.
export const maxDuration = 60;
const MAX_DURATION_MS = 24_000;
// Skip the security scan once less than this much of the budget remains (a batch can take 15 s).
const SECURITY_SCAN_STALE_HOURS = 6;
const MIN_SECURITY_BUDGET_MS = 10_000;
// A batch of health checks (a site can take 10 s to answer) is only started with this much left.
const MIN_CHECK_BATCH_BUDGET_MS = 8_000;
// The Google pass starts with at least this much left, and stops starting new batches shortly before the end.
const MIN_SYNC_BUDGET_MS = 8_000;
const GOOGLE_STOP_MARGIN_MS = 4_000;
// The appointment copy is light, so it only needs a little room.
const MIN_BOOKINGS_BUDGET_MS = 8_000;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Scheduled tick for every active website — triggered by an external
 * scheduler (cron-job.org) hitting this route with the CRON_SECRET bearer
 * token. Runs website health checks with bounded concurrency, only for
 * sites whose own monitoring_interval has actually elapsed; a security
 * scan pass (site-hijack detection) for connections stale by
 * SECURITY_SCAN_STALE_HOURS; then a Google Analytics/Search Console sync
 * pass for whichever connections are stale (see syncGoogleConnections
 * above).
 */
async function runCron(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const cronStart = Date.now();
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
  // Longest-unchecked first, so if the budget runs out it is always the most recently checked sites that wait.
  const due = (websites || [])
    .filter((w) => {
      const last = lastCheckedMap.get(w.id);
      if (!last) return true;
      const elapsedMinutes = (now - new Date(last).getTime()) / 60_000;
      return elapsedMinutes >= w.monitoring_interval_minutes;
    })
    .sort((a, b) => (lastCheckedMap.get(a.id) ?? "").localeCompare(lastCheckedMap.get(b.id) ?? ""));

  const results: { domain: string; ok: boolean; error?: string }[] = [];

  for (let i = 0; i < due.length; i += CHECK_CONCURRENCY) {
    if (i > 0 && MAX_DURATION_MS - (Date.now() - cronStart) < MIN_CHECK_BATCH_BUDGET_MS) break;
    const batch = due.slice(i, i + CHECK_CONCURRENCY);
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

  // Security scan: same per-site staleness gating as Google sync, on its
  // own longer interval (see SECURITY_SCAN_STALE_HOURS above).
  const { data: securityChecks } = await service.from("website_security_checks").select("website_id, checked_at");
  const securityCheckedMap = new Map<string, string>((securityChecks || []).map((c: any) => [c.website_id, c.checked_at]));

  const securityDue = (websites || []).filter((w) => {
    const last = securityCheckedMap.get(w.id);
    if (!last) return true;
    const elapsedHours = (now - new Date(last).getTime()) / 3_600_000;
    return elapsedHours >= SECURITY_SCAN_STALE_HOURS;
  });

  const securityResults: { domain: string; ok: boolean; riskLevel?: string; error?: string }[] = [];
  const securityTimeRemainingMs = MAX_DURATION_MS - (Date.now() - cronStart);

  if (securityTimeRemainingMs >= MIN_SECURITY_BUDGET_MS) {
    for (let i = 0; i < securityDue.length; i += CONCURRENCY) {
      if (MAX_DURATION_MS - (Date.now() - cronStart) < MIN_SECURITY_BUDGET_MS) break;

      const batch = securityDue.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(batch.map((w) => runAndRecordSecurityCheck(w.id, w.domain)));

      batchResults.forEach((result, idx) => {
        const domain = batch[idx].domain;
        if (result.status === "fulfilled") {
          securityResults.push({ domain, ok: true, riskLevel: (result.value as any)?.risk_level });
        } else {
          securityResults.push({ domain, ok: false, error: String(result.reason) });
        }
      });
    }
  }

  // GA4/Search Console data itself only updates a few times a day, so each
  // connection is only re-synced once its own last_synced_at is 20+ hours
  // old (or was never set) — most ticks find nothing stale and no-op.
  // Staleness is tracked per connection rather than gated on one global
  // "last sync" check, so a run cut short by a function timeout partway
  // through 50+ connections doesn't leave the rest stuck stale for a full
  // day — whatever didn't get reached is still stale next tick.
  let googleSync: { synced: number; failed: number; error?: string; skipped?: boolean };
  const timeRemainingMs = MAX_DURATION_MS - (Date.now() - cronStart);

  if (timeRemainingMs < MIN_SYNC_BUDGET_MS) {
    googleSync = { synced: 0, failed: 0, skipped: true };
  } else {
    try {
      const syncResults = await syncGoogleConnections(undefined, { onlyStaleHours: 20, stopAt: cronStart + MAX_DURATION_MS - GOOGLE_STOP_MARGIN_MS });
      const synced = syncResults.filter((r) => r.ok).length;
      const failed = syncResults.filter((r) => !r.ok).length;
      googleSync = { synced, failed };

      // A total outage (every attempted connection failed, e.g. Google's
      // OAuth endpoint down or every token revoked at once) is exactly the
      // kind of thing that should surface the same way a website incident
      // does — otherwise it's invisible until someone happens to notice
      // stale numbers on the dashboard days later.
      if (syncResults.length > 0 && failed === syncResults.length) {
        const message = `🔴 *Google sync failing* — all ${failed} connection(s) attempted this run failed. Analytics/Search Console data is not updating.`;
        await Promise.all([notifySlack(message), notifyWhatsApp(message)]);
      }
    } catch (err: any) {
      googleSync = { synced: 0, failed: 0, error: err.message };
      const message = `🔴 *Google sync failed* — ${err.message}. Analytics/Search Console data is not updating.`;
      await Promise.all([notifySlack(message), notifyWhatsApp(message)]);
    }
  }

  // Website appointments into the Showroom Appointment calendar. Dormant until the Microsoft
  // credentials are set AND writing has been switched on, so it does nothing by default.
  // It runs BEFORE the heavier Connecteam syncs: it is quick (one Microsoft read and a few
  // Connecteam calls), and when it sat at the end the clock and rota syncs used up the time
  // budget first, so new bookings were skipped tick after tick.
  let bookingsSync: { state?: string; counts?: unknown; errors?: number; held?: number; error?: string; skipped?: string } = { skipped: "not switched on" };
  if (graphConfig() && bookingsWriteEnabled() && isConnecteamConfigured()) {
    if (MAX_DURATION_MS - (Date.now() - cronStart) < MIN_BOOKINGS_BUDGET_MS) {
      bookingsSync = { skipped: "out of time budget" };
    } else if (await bookingsRanRecently(10).catch(() => false)) {
      // The dedicated short tick (every few minutes) has just done it.
      bookingsSync = { skipped: "ran in the last 10 minutes" };
    } else {
      try {
        const r = await runBookingsSync({ apply: true });
        bookingsSync = { state: r.state, counts: r.counts, errors: r.errors.length, held: r.held.length, ...(r.state === "error" ? { error: r.message } : {}) };
      } catch (err: any) {
        bookingsSync = { error: err.message };
      }
    }
  }

  // Expiry warnings go out in working hours only, so nobody is woken for a licence that runs out next month.
  let complianceAlerts: { sent?: number; error?: string; skipped?: string } = { skipped: "outside working hours" };
  const dublinHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", hourCycle: "h23" }).format(Date.now()));
  if (dublinHour >= 7 && dublinHour < 19) {
    try {
      const result = await sendComplianceAlerts();
      complianceAlerts = result.skipped ? { skipped: result.skipped } : { sent: result.sent };
    } catch (err: any) {
      // The register table may not exist yet (migration not run); that is not a cron failure.
      complianceAlerts = { error: err.message };
    }
  }

  return NextResponse.json({
    checkedCount: results.length,
    skippedCount: (websites?.length || 0) - due.length,
    results,
    securityScanned: securityResults.length,
    securitySkipped: securityDue.length - securityResults.length,
    securityResults,
    googleSync,
    complianceAlerts,
    bookingsSync,
  });
}

export async function GET(request: NextRequest) {
  return runCron(request);
}

export async function POST(request: NextRequest) {
  return runCron(request);
}
