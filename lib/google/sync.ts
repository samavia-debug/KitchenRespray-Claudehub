import { createServiceClient } from "@/lib/supabase/service";
import { getValidGoogleAccessToken } from "./token";
import { fetchGa4Metrics, fetchSearchConsoleMetrics } from "./metrics";
import type { GoogleService } from "./oauth";

const CONCURRENCY = 5;

export type SyncResult = { website_id: string; service: string; ok: boolean; days?: number; error?: string };

/**
 * Pulls the last 30 days of GA4 (sessions/users/conversions) and Search
 * Console (clicks/impressions/ctr/position) metrics into
 * analytics_metrics/search_console_metrics. Shared by the manual "Sync
 * now" API route and the daily cron pass — one implementation, two
 * triggers, so they can't drift out of sync with each other.
 *
 * `onlyStaleHours`, when set, filters to connections whose own
 * last_synced_at is older than that (or null) — used by the cron so each
 * connection's staleness is tracked independently. This makes the cron
 * self-healing: if a run gets cut short by a function timeout partway
 * through 50+ connections, the ones it didn't reach are still stale next
 * tick and get picked up then, rather than the whole batch looking "done
 * for today" just because one connection near the front succeeded.
 * Manual syncs (websiteId set, or no staleness filter) always run
 * regardless of freshness — the user explicitly asked for a fresh pull.
 */
export async function syncGoogleConnections(
  websiteId?: string,
  options?: { onlyStaleHours?: number }
): Promise<SyncResult[]> {
  const supabase = createServiceClient();

  let query = supabase.from("google_connections").select("website_id, service, property_id, site_url, last_synced_at");
  if (websiteId) {
    query = query.eq("website_id", websiteId);
  } else if (options?.onlyStaleHours !== undefined) {
    const cutoff = new Date(Date.now() - options.onlyStaleHours * 3_600_000).toISOString();
    query = query.or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`);
  }
  const { data: connections, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const list = connections || [];
  const results: SyncResult[] = [];

  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (conn): Promise<SyncResult> => {
        try {
          const accessToken = await getValidGoogleAccessToken(conn.website_id, conn.service as GoogleService);

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

  return results;
}
