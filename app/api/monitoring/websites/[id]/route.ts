import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireRole, getSessionProfile } from "@/lib/auth/session";

const VALID_PRIORITIES = ["critical", "high", "medium", "low"];
const HISTORY_LIMIT = 100;

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = createClient();

  const { data: website, error: websiteError } = await supabase
    .from("websites")
    .select("*")
    .eq("id", params.id)
    .single();

  if (websiteError || !website) {
    return NextResponse.json({ error: "Website not found" }, { status: 404 });
  }

  const { data: checks, error: checksError } = await supabase
    .from("website_health_checks")
    .select("*")
    .eq("website_id", params.id)
    .order("checked_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (checksError) {
    return NextResponse.json({ error: checksError.message }, { status: 500 });
  }

  const { data: linkChecks, error: linkChecksError } = await supabase
    .from("website_link_checks")
    .select("*")
    .eq("website_id", params.id)
    .order("is_broken", { ascending: false })
    .order("last_checked_at", { ascending: false });

  if (linkChecksError) {
    return NextResponse.json({ error: linkChecksError.message }, { status: 500 });
  }

  const { data: seoCheck, error: seoCheckError } = await supabase
    .from("website_seo_checks")
    .select("*")
    .eq("website_id", params.id)
    .maybeSingle();

  if (seoCheckError) {
    return NextResponse.json({ error: seoCheckError.message }, { status: 500 });
  }

  const { data: vitalsCheck, error: vitalsCheckError } = await supabase
    .from("core_web_vitals_checks")
    .select("*")
    .eq("website_id", params.id)
    .maybeSingle();

  if (vitalsCheckError) {
    return NextResponse.json({ error: vitalsCheckError.message }, { status: 500 });
  }

  const { data: wordpressCheck, error: wordpressCheckError } = await supabase
    .from("website_wordpress_checks")
    .select("*")
    .eq("website_id", params.id)
    .maybeSingle();

  if (wordpressCheckError) {
    return NextResponse.json({ error: wordpressCheckError.message }, { status: 500 });
  }

  return NextResponse.json({ website, checks, linkChecks, seoCheck, vitalsCheck, wordpressCheck });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin", "Manager"]);
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.category === "string") updates.category = body.category.trim() || null;
  if (typeof body.notes === "string") updates.notes = body.notes.trim() || null;
  if (typeof body.is_active === "boolean") updates.is_active = body.is_active;
  if (typeof body.monitoring_interval_minutes === "number" && body.monitoring_interval_minutes >= 5) {
    updates.monitoring_interval_minutes = body.monitoring_interval_minutes;
  }
  if (typeof body.priority === "string") {
    if (!VALID_PRIORITIES.includes(body.priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }
    updates.priority = body.priority;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const service = createServiceClient();
  const { data, error } = await service
    .from("websites")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ website: data });
}
