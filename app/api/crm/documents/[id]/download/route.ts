import { NextResponse } from "next/server";
import { crmAccess, serverError } from "@/lib/crm/http";
import { isUuidText } from "@/lib/crm/documents";
import { downloadLink } from "@/lib/crm/documents-service";

type Ctx = { params: { id: string } };

/**
 * Sends the person to a download link that stops working after a minute. The link is only made after the role check, so a
 * document cannot be reached by anyone who is not signed in as Staff, Manager or Admin.
 */
export async function GET(_request: Request, { params }: Ctx) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  if (!isUuidText(params.id)) return NextResponse.json({ error: "That document was not found" }, { status: 404 });
  try {
    const link = await downloadLink(params.id, auth.session.user.id);
    if (!link) return NextResponse.json({ error: "That document was not found" }, { status: 404 });
    const res = NextResponse.redirect(link.url, 302);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    return serverError(err, "Could not open the document");
  }
}
