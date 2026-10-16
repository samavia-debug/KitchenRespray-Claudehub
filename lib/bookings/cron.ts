import { isCronAuthorized } from "@/lib/auth/cron";
import { isConnecteamConfigured } from "@/lib/connecteam/client";
import { bookingsWriteEnabled, graphConfig } from "./config";
import { runBookingsSync } from "./service";

export type CronReply = { status: number; body: Record<string, unknown> };

/**
 * The quick appointment-only tick, called by the scheduler every few minutes. It does only the
 * Bookings copy (the full 30-minute tick does everything else), so it is light enough to run often.
 * A problem returns an error status, so the scheduler shows the failure instead of hiding it.
 * Nothing about a customer is returned: only counts and messages.
 */
export async function handleBookingsCron(request: Request): Promise<CronReply> {
  if (!isCronAuthorized(request)) return { status: 401, body: { error: "Not authorized" } };

  if (!graphConfig() || !bookingsWriteEnabled() || !isConnecteamConfigured()) {
    return { status: 200, body: { skipped: "not switched on" } };
  }

  try {
    const r = await runBookingsSync({ apply: true });
    const failed = r.state === "error" || r.errors.length > 0;
    return {
      status: failed ? 500 : 200,
      body: {
        state: r.state,
        counts: r.counts,
        errors: r.errors,
        held: r.held,
        ...(r.state === "error" || r.state === "busy" || r.state === "not_configured" ? { message: r.message } : {}),
      },
    };
  } catch (err: any) {
    return { status: 500, body: { error: err.message || "The appointment copy failed" } };
  }
}
