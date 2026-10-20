import { NextResponse } from "next/server";
import { crmAccess, serverError } from "@/lib/crm/http";
import { listBatches } from "@/lib/crm/import/import-service";

// The most recent imports: who ran them, from which file, and what happened.
export async function GET() {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json({ batches: await listBatches() });
  } catch (err) {
    return serverError(err, "Could not load the imports");
  }
}
