import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { isConnecteamConfigured } from "@/lib/connecteam/client";
import { getTodayOverview, refreshOperationsData } from "@/lib/connecteam/operations-sync";

export const maxDuration = 60;

export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json({ configured: isConnecteamConfigured(), ...(await getTodayOverview()) });
  } catch (err: any) {
    // Most likely the scheduled_shifts or time clock tables haven't been created yet.
    return NextResponse.json({ error: err.message || "Could not load today's overview" }, { status: 500 });
  }
}

/** Pulls the latest clock-ins and rota from Connecteam so the page is current. */
export async function POST() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  if (!isConnecteamConfigured()) {
    return NextResponse.json({ error: "Connecteam isn't connected yet — CONNECTEAM_API_KEY is not set." }, { status: 400 });
  }

  try {
    return NextResponse.json(await refreshOperationsData());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Refresh failed" }, { status: 500 });
  }
}
