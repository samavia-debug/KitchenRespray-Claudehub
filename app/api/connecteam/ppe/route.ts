import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { isConnecteamConfigured } from "@/lib/connecteam/client";
import { getPpeOverview, getPpeStatus, syncPpeRequests } from "@/lib/connecteam/ppe-sync";

export const maxDuration = 60;

export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    const [status, { overview }] = await Promise.all([getPpeStatus(), getPpeOverview()]);
    return NextResponse.json({ ...status, overview });
  } catch (err: any) {
    // Most likely the ppe_requests table hasn't been created yet.
    return NextResponse.json({ error: err.message || "Could not load PPE data" }, { status: 500 });
  }
}

export async function POST() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  if (!isConnecteamConfigured()) {
    return NextResponse.json({ error: "Connecteam isn't connected yet — CONNECTEAM_API_KEY is not set." }, { status: 400 });
  }

  try {
    return NextResponse.json(await syncPpeRequests());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "PPE sync failed" }, { status: 500 });
  }
}
