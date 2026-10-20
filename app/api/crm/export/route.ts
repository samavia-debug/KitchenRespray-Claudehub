import { NextResponse } from "next/server";
import { EXPORT_TYPES, exportFile, exportTable, type ExportFormat, type ExportType } from "@/lib/crm/export/export-service";
import { crmOverseer, readJson, serverError } from "@/lib/crm/http";
import { cleanCompanyQuery, isUuid, MAX_BULK } from "@/lib/crm/validate";

export const maxDuration = 60;

/**
 * Downloads CRM data as CSV or Excel. Companies can be exported by the same filters as the list (`qs`, the list's
 * query string) or as a chosen set (`ids`); contacts, activities and opportunities are exported whole.
 * Prospect and contact details are confidential, so this is for Admin and Manager, and each export is logged
 * (what was exported and how many rows, never the data).
 */
export async function POST(request: Request) {
  const auth = await crmOverseer();
  if ("error" in auth) return auth.error;

  const body = (await readJson(request)) as Record<string, unknown> | null;
  const type = body?.type as ExportType;
  const format = (body?.format ?? "csv") as ExportFormat;
  if (!EXPORT_TYPES.includes(type)) return NextResponse.json({ error: "Choose what to export." }, { status: 400 });
  if (format !== "csv" && format !== "xlsx") return NextResponse.json({ error: "Choose CSV or Excel." }, { status: 400 });

  let ids: string[] | undefined;
  if (body?.ids !== undefined) {
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > MAX_BULK || !body.ids.every(isUuid)) {
      return NextResponse.json({ error: `Select between 1 and ${MAX_BULK} companies to export.` }, { status: 400 });
    }
    ids = Array.from(new Set(body.ids as string[]));
  }
  const qs = typeof body?.qs === "string" ? body.qs.slice(0, 2000) : "";

  try {
    const table = await exportTable(type, { ids: type === "companies" ? ids : undefined, query: type === "companies" && !ids && qs ? cleanCompanyQuery(new URLSearchParams(qs)) : undefined }, auth.session.user.id);
    const file = exportFile(type, format, table);
    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
        "X-Row-Count": String(table.rows.length),
      },
    });
  } catch (err) {
    return serverError(err, "Could not export the data");
  }
}
