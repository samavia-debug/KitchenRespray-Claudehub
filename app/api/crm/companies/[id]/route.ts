import { NextResponse } from "next/server";
import { crmAccess, crmAdmin, crmOverseer, readJson, serverError } from "@/lib/crm/http";
import { archiveCompany, deleteCompany, getCompany, updateCompany } from "@/lib/crm/service";
import { cleanCompanyInput, isUuid } from "@/lib/crm/validate";

type Ctx = { params: { id: string } };

const notFound = () => NextResponse.json({ error: "That company was not found" }, { status: 404 });

export async function GET(_request: Request, { params }: Ctx) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return notFound();
  try {
    const found = await getCompany(params.id);
    return found ? NextResponse.json(found) : notFound();
  } catch (err) {
    return serverError(err, "Could not load the company");
  }
}

/** Saves changes. `expectedUpdatedAt` is the version being edited; if someone saved since, nothing is overwritten (409). */
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return notFound();

  const body = await readJson(request);
  const cleaned = cleanCompanyInput(body, true);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  if (Object.keys(cleaned.value).length === 0) return NextResponse.json({ error: "There is nothing to change" }, { status: 400 });

  const expected = (body as { expectedUpdatedAt?: unknown })?.expectedUpdatedAt;
  try {
    const result = await updateCompany(params.id, cleaned.value, typeof expected === "string" ? expected : null, auth.session.user.id);
    if ("notFound" in result) return notFound();
    if ("conflict" in result) return NextResponse.json({ error: "Someone else has just changed this company. Reload it to see their changes, then make yours again." }, { status: 409 });
    return NextResponse.json({ company: result.company });
  } catch (err) {
    return serverError(err, "Could not save the company");
  }
}

/**
 * Archiving hides a company and keeps everything (Admin or Manager). `?permanent=true` removes it and its
 * contacts for good (Admin only), for when someone asks for their details to be erased.
 */
export async function DELETE(request: Request, { params }: Ctx) {
  const permanent = new URL(request.url).searchParams.get("permanent") === "true";
  const auth = permanent ? await crmAdmin() : await crmOverseer();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return notFound();
  try {
    const done = permanent ? await deleteCompany(params.id, auth.session.user.id) : await archiveCompany(params.id, auth.session.user.id);
    return done ? NextResponse.json({ ok: true }) : notFound();
  } catch (err) {
    return serverError(err, "Could not remove the company");
  }
}
