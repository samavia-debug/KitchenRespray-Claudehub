import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { scanDocuments } from "@/lib/compliance/service";

// Each document is a model call, so a scan works through a few at a time and
// the page asks again until none are left.
export const maxDuration = 60;
const BATCH = 4;

export async function POST(request: Request) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const documentId = typeof body?.documentId === "string" ? body.documentId : undefined;

  try {
    return NextResponse.json(await scanDocuments(BATCH, documentId));
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Scan failed" }, { status: 500 });
  }
}
