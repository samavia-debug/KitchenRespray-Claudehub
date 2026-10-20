import { NextResponse } from "next/server";
import { completeTask } from "@/lib/crm/activity-service";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { cleanTaskCompletion, isUuid } from "@/lib/crm/validate";

/**
 * Marks a follow-up done and records the result. It only adds an activity when `activity_type` is sent (the person
 * saying what they did), and can set the next follow-up (`next`) in the same step.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  const notFound = () => NextResponse.json({ error: "That follow-up was not found, or it is already done" }, { status: 404 });
  if (!isUuid(params.id)) return notFound();

  const cleaned = cleanTaskCompletion(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const result = await completeTask(params.id, cleaned.value, auth.session.user.id);
    if ("notFound" in result) return notFound();
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "Could not complete the follow-up");
  }
}
