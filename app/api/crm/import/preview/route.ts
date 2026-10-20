import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { previewImport } from "@/lib/crm/import/import-service";
import { cleanImportInput } from "@/lib/crm/import/validate";

export const maxDuration = 60;

/**
 * Steps 2 to 4 of an import: checks every row with the chosen column choices and defaults and reports, row by row,
 * what is ready, what has a problem, and what looks like something already in the CRM. Nothing is saved.
 */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanImportInput(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const result = await previewImport(cleaned.value);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "Could not check the import");
  }
}
