/**
 * Shared aggregation helpers for the Google Analytics / Search Console
 * dashboard pages and the Claude analysis prompt builder — previously
 * copy-pasted independently across 6+ files, which is how the "connected
 * site" bug and the 7-day window boundary bug (below) escaped: the
 * correct version existed in one file and was never propagated to the
 * others. One source of truth from here on.
 */

export function sum(values: (number | null)[]): number {
  return values.reduce((total: number, v) => total + (v || 0), 0);
}

export function avg(values: (number | null)[]): number | null {
  const nonNull = values.filter((v): v is number => v !== null);
  return nonNull.length ? nonNull.reduce((a, b) => a + b, 0) / nonNull.length : null;
}

/** null when there's no prior-period data to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** ISO date string (YYYY-MM-DD) `days` days before now — for Supabase `.gte("date", ...)` query lower bounds. */
export function sinceDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Splits date-keyed rows into two adjacent, non-overlapping `days`-day
 * windows: `current` (today back through `days - 1` days ago, inclusive —
 * exactly `days` calendar dates) and `previous` (the `days` calendar
 * dates immediately before that). Query the source table with
 * `sinceDaysAgo(days * 2 - 1)` or wider to have enough rows for both.
 *
 * The naive version of this (`date >= sinceDaysAgo(days)` for "current")
 * is off by one: since today is also `>= sinceDaysAgo(days)`, that
 * window actually spans `days + 1` calendar dates while "previous" spans
 * exactly `days` — silently inflating every % change figure for any site
 * with steady traffic. This version keeps both windows the same width.
 */
export function splitLastNDays<T extends { date: string }>(
  rows: T[],
  days: number = 7
): { current: T[]; previous: T[] } {
  const currentStart = sinceDaysAgo(days - 1);
  const previousStart = sinceDaysAgo(days * 2 - 1);
  return {
    current: rows.filter((r) => r.date >= currentStart),
    previous: rows.filter((r) => r.date < currentStart && r.date >= previousStart),
  };
}

/**
 * Union of website_ids present in any of the given row sets — the
 * correct way to infer "connected/synced" from analytics_metrics /
 * search_console_metrics (which have authenticated read access) instead
 * of querying google_connections directly (service-role only, holds raw
 * OAuth tokens, no RLS policy for authenticated at all).
 *
 * Deliberately based on row PRESENCE, not on any metric value being
 * non-zero — a site with real zero sessions/clicks/conversions in the
 * window is still connected and should still show up, just with a
 * genuine zero. Checking `sessions > 0 || ...` instead of presence was
 * the exact bug this function replaces.
 */
export function getConnectedWebsiteIds(...rowSets: { website_id: string }[][]): Set<string> {
  const ids = new Set<string>();
  for (const rows of rowSets) {
    for (const r of rows) ids.add(r.website_id);
  }
  return ids;
}
