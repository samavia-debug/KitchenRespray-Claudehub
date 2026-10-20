import { NextResponse } from "next/server";
import { listActivities, logActivity } from "@/lib/crm/activity-service";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { cleanActivityInput, isUuid } from "@/lib/crm/validate";

// A company's activity history, newest first.
export async function GET(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  const companyId = new URL(request.url).searchParams.get("company_id");
  if (!isUuid(companyId)) return NextResponse.json({ error: "Choose a company" }, { status: 400 });
  try {
    return NextResponse.json({ activities: await listActivities(companyId) });
  } catch (err) {
    return serverError(err, "Could not load the activity history");
  }
}

/**
 * Records something a person did. With a follow-up date it also creates the follow-up. Nothing is recorded as
 * done unless a person sends it, and it cannot be dated in the future.
 */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanActivityInput(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const result = await logActivity(cleaned.value, auth.session.user.id);
    if ("notFound" in result) return NextResponse.json({ error: "That company was not found" }, { status: 404 });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "Could not save the activity");
  }
}
