import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { aiReply } from "@/lib/crm/ai/http";
import { suggestNextSteps } from "@/lib/crm/ai/service";
import { isUuid } from "@/lib/crm/validate";

export const maxDuration = 60;

/** Suggests next steps with one company, from its recorded history. Suggestions only: nothing is created or sent. */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const body = (await readJson(request)) as { company_id?: unknown } | null;
  if (!isUuid(body?.company_id)) return NextResponse.json({ error: "Choose a company" }, { status: 400 });
  try {
    return aiReply(await suggestNextSteps(body!.company_id as string, auth.session.user.id));
  } catch (err) {
    return serverError(err, "Could not suggest next steps");
  }
}
