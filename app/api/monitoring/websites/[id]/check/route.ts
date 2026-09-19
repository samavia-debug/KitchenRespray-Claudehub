import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { runAndRecordCheck } from "@/lib/monitoring/record";

/** Manual "Run check now" — Admin/Manager only, so 40 sites can't be hammered by every staff click. */
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
    const check = await runAndRecordCheck(website.id, website.domain);
    return NextResponse.json({ check });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Check failed" }, { status: 500 });
  }
}
