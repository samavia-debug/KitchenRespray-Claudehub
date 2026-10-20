import { NextResponse } from "next/server";
import { createOpportunity, listOpportunities } from "@/lib/crm/activity-service";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { cleanOpportunityInput, isUuid } from "@/lib/crm/validate";

// A company's opportunities (separate potential jobs).
export async function GET(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  const companyId = new URL(request.url).searchParams.get("company_id");
  if (!isUuid(companyId)) return NextResponse.json({ error: "Choose a company" }, { status: 400 });
  try {
    return NextResponse.json({ opportunities: await listOpportunities(companyId) });
  } catch (err) {
    return serverError(err, "Could not load the opportunities");
  }
}

export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanOpportunityInput(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const result = await createOpportunity(cleaned.value as Parameters<typeof createOpportunity>[0], auth.session.user.id);
    if ("notFound" in result) return NextResponse.json({ error: "That company was not found" }, { status: 404 });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "Could not save the opportunity");
  }
}
