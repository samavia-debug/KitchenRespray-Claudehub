import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { runAndRecordDomainExpiryCheck } from "@/lib/monitoring/record";

/**
 * Manual "Check domain expiry now" — Admin/Manager only. Deliberately not
 * on any automatic schedule (RDAP is a shared public service; querying 61
 * sites every 30 minutes would be poor citizenship for data that changes
 * at most once a year).
 */
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
    const result = await runAndRecordDomainExpiryCheck(website.id, website.domain);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Domain expiry check failed" }, { status: 500 });
  }
}
