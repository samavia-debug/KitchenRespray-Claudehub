import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { runAndRecordSeoCheck } from "@/lib/monitoring/record";

/** Manual "Check SEO now" — Admin/Manager only, same pattern as the health/link checks. */
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
    const seo = await runAndRecordSeoCheck(website.id, website.domain);
    return NextResponse.json({ seo });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "SEO check failed" }, { status: 500 });
  }
}
