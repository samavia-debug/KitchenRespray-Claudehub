import { NextResponse } from "next/server";
import { crmAdmin, readJson, serverError } from "@/lib/crm/http";
import { allowance, DAILY_LIMIT, getAiSettings, saveAiSettings } from "@/lib/crm/ai/service";
import { cleanAiSettings } from "@/lib/crm/ai/validate";

/** The approved wording the AI may use for "who we are and what we offer", and how much AI the signed-in person has left today. */
export async function GET() {
  const auth = await crmAdmin();
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json({ settings: await getAiSettings(), allowance: await allowance(auth.session.user.id), dailyLimit: DAILY_LIMIT }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError(err, "Could not load the settings");
  }
}

// Admin only: this is the wording every draft is built from.
export async function PUT(request: Request) {
  const auth = await crmAdmin();
  if ("error" in auth) return auth.error;

  const cleaned = cleanAiSettings(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  try {
    await saveAiSettings(cleaned.value, auth.session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "Could not save the settings");
  }
}
