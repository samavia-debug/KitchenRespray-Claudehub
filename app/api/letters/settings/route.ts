import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSettings, logEvent, saveSettings } from "@/lib/letters/service";
import { cleanSettings } from "@/lib/letters/validate";

export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json({ settings: await getSettings() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load the settings" }, { status: 500 });
  }
}

/** Letterhead and signatory details used on every letter. */
export async function PUT(request: Request) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    await saveSettings(cleanSettings(await request.json().catch(() => null)));
    await logEvent(null, auth.session.user.id, "settings_saved");
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not save the settings" }, { status: 500 });
  }
}
