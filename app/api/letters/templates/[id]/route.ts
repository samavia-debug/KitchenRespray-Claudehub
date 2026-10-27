import { NextResponse } from "next/server";
import { lettersAccess, mayUse, notFound } from "@/lib/letters/route-auth";
import { deleteTemplate, getTemplate, updateTemplate } from "@/lib/letters/template-service";
import { cleanTemplateInput } from "@/lib/letters/templates";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const auth = await lettersAccess();
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const cleaned = cleanTemplateInput(await request.json().catch(() => null));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const existing = await getTemplate(params.id);
    if (!existing || !mayUse(auth, existing.letter_type)) return notFound("Template");
    // A template cannot be turned into a kind the caller may not use.
    if (!mayUse(auth, cleaned.value.letter_type)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    const result = await updateTemplate(params.id, cleaned.value, auth.userId);
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not update the template" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const auth = await lettersAccess();
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const existing = await getTemplate(params.id);
    if (!existing || !mayUse(auth, existing.letter_type)) return notFound("Template");
    const result = await deleteTemplate(params.id, auth.userId);
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not delete the template" }, { status: 500 });
  }
}
