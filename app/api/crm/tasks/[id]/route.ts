import { NextResponse } from "next/server";
import { cancelTask, updateTask } from "@/lib/crm/activity-service";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { cleanTaskInput, isUuid } from "@/lib/crm/validate";

type Ctx = { params: { id: string } };
const notFound = () => NextResponse.json({ error: "That follow-up was not found, or it is already done" }, { status: 404 });

// Change what the follow-up is, when it is due, who has it, or who it is for. Only open follow-ups can change.
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return notFound();

  const cleaned = cleanTaskInput(await readJson(request), true);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  if (Object.keys(cleaned.value).filter((k) => k !== "company_id").length === 0) return NextResponse.json({ error: "There is nothing to change" }, { status: 400 });

  try {
    const result = await updateTask(params.id, cleaned.value, auth.session.user.id);
    if ("notFound" in result) return notFound();
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError(err, "Could not save the follow-up");
  }
}

// Drops a follow-up that is no longer needed. It is kept as cancelled, not deleted.
export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return notFound();
  try {
    return (await cancelTask(params.id, auth.session.user.id)) ? NextResponse.json({ ok: true }) : notFound();
  } catch (err) {
    return serverError(err, "Could not cancel the follow-up");
  }
}
