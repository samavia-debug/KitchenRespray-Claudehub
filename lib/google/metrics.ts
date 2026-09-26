export type Ga4DailyMetric = {
  date: string; // YYYY-MM-DD
  sessions: number;
  users: number;
  conversions: number;
};

export type SearchConsoleDailyMetric = {
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
};

/** GA4 returns dates as "20260917" (no separators) — normalize to YYYY-MM-DD for the date column. */
function normalizeGa4Date(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export async function fetchGa4Metrics(
  accessToken: string,
  propertyId: string,
  days: number = 30
): Promise<Ga4DailyMetric[]> {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "conversions" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `GA4 runReport failed: HTTP ${res.status}`);
  }

  return (data.rows || []).map((row: any) => ({
    date: normalizeGa4Date(row.dimensionValues[0].value),
    sessions: Number(row.metricValues[0].value) || 0,
    users: Number(row.metricValues[1].value) || 0,
    conversions: Number(row.metricValues[2].value) || 0,
  }));
}

export type Ga4ChannelBreakdown = {
  channel: string; // GA4's own grouping, e.g. "Paid Search", "Organic Search", "Direct", "Referral"
  sessions: number;
  conversions: number;
};

/**
 * Sessions/conversions grouped by GA4's own traffic-channel classification
 * (sessionDefaultChannelGroup) — this is the only way to see paid vs
 * organic vs direct etc. broken out; the plain daily sessions/conversions
 * totals used elsewhere are a blend of every channel with no split. Fetched
 * live (like fetchTopSearchQueries) rather than synced/stored, since it's
 * a supplementary breakdown view, not a time series the rest of the
 * dashboard depends on.
 */
export async function fetchGa4ChannelBreakdown(
  accessToken: string,
  propertyId: string,
  days: number = 30
): Promise<Ga4ChannelBreakdown[]> {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "conversions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `GA4 runReport failed: HTTP ${res.status}`);
  }

  return (data.rows || []).map((row: any) => ({
    channel: row.dimensionValues[0].value || "(unassigned)",
    sessions: Number(row.metricValues[0].value) || 0,
    conversions: Number(row.metricValues[1].value) || 0,
  }));
}

export type SearchQuery = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
};

export async function fetchTopSearchQueries(
  accessToken: string,
  siteUrl: string,
  days: number = 30,
  limit: number = 10
): Promise<SearchQuery[]> {
  const today = new Date();
  const startDate = new Date(today.getTime() - days * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: fmt(startDate),
        endDate: fmt(today),
        dimensions: ["query"],
        rowLimit: limit,
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Search Console query failed: HTTP ${res.status}`);
  }

  return (data.rows || []).map((row: any) => ({
    query: row.keys[0],
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.ctr || 0,
    avgPosition: row.position || 0,
  }));
}

export type SitemapStatus = {
  path: string;
  isSitemapsIndex: boolean;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  warnings: number;
  errors: number;
  submitted: number;
  indexed: number;
};

export async function fetchSitemaps(accessToken: string, siteUrl: string): Promise<SitemapStatus[]> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Sitemaps list failed: HTTP ${res.status}`);
  }

  return (data.sitemap || []).map((s: any) => {
    // "contents" is one entry per content type (web, image, video...) — sum
    // across all of them for a single submitted/indexed count per sitemap.
    const contents = s.contents || [];
    return {
      path: s.path,
      isSitemapsIndex: Boolean(s.isSitemapsIndex),
      lastSubmitted: s.lastSubmitted || null,
      lastDownloaded: s.lastDownloaded || null,
      warnings: Number(s.warnings) || 0,
      errors: Number(s.errors) || 0,
      submitted: contents.reduce((sum: number, c: any) => sum + (Number(c.submitted) || 0), 0),
      indexed: contents.reduce((sum: number, c: any) => sum + (Number(c.indexed) || 0), 0),
    };
  });
}

export async function fetchSearchConsoleMetrics(
  accessToken: string,
  siteUrl: string,
  days: number = 30
): Promise<SearchConsoleDailyMetric[]> {
  const today = new Date();
  const startDate = new Date(today.getTime() - days * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: fmt(startDate), endDate: fmt(today), dimensions: ["date"] }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Search Console query failed: HTTP ${res.status}`);
  }

  return (data.rows || []).map((row: any) => ({
    date: row.keys[0],
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.ctr || 0,
    avgPosition: row.position || 0,
  }));
}
