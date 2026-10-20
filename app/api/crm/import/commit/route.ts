import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { commitImport } from "@/lib/crm/import/import-service";
import { cleanImportInput } from "@/lib/crm/import/validate";

export const maxDuration = 60;

/**
 * The final step: saves the rows the person approved. It works everything out again from the rows it is sent, applies
 * the per-row choices, never changes an existing company, and does nothing unless `confirmed` is true.
 */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanImportInput(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const result = await commitImport(cleaned.value, auth.session.user.id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "Could not import the file");
  }
}
