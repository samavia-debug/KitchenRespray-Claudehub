import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getBookingsStatus, runBookingsSync } from "@/lib/bookings/service";

export const maxDuration = 60;

/** Status for the Appointments tab. Reads only our own tables; contacts neither Microsoft nor Connecteam. */
export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json(await getBookingsStatus());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load the status" }, { status: 500 });
  }
}

/**
 * { apply: false } previews what would be copied and changes nothing.
 * { apply: true } copies, but only when writing to Connecteam has been switched on.
 */
export async function POST(request: Request) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(await runBookingsSync({ apply: body?.apply === true }));
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "The copy failed" }, { status: 500 });
  }
}
