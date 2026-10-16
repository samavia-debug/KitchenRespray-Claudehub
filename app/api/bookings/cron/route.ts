import { NextResponse } from "next/server";
import { handleBookingsCron } from "@/lib/bookings/cron";

export const maxDuration = 30;

// Called by the scheduler (cron-job.org) every few minutes with the CRON_SECRET bearer token.
export async function GET(request: Request) {
  const { status, body } = await handleBookingsCron(request);
  return NextResponse.json(body, { status });
}
