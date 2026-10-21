import { NextResponse } from "next/server";
import { bulkLogActivity } from "@/lib/crm/activity-service";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { cleanBulkActivity } from "@/lib/crm/validate";

export const maxDuration = 60;

/**
 * Records one activity (say, the WhatsApp message that went out) against many companies at once. Nothing happens unless
 * `confirmed` is true, and a company that already has that kind of activity on that day is skipped.
 */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanBulkActivity(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const result = await bulkLogActivity(cleaned.value, auth.session.user.id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "Could not record the activity");
  }
}
