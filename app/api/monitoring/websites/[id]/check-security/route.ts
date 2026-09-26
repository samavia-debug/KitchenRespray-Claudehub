import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { runAndRecordSecurityCheck } from "@/lib/monitoring/record";

/** Manual "Check now" for the security/hijack scan — Admin/Manager only, same pattern as the other checks. */
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
    const security = await runAndRecordSecurityCheck(website.id, website.domain);
    return NextResponse.json({ security });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Security check failed" }, { status: 500 });
  }
}
