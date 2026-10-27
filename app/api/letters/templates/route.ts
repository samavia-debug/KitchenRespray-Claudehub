import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { addStarterTemplates, createTemplate, listTemplates } from "@/lib/letters/template-service";
import { cleanTemplateInput } from "@/lib/letters/templates";

// Templates carry the same kind of wording as the letters themselves, so they are Admin only for now.
export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json({ templates: await listTemplates() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load the templates" }, { status: 500 });
  }
}

/** Saves a new template, or with { starters: true } adds the ready-made wording as templates. */
export async function POST(request: Request) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);

  try {
    if (body && typeof body === "object" && (body as { starters?: unknown }).starters === true) {
      return NextResponse.json({ added: await addStarterTemplates(auth.session.user.id) });
    }

    const cleaned = cleanTemplateInput(body);
    if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
    return NextResponse.json({ id: await createTemplate(cleaned.value, auth.session.user.id) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not save the template" }, { status: 500 });
  }
}
