import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { createContact, listContacts } from "@/lib/crm/service";
import { searchTerm } from "@/lib/crm/normalize";
import { cleanContactInput, isUuid } from "@/lib/crm/validate";

export async function GET(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const params = new URL(request.url).searchParams;
  const companyId = params.get("company_id");
  const page = Math.max(1, Math.min(100_000, Number(params.get("page")) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(params.get("pageSize")) || 25));
  try {
    const result = await listContacts({ q: searchTerm(params.get("q")), companyId: isUuid(companyId) ? companyId : null, page, pageSize });
    return NextResponse.json({ ...result, page, pageSize });
  } catch (err) {
    return serverError(err, "Could not load the contacts");
  }
}

/** Adds a contact to a company. A likely duplicate comes back (409) unless `confirmDuplicate` is sent. */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const body = await readJson(request);
  const cleaned = cleanContactInput(body);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const confirm = (body as { confirmDuplicate?: unknown })?.confirmDuplicate === true;
    const result = await createContact(cleaned.value as Parameters<typeof createContact>[0], auth.session.user.id, confirm);
    if ("notFound" in result) return NextResponse.json({ error: "That company was not found" }, { status: 404 });
    if ("duplicates" in result) return NextResponse.json({ error: "This looks like a contact that is already in the CRM", duplicates: result.duplicates }, { status: 409 });
    return NextResponse.json({ id: result.id });
  } catch (err) {
    return serverError(err, "Could not save the contact");
  }
}
