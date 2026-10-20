import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { aiReply } from "@/lib/crm/ai/http";
import { researchCompany } from "@/lib/crm/ai/service";
import { cleanResearchInput } from "@/lib/crm/ai/validate";

export const maxDuration = 60;

/**
 * Organises what is known about a company, and, only if asked, reads the company's own website (the address on its
 * record, if that site's robots.txt allows it). Every suggestion carries a quote it can be checked against and is
 * unverified. Nothing is changed: the person chooses what to apply.
 */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanResearchInput(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  try {
    return aiReply(await researchCompany(cleaned.value, auth.session.user.id));
  } catch (err) {
    return serverError(err, "Could not research that company");
  }
}
