import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { listTechnicians } from "@/lib/letters/service";

/** The searchable list: names and job titles only. Full details are fetched when one is chosen. */
export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json({ technicians: await listTechnicians() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load the staff list" }, { status: 500 });
  }
}
