import { NextResponse } from "next/server";
import { crmOverseer, serverError } from "@/lib/crm/http";
import { undoBatch } from "@/lib/crm/import/import-service";
import { isUuid } from "@/lib/crm/validate";

export const maxDuration = 60;

/**
 * Undoes an import by removing the companies it created, but only those nobody has touched since (not edited, no
 * activity, follow-up, opportunity or stage change, no contact added by hand). Everything worked on is kept.
 * For Admin or Manager.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const auth = await crmOverseer();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return NextResponse.json({ error: "That import was not found" }, { status: 404 });
  try {
    const result = await undoBatch(params.id, auth.session.user.id);
    if ("notFound" in result) return NextResponse.json({ error: "That import was not found" }, { status: 404 });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "Could not undo the import");
  }
}
