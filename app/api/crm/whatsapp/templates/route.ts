import { NextResponse } from "next/server";
import { crmAdmin, readJson, serverError } from "@/lib/crm/http";
import { cleanTemplates, getTemplates, saveTemplates } from "@/lib/crm/whatsapp-service";

/** The two fixed WhatsApp messages the send queue uses. Admin only: this is the wording that goes out to customers. */
export async function GET() {
  const auth = await crmAdmin();
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json(await getTemplates(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError(err, "Could not load the messages");
  }
}

export async function PUT(request: Request) {
  const auth = await crmAdmin();
  if ("error" in auth) return auth.error;

  const cleaned = cleanTemplates(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  try {
    await saveTemplates(cleaned.value, auth.session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "Could not save the messages");
  }
}
