import { NextRequest, NextResponse } from "next/server";
import { getSessionProfile, requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

/** Connection status only — never returns tokens, even to Admins. */
export async function GET(request: NextRequest, { params }: { params: { websiteId: string } }) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("google_connections")
    .select("service, external_account_email, property_id, site_url, connected_at, last_synced_at")
    .eq("website_id", params.websiteId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ connections: data });
}

export async function DELETE(request: NextRequest, { params }: { params: { websiteId: string } }) {
  const auth = await requireRole(["Admin", "Manager"]);
  if ("error" in auth) return auth.error;

  const service = request.nextUrl.searchParams.get("service");
  if (!service) {
    return NextResponse.json({ error: "Missing service" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("google_connections")
    .delete()
    .eq("website_id", params.websiteId)
    .eq("service", service);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
