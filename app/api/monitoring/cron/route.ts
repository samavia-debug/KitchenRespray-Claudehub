import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runAndRecordCheck, runAndRecordSecurityCheck } from "@/lib/monitoring/record";
import { syncGoogleConnections } from "@/lib/google/sync";
import { isConnecteamConfigured } from "@/lib/connecteam/client";
import { getConnecteamStatus, syncConnecteamStaff } from "@/lib/connecteam/sync";
import { getVehicleStatus, syncVehicleInspections } from "@/lib/connecteam/vehicles-sync";
import { getPpeStatus, syncPpeRequests } from "@/lib/connecteam/ppe-sync";
import { getScheduleStatus, getTimeClockStatus, getTimeOffStatus, syncSchedule, syncTimeClock, syncTimeOff } from "@/lib/connecteam/time-sync";
import { notifySlack, notifyWhatsApp } from "@/lib/monitoring/notify";
import { sendComplianceAlerts } from "@/lib/compliance/service";

const CONCURRENCY = 5;

// Matches /api/google/sync's own maxDuration — this route can now also run
// a Google sync pass in the same invocation, on the roughly-daily tick
// where connections are stale.
export const maxDuration = 60;
const MAX_DURATION_MS = maxDuration * 1000;
// Skip the Google sync pass entirely (rather than starting it and risking
// a mid-batch cutoff) once less than this much of the budget remains after
// health checks — the per-connection staleness filter means whatever gets
// skipped is simply picked up on a later tick, so skipping cleanly here is
// strictly better than starting a sync that has no real chance to finish.
const MIN_SYNC_BUDGET_MS = 15_000;
// Security scan runs far less often than the health check (every 6h per
// site, not every 30min) — it's cheap per-fetch but there's no value in
// re-scanning a clean site every tick, and this keeps 30+ extra full-page
// fetches from stacking onto every single cron run.
const SECURITY_SCAN_STALE_HOURS = 6;
const MIN_SECURITY_BUDGET_MS = 10_000;
const CONNECTEAM_STALE_HOURS = 20;
const VEHICLES_STALE_HOURS = 3;
const PPE_STALE_HOURS = 3;
const TIME_STALE_HOURS = 3;
// "Who's working right now" and late arrivals need fresh clock-ins, so the
// clock and rota refresh on every 30 minute tick (the check is 24 minutes so
// a tick that lands a little early still counts as due).
const LIVE_STALE_HOURS = 0.4;
// The very first time-clock sync reads over a year of history, so give it more room.
const MIN_TIME_BUDGET_MS = 25_000;
const MIN_CONNECTEAM_BUDGET_MS = 10_000;

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
      const syncResults = await syncGoogleConnections(undefined, { onlyStaleHours: 20 });
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

  // Staff data changes rarely, so Connecteam is re-synced about daily. Its
  // own try/catch keeps a Connecteam problem (expired key, API outage) from
  // ever affecting the health checks or Google sync above.
  let connecteamSync: { synced?: number; error?: string; skipped?: string } = { skipped: "not connected" };
  if (isConnecteamConfigured()) {
    try {
      const status = await getConnecteamStatus();
      const ageHours = status.lastSyncedAt ? (Date.now() - new Date(status.lastSyncedAt).getTime()) / 3_600_000 : Infinity;
      if (ageHours < CONNECTEAM_STALE_HOURS) {
        connecteamSync = { skipped: "fresh" };
      } else if (MAX_DURATION_MS - (Date.now() - cronStart) < MIN_CONNECTEAM_BUDGET_MS) {
        connecteamSync = { skipped: "out of time budget" };
      } else {
        const result = await syncConnecteamStaff();
        connecteamSync = { synced: result.total };
      }
    } catch (err: any) {
      connecteamSync = { error: err.message };
    }
  }

  // Vehicle inspections arrive through the week and "who hasn't submitted"
  // is only useful if fairly current, so this refreshes every few hours.
  let vehiclesSync: { synced?: number; error?: string; skipped?: string } = { skipped: "not connected" };
  if (isConnecteamConfigured()) {
    try {
      const status = await getVehicleStatus();
      const ageHours = status.lastSyncedAt ? (Date.now() - new Date(status.lastSyncedAt).getTime()) / 3_600_000 : Infinity;
      if (ageHours < VEHICLES_STALE_HOURS) {
        vehiclesSync = { skipped: "fresh" };
      } else if (MAX_DURATION_MS - (Date.now() - cronStart) < MIN_CONNECTEAM_BUDGET_MS) {
        vehiclesSync = { skipped: "out of time budget" };
      } else {
        const result = await syncVehicleInspections();
        vehiclesSync = { synced: result.total };
      }
    } catch (err: any) {
      vehiclesSync = { error: err.message };
    }
  }

  // Tools & PPE requests: the manager marks them Done in Connecteam, so a
  // fairly frequent refresh keeps "what is still open" honest.
  let ppeSync: { synced?: number; error?: string; skipped?: string } = { skipped: "not connected" };
  if (isConnecteamConfigured()) {
    try {
      const status = await getPpeStatus();
      const ageHours = status.lastSyncedAt ? (Date.now() - new Date(status.lastSyncedAt).getTime()) / 3_600_000 : Infinity;
      if (ageHours < PPE_STALE_HOURS) {
        ppeSync = { skipped: "fresh" };
      } else if (MAX_DURATION_MS - (Date.now() - cronStart) < MIN_CONNECTEAM_BUDGET_MS) {
        ppeSync = { skipped: "out of time budget" };
      } else {
        const result = await syncPpeRequests();
        ppeSync = { synced: result.total };
      }
    } catch (err: any) {
      ppeSync = { error: err.message };
    }
  }

  // Time clock and time off: "who forgot to clock out" and "who's off today"
  // are only useful when current, so these also refresh every few hours.
  let timeClockSync: { synced?: number; error?: string; skipped?: string } = { skipped: "not connected" };
  if (isConnecteamConfigured()) {
    try {
      const status = await getTimeClockStatus();
      const ageHours = status.lastSyncedAt ? (Date.now() - new Date(status.lastSyncedAt).getTime()) / 3_600_000 : Infinity;
      if (ageHours < LIVE_STALE_HOURS) {
        timeClockSync = { skipped: "fresh" };
      } else if (MAX_DURATION_MS - (Date.now() - cronStart) < MIN_TIME_BUDGET_MS) {
        timeClockSync = { skipped: "out of time budget" };
      } else {
        const result = await syncTimeClock();
        timeClockSync = { synced: result.shifts };
      }
    } catch (err: any) {
      timeClockSync = { error: err.message };
    }
  }

  let scheduleSync: { synced?: number; error?: string; skipped?: string } = { skipped: "not connected" };
  if (isConnecteamConfigured()) {
    try {
      const status = await getScheduleStatus();
      const ageHours = status.lastSyncedAt ? (Date.now() - new Date(status.lastSyncedAt).getTime()) / 3_600_000 : Infinity;
      if (ageHours < LIVE_STALE_HOURS) {
        scheduleSync = { skipped: "fresh" };
      } else if (MAX_DURATION_MS - (Date.now() - cronStart) < MIN_TIME_BUDGET_MS) {
        scheduleSync = { skipped: "out of time budget" };
      } else {
        const result = await syncSchedule();
        scheduleSync = { synced: result.shifts };
      }
    } catch (err: any) {
      scheduleSync = { error: err.message };
    }
  }

  let timeOffSync: { synced?: number; error?: string; skipped?: string } = { skipped: "not connected" };
  if (isConnecteamConfigured()) {
    try {
      const status = await getTimeOffStatus();
      const ageHours = status.lastSyncedAt ? (Date.now() - new Date(status.lastSyncedAt).getTime()) / 3_600_000 : Infinity;
      if (ageHours < TIME_STALE_HOURS) {
        timeOffSync = { skipped: "fresh" };
      } else if (MAX_DURATION_MS - (Date.now() - cronStart) < MIN_TIME_BUDGET_MS) {
        timeOffSync = { skipped: "out of time budget" };
      } else {
        const result = await syncTimeOff();
        timeOffSync = { synced: result.requests };
      }
    } catch (err: any) {
      timeOffSync = { error: err.message };
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
    connecteamSync,
    vehiclesSync,
    ppeSync,
    timeClockSync,
    scheduleSync,
    timeOffSync,
    complianceAlerts,
  });
}

export async function GET(request: NextRequest) {
  return runCron(request);
}

export async function POST(request: NextRequest) {
  return runCron(request);
}
