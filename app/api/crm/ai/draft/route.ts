import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { aiReply } from "@/lib/crm/ai/http";
import { draftMessage } from "@/lib/crm/ai/service";
import { cleanDraftInput } from "@/lib/crm/ai/validate";

export const maxDuration = 60;

/**
 * Drafts an introduction or follow-up for a company. It is shown for editing and copying: nothing is sent, nothing is
 * saved, and nothing is logged as sent.
 */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanDraftInput(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  try {
    return aiReply(await draftMessage(cleaned.value, auth.session.user.id));
  } catch (err) {
    return serverError(err, "Could not write the draft");
  }
}
