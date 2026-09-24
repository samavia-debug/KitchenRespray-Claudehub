import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getValidGoogleAccessToken } from "@/lib/google/token";
import { fetchTopSearchQueries, fetchSitemaps } from "@/lib/google/metrics";

/**
 * Top search queries + sitemap indexing status, fetched live from Search
 * Console rather than pre-synced — unlike the daily metrics tables, this
 * isn't a time series (sitemap status in particular should reflect
 * Google's current view, not a stale snapshot), so there's no benefit to
 * storing it and a real cost to it going stale.
 */
export async function GET(request: Request, { params }: { params: { websiteId: string } }) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: connection } = await supabase
    .from("google_connections")
    .select("site_url")
    .eq("website_id", params.websiteId)
    .eq("service", "search_console")
    .maybeSingle();

  if (!connection?.site_url) {
    return NextResponse.json({ connected: false });
  }

  try {
    const accessToken = await getValidGoogleAccessToken(params.websiteId, "search_console");
    const [topQueries, sitemaps] = await Promise.all([
      fetchTopSearchQueries(accessToken, connection.site_url, 30, 10),
      fetchSitemaps(accessToken, connection.site_url),
    ]);

    return NextResponse.json({ connected: true, topQueries, sitemaps });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch Search Console insights" }, { status: 500 });
  }
}
