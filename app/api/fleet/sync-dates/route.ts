import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { syncVanDocuments } from "@/lib/fleet/connecteam-sync";

// Reads the van tax, DOE and insurance dates from the Documents tab in Connecteam now, instead of waiting for the scheduled sync.
export const maxDuration = 30;

export async function POST() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json(await syncVanDocuments());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not read the dates from Connecteam" }, { status: 500 });
  }
}
