import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { cleanFinishRequest, isUuidText } from "@/lib/crm/documents";
import { finishUpload, listDocuments } from "@/lib/crm/documents-service";

/** A company's documents and quotes. */
export async function GET(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  const companyId = new URL(request.url).searchParams.get("company_id");
  if (!isUuidText(companyId)) return NextResponse.json({ error: "Choose a company" }, { status: 400 });
  try {
    return NextResponse.json({ documents: await listDocuments(companyId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError(err, "Could not load the documents");
  }
}

/**
 * Step two of adding a file, once the browser has sent it to storage: the server checks the file and, only if it is
 * what it says it is, keeps it. Anything that fails the check is removed from storage again.
 */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanFinishRequest(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  try {
    const result = await finishUpload(cleaned.value, auth.session.user.id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return serverError(err, "Could not save the document");
  }
}
