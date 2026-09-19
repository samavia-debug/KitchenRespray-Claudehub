import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireRole, getSessionProfile } from "@/lib/auth/session";

const VALID_PRIORITIES = ["critical", "high", "medium", "low"];

export async function GET() {
  const session = await getSessionProfile();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = createClient();
  const { data, error } = await supabase.from("websites").select("*").order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ websites: data });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(["Admin", "Manager"]);
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const { name, domain, category, priority } = body;

  if (!name?.trim() || !domain?.trim()) {
    return NextResponse.json({ error: "Name and domain are required" }, { status: 400 });
  }

  const cleanDomain = domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("websites")
    .insert({
      name: name.trim(),
      domain: cleanDomain,
      category: category?.trim() || null,
      priority: priority || "medium",
    })
    .select()
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ website: data });
}
