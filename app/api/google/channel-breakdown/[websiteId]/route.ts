import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getValidGoogleAccessToken } from "@/lib/google/token";
import { fetchGa4ChannelBreakdown } from "@/lib/google/metrics";

/**
 * Sessions/conversions broken out by GA4's traffic-channel grouping (Paid
 * Search, Organic Search, Direct, Referral, ...) — fetched live rather
 * than synced/stored, same reasoning as the Search Console insights route:
 * this is a supplementary breakdown, not a time series the rest of the
 * dashboard depends on.
 */
export async function GET(request: Request, { params }: { params: { websiteId: string } }) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: connection } = await supabase
    .from("google_connections")
    .select("property_id")
    .eq("website_id", params.websiteId)
    .eq("service", "analytics")
    .maybeSingle();

  if (!connection?.property_id) {
    return NextResponse.json({ connected: false });
  }

  try {
    const accessToken = await getValidGoogleAccessToken(params.websiteId, "analytics");
    const breakdown = await fetchGa4ChannelBreakdown(accessToken, connection.property_id, 30);
    return NextResponse.json({ connected: true, breakdown });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch channel breakdown" }, { status: 500 });
  }
}
