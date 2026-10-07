import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getCapacityOverview } from "@/lib/capacity/service";

export const maxDuration = 30;

export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json(await getCapacityOverview());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not build the comparison" }, { status: 500 });
  }
}
