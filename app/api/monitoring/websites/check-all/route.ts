import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { runAndRecordCheck } from "@/lib/monitoring/record";

const CONCURRENCY = 10;

// Vercel Hobby caps serverless functions at 10s regardless of this setting —
// checking 60+ sites will likely exceed that and get cut off partway
// through (already-recorded checks stay recorded, it just doesn't finish
// the batch). Pro plan honors this up to 60s. Run from `npm run dev`
// locally, or upgrade, if you need the full batch to reliably complete.
export const maxDuration = 60;

/**
 * Manual "Check all websites now" — Admin/Manager only. Unlike the cron
 * route, this ignores each site's monitoring_interval and checks every
 * active site immediately; it exists specifically for the case where a
 * site was just added (or a fresh install has never been checked at all)
 * and someone wants real data on the dashboard right now instead of
 * waiting for the next scheduled run.
 */
export async function POST() {
  const auth = await requireRole(["Admin", "Manager"]);
  if ("error" in auth) return auth.error;

  const supabase = createClient();
  const { data: websites, error } = await supabase
    .from("websites")
    .select("id, domain")
    .eq("is_active", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { domain: string; ok: boolean; error?: string }[] = [];
  const list = websites || [];

  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map((w) => runAndRecordCheck(w.id, w.domain)));

    batchResults.forEach((result, idx) => {
      const domain = batch[idx].domain;
      if (result.status === "fulfilled") {
        results.push({ domain, ok: true });
      } else {
        results.push({ domain, ok: false, error: String(result.reason) });
      }
    });
  }

  return NextResponse.json({ checkedCount: results.length, totalCount: list.length, results });
}
