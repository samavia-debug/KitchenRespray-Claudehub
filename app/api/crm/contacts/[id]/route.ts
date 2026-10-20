import { NextResponse } from "next/server";
import { crmAccess, crmOverseer, readJson, serverError } from "@/lib/crm/http";
import { deleteContact, updateContact } from "@/lib/crm/service";
import { cleanContactInput, isUuid } from "@/lib/crm/validate";

type Ctx = { params: { id: string } };

const notFound = () => NextResponse.json({ error: "That contact was not found" }, { status: 404 });

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return notFound();

  const body = await readJson(request);
  const cleaned = cleanContactInput(body, true);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  if (Object.keys(cleaned.value).filter((k) => k !== "company_id").length === 0) return NextResponse.json({ error: "There is nothing to change" }, { status: 400 });

  const expected = (body as { expectedUpdatedAt?: unknown })?.expectedUpdatedAt;
  try {
    const result = await updateContact(params.id, cleaned.value, typeof expected === "string" ? expected : null, auth.session.user.id);
    if ("notFound" in result) return notFound();
    if ("conflict" in result) return NextResponse.json({ error: "Someone else has just changed this contact. Reload to see their changes, then make yours again." }, { status: 409 });
    return NextResponse.json({ ok: true, updated_at: result.updated_at });
  } catch (err) {
    return serverError(err, "Could not save the contact");
  }
}

// Removing a person's details is for Admin or Manager, so it is a deliberate act and also covers erasure requests.
export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await crmOverseer();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return notFound();
  try {
    return (await deleteContact(params.id, auth.session.user.id)) ? NextResponse.json({ ok: true }) : notFound();
  } catch (err) {
    return serverError(err, "Could not delete the contact");
  }
}
