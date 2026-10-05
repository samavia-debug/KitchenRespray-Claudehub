import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { isConnecteamConfigured } from "@/lib/connecteam/client";
import { getConnecteamStatus, syncConnecteamStaff } from "@/lib/connecteam/sync";

export const maxDuration = 60;

export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  return NextResponse.json(await getConnecteamStatus());
}

export async function POST() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  if (!isConnecteamConfigured()) {
    return NextResponse.json({ error: "Connecteam isn't connected yet — CONNECTEAM_API_KEY is not set." }, { status: 400 });
  }

  try {
    return NextResponse.json(await syncConnecteamStaff());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Connecteam sync failed" }, { status: 500 });
  }
}
