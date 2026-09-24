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
