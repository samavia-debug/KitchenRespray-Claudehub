import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { bulkUpdate } from "@/lib/crm/service";
import { cleanBulkChange } from "@/lib/crm/validate";

// Assigns an owner or a category to several companies at once. Nothing happens unless `confirmed` is true.
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanBulkChange(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const result = await bulkUpdate(cleaned.value, auth.session.user.id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "Could not apply the change");
  }
}
