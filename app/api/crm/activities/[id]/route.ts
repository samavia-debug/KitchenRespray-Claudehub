import { NextResponse } from "next/server";
import { deleteActivity } from "@/lib/crm/activity-service";
import { crmOverseer, serverError } from "@/lib/crm/http";
import { isUuid } from "@/lib/crm/validate";

// Removing a recorded activity (a mistake, or an erasure request) is for Admin or Manager.
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const auth = await crmOverseer();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return NextResponse.json({ error: "That activity was not found" }, { status: 404 });
  try {
    return (await deleteActivity(params.id, auth.session.user.id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "That activity was not found" }, { status: 404 });
  } catch (err) {
    return serverError(err, "Could not delete the activity");
  }
}
