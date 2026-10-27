import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { lettersAccess, mayUse } from "@/lib/letters/route-auth";
import { addStarterTemplates, createTemplate, listTemplates } from "@/lib/letters/template-service";
import { cleanTemplateInput } from "@/lib/letters/templates";

// Templates for staff letters are Admin only; templates for customer letters and quotes are open to Managers and Staff too, so a list holds
// only the kinds the caller may use.
export async function GET() {
  const auth = await lettersAccess();
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json({ templates: (await listTemplates()).filter((t) => mayUse(auth, t.letter_type)) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load the templates" }, { status: 500 });
  }
}

/** Saves a new template, or with { starters: true } (Admin only) adds the ready-made wording as templates. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  try {
    if (body && typeof body === "object" && (body as { starters?: unknown }).starters === true) {
      const admin = await requireRole(["Admin"]);
      if ("error" in admin) return admin.error;
      return NextResponse.json({ added: await addStarterTemplates(admin.session.user.id) });
    }

    const auth = await lettersAccess();
    if ("error" in auth) return auth.error;
    const cleaned = cleanTemplateInput(body);
    if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
    if (!mayUse(auth, cleaned.value.letter_type)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    return NextResponse.json({ id: await createTemplate(cleaned.value, auth.userId) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not save the template" }, { status: 500 });
  }
}
