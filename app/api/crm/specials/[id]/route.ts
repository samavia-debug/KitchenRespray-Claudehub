import { NextResponse } from "next/server";
import { crmOverseer, readJson, serverError } from "@/lib/crm/http";
import { deleteSpecial, updateSpecial } from "@/lib/crm/specials-service";
import { cleanSpecialInput, isUuid } from "@/lib/crm/validate";

type Ctx = { params: { id: string } };

const notFound = () => NextResponse.json({ error: "That special was not found" }, { status: 404 });

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await crmOverseer();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return notFound();

  const cleaned = cleanSpecialInput(await readJson(request), true);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  if (Object.keys(cleaned.value).length === 0) return NextResponse.json({ error: "There is nothing to change" }, { status: 400 });

  try {
    const result = await updateSpecial(params.id, cleaned.value, auth.session.user.id);
    if ("notFound" in result) return notFound();
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "Could not save the special");
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await crmOverseer();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return notFound();
  try {
    return (await deleteSpecial(params.id, auth.session.user.id)) ? NextResponse.json({ ok: true }) : notFound();
  } catch (err) {
    return serverError(err, "Could not delete the special");
  }
}
