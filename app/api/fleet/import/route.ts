import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { MAX_FILE_BYTES } from "@/lib/crm/import/parse";
import { ZipError } from "@/lib/crm/import/zip-read";
import { readFleetWorkbook } from "@/lib/fleet/import";
import { importVans, previewImport } from "@/lib/fleet/service";

export const maxDuration = 30;

/**
 * Reads an uploaded van list (.xlsx). Without `commit` it only reports what would happen; with `commit=1` it saves.
 * The browser keeps the file between the two, so nothing is stored on the server in between.
 */
export async function POST(request: Request) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: "Upload the van list as an Excel (.xlsx) file." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "That file is too large." }, { status: 413 });

  const sheetField = form.get("sheet");
  const sheet = typeof sheetField === "string" && /^\d+$/.test(sheetField) ? Number(sheetField) : undefined;

  try {
    const read = readFleetWorkbook(Buffer.from(await file.arrayBuffer()), sheet);
    if (!read.sheet || read.sheet.vans.length === 0) {
      return NextResponse.json({ error: "No van list was found on that sheet. It needs a heading row with Reg and Model (or Driver).", sheets: read.sheets, sheetIndex: read.sheetIndex }, { status: 400 });
    }

    if (form.get("commit") === "1") {
      const counts = await importVans(read.sheet.vans, auth.session.user.id);
      return NextResponse.json({ committed: true, ...counts, warnings: read.sheet.warnings });
    }

    const counts = await previewImport(read.sheet.vans);
    const monthOnly = read.sheet.vans.filter((v) => v.monthNotes.length > 0).length;
    return NextResponse.json({
      committed: false,
      sheets: read.sheets,
      sheetIndex: read.sheetIndex,
      vans: read.sheet.vans.length,
      monthOnly,
      warnings: read.sheet.warnings,
      ...counts,
    });
  } catch (err: any) {
    if (err instanceof ZipError) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: err.message || "Could not read that file" }, { status: 500 });
  }
}
