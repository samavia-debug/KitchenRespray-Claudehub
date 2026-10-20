import { NextResponse } from "next/server";
import { deleteOpportunity, updateOpportunity } from "@/lib/crm/activity-service";
import { crmAccess, crmOverseer, readJson, serverError } from "@/lib/crm/http";
import { cleanOpportunityInput, isUuid } from "@/lib/crm/validate";

type Ctx = { params: { id: string } };
const notFound = () => NextResponse.json({ error: "That opportunity was not found" }, { status: 404 });

/** Saves changes. `expectedUpdatedAt` is the version being edited; if someone saved since, nothing is overwritten (409). */
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return notFound();

  const body = await readJson(request);
  const cleaned = cleanOpportunityInput(body, true);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  if (Object.keys(cleaned.value).filter((k) => k !== "company_id").length === 0) return NextResponse.json({ error: "There is nothing to change" }, { status: 400 });

  const expected = (body as { expectedUpdatedAt?: unknown })?.expectedUpdatedAt;
  try {
    const result = await updateOpportunity(params.id, cleaned.value, typeof expected === "string" ? expected : null, auth.session.user.id);
    if ("notFound" in result) return notFound();
    if ("conflict" in result) return NextResponse.json({ error: "Someone else has just changed this opportunity. Reload to see their changes, then make yours again." }, { status: 409 });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "Could not save the opportunity");
  }
}

// Deleting an opportunity (and its recorded value) is for Admin or Manager.
export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await crmOverseer();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return notFound();
  try {
    return (await deleteOpportunity(params.id, auth.session.user.id)) ? NextResponse.json({ ok: true }) : notFound();
  } catch (err) {
    return serverError(err, "Could not delete the opportunity");
  }
}
