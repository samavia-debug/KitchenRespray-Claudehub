import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { cleanUploadRequest } from "@/lib/crm/documents";
import { startUpload } from "@/lib/crm/documents-service";

/**
 * Step one of adding a file: checks its name, type and size, and gives the browser a one-off place in private storage to
 * send it to. Nothing is kept until the second step.
 */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanUploadRequest(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  try {
    const result = await startUpload(cleaned.value);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError(err, "Could not prepare the upload");
  }
}
