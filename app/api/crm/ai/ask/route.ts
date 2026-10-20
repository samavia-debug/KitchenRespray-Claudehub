import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { aiReply } from "@/lib/crm/ai/http";
import { askAboutSales } from "@/lib/crm/ai/service";
import { cleanAskInput } from "@/lib/crm/ai/validate";

export const maxDuration = 60;

/**
 * Answers a question about the sales figures, from the CRM's own records for the period and filters on screen. It
 * uses the person's daily AI allowance, and records only that it was used, never the question or the answer.
 */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanAskInput(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  try {
    return aiReply(await askAboutSales(cleaned.value, auth.session.user.id));
  } catch (err) {
    return serverError(err, "Could not answer that");
  }
}
