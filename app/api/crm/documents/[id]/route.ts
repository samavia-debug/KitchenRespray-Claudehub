import { NextResponse } from "next/server";
import { crmOverseer, serverError } from "@/lib/crm/http";
import { isUuidText } from "@/lib/crm/documents";
import { deleteDocument } from "@/lib/crm/documents-service";

type Ctx = { params: { id: string } };

/** Removing a document is for a Manager or Admin, like removing any other record. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await crmOverseer();
  if ("error" in auth) return auth.error;
  if (!isUuidText(params.id)) return NextResponse.json({ error: "That document was not found" }, { status: 404 });
  try {
    return (await deleteDocument(params.id, auth.session.user.id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "That document was not found" }, { status: 404 });
  } catch (err) {
    return serverError(err, "Could not delete the document");
  }
}
