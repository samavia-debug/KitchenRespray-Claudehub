import { NextResponse } from "next/server";
import { setOpportunityStatus } from "@/lib/crm/activity-service";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { cleanOpportunityStatus, isUuid } from "@/lib/crm/validate";

/**
 * Moves an opportunity to identified, quote requested, quote sent, won or lost. Won and Lost have to be confirmed,
 * and the value won is recorded only against a win.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  const notFound = () => NextResponse.json({ error: "That opportunity was not found" }, { status: 404 });
  if (!isUuid(params.id)) return notFound();

  const cleaned = cleanOpportunityStatus(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const result = await setOpportunityStatus(params.id, cleaned.value, auth.session.user.id);
    if ("notFound" in result) return notFound();
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "Could not change the status");
  }
}
