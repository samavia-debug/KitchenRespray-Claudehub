import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth/cron";
import { runConnecteamTick } from "@/lib/connecteam/cron";

// The scheduler (cron-job.org) stops waiting after 30 seconds, so the tick keeps itself to about 24 (see
// CONNECTEAM_TICK_BUDGET_MS). This is only the hard ceiling if one Connecteam call hangs.
export const maxDuration = 60;

// Called every 30 minutes with the CRON_SECRET bearer token. Does only the Connecteam syncs that are due.
async function tick(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  return NextResponse.json(await runConnecteamTick());
}

export const GET = tick;
export const POST = tick;
