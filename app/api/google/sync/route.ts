import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getValidGoogleAccessToken } from "@/lib/google/token";
import { fetchGa4Metrics, fetchSearchConsoleMetrics } from "@/lib/google/metrics";

const CONCURRENCY = 5;
export const maxDuration = 60;

/**
 * Pulls the last 30 days of GA4 (sessions/users/conversions) and Search
 * Console (clicks/impressions/ctr/position) metrics for every connected
 * website and upserts them into analytics_metrics/search_console_metrics.
 * Admin/Manager only, matches the "Check all websites now" pattern —
 * manual trigger for now, cron wiring is a separate follow-up once this
 * is proven to work.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(["Admin", "Manager"]);
  if ("error" in auth) return auth.error;

  const websiteId = request.nextUrl.searchParams.get("websiteId");

  const supabase = createServiceClient();

  let query = supabase.from("google_connections").select("website_id, service, property_id, site_url");
  if (websiteId) query = query.eq("website_id", websiteId);
  const { data: connections, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const list = connections || [];
  const results: { website_id: string; service: string; ok: boolean; days?: number; error?: string }[] = [];

  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (conn) => {
        try {
          const accessToken = await getValidGoogleAccessToken(
            conn.website_id,
            conn.service as "analytics" | "search_console"
          );

          if (conn.service === "analytics") {
            if (!conn.property_id) throw new Error("No property_id set");
            const metrics = await fetchGa4Metrics(accessToken, conn.property_id, 30);
            const rows = metrics.map((m) => ({
              website_id: conn.website_id,
              date: m.date,
              users: m.users,
              sessions: m.sessions,
              conversions: m.conversions,
              synced_at: new Date().toISOString(),
            }));
            if (rows.length) {
              const { error: upsertError } = await supabase
                .from("analytics_metrics")
                .upsert(rows, { onConflict: "website_id,date" });
              if (upsertError) throw new Error(upsertError.message);
            }
            await supabase
              .from("google_connections")
              .update({ last_synced_at: new Date().toISOString() })
              .eq("website_id", conn.website_id)
              .eq("service", conn.service);
            return { website_id: conn.website_id, service: conn.service, ok: true, days: rows.length };
          } else {
            if (!conn.site_url) throw new Error("No site_url set");
            const metrics = await fetchSearchConsoleMetrics(accessToken, conn.site_url, 30);
            const rows = metrics.map((m) => ({
              website_id: conn.website_id,
              date: m.date,
              clicks: m.clicks,
              impressions: m.impressions,
              ctr: m.ctr,
              avg_position: m.avgPosition,
              synced_at: new Date().toISOString(),
            }));
            if (rows.length) {
              const { error: upsertError } = await supabase
                .from("search_console_metrics")
                .upsert(rows, { onConflict: "website_id,date" });
              if (upsertError) throw new Error(upsertError.message);
            }
            await supabase
              .from("google_connections")
              .update({ last_synced_at: new Date().toISOString() })
              .eq("website_id", conn.website_id)
              .eq("service", conn.service);
            return { website_id: conn.website_id, service: conn.service, ok: true, days: rows.length };
          }
        } catch (err: any) {
          return { website_id: conn.website_id, service: conn.service, ok: false, error: err.message };
        }
      })
    );
    results.push(...batchResults);
  }

  return NextResponse.json({
    success: true,
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
