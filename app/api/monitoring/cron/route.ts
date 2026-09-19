import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runAndRecordCheck } from "@/lib/monitoring/record";

const CONCURRENCY = 5;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Scheduled health checker for every active website — triggered by Vercel
 * Cron (see vercel.json). Runs with bounded concurrency so it never hammers
 * client sites, and only checks sites whose own monitoring_interval has
 * actually elapsed since their last check.
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

  return NextResponse.json({
    checkedCount: results.length,
    skippedCount: (websites?.length || 0) - due.length,
    results,
  });
}

export async function GET(request: NextRequest) {
  return runCron(request);
}

export async function POST(request: NextRequest) {
  return runCron(request);
}
