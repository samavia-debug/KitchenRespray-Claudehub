import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { runAndRecordWordPressCheck } from "@/lib/monitoring/record";

export const maxDuration = 30;

/** Manual "Check WordPress now" — Admin/Manager only, same pattern as the other spot-checks. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin", "Manager"]);
  if ("error" in auth) return auth.error;

  const supabase = createClient();
  const { data: website, error } = await supabase
    .from("websites")
    .select("id, domain")
    .eq("id", params.id)
    .single();

  if (error || !website) {
    return NextResponse.json({ error: "Website not found" }, { status: 404 });
  }

  try {
    const wordpress = await runAndRecordWordPressCheck(website.id, website.domain);
    return NextResponse.json({ wordpress });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "WordPress check failed" }, { status: 500 });
  }
}
