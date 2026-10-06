import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { isConnecteamConfigured } from "@/lib/connecteam/client";
import { getTimeOffOverview, getTimeOffStatus, syncTimeOff } from "@/lib/connecteam/time-sync";

export const maxDuration = 60;

export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    const [status, { overview }] = await Promise.all([getTimeOffStatus(), getTimeOffOverview()]);
    return NextResponse.json({ ...status, overview });
  } catch (err: any) {
    // Most likely the time_off_requests table hasn't been created yet.
    return NextResponse.json({ error: err.message || "Could not load time off data" }, { status: 500 });
  }
}

export async function POST() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  if (!isConnecteamConfigured()) {
    return NextResponse.json({ error: "Connecteam isn't connected yet — CONNECTEAM_API_KEY is not set." }, { status: 400 });
  }

  try {
    return NextResponse.json(await syncTimeOff());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Time off sync failed" }, { status: 500 });
  }
}
