import { NextResponse } from "next/server";
import { crmAccess, serverError } from "@/lib/crm/http";
import { autoMap } from "@/lib/crm/import/mapping";
import { ImportFileError, MAX_FILE_BYTES, parseSpreadsheet } from "@/lib/crm/import/parse";

export const maxDuration = 30;

/**
 * Step 1 of an import: reads an uploaded Excel (.xlsx) or CSV file and sends back its columns and rows, with a first
 * guess at what each column is. Nothing is saved. The browser keeps the rows for the next steps.
 */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: `That file is too large (the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB). Split it into smaller files.` }, { status: 413 });

  const sheet = Number(form.get("sheet"));
  try {
    const parsed = parseSpreadsheet(file.name, Buffer.from(await file.arrayBuffer()), Number.isInteger(sheet) && sheet >= 0 ? sheet : 0);
    return NextResponse.json({ filename: file.name.slice(0, 200), ...parsed, suggestedTargets: autoMap(parsed.headers) });
  } catch (err: any) {
    if (err instanceof ImportFileError) return NextResponse.json({ error: err.message }, { status: 400 });
    return serverError(err, "Could not read that file");
  }
}
