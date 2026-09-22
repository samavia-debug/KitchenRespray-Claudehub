import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { runAndRecordVitalsCheck } from "@/lib/monitoring/record";

// A real Lighthouse audit on Google's end regularly takes 15-30+ seconds.
export const maxDuration = 60;

/** Manual "Check Core Web Vitals now" — Admin/Manager only, same pattern as SEO/domain expiry checks. */
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
    const vitals = await runAndRecordVitalsCheck(website.id, website.domain);
    return NextResponse.json({ vitals });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Core Web Vitals check failed" }, { status: 500 });
  }
}
