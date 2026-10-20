import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { createCompany, listCompanies } from "@/lib/crm/service";
import { cleanCompanyInput, cleanCompanyQuery } from "@/lib/crm/validate";

export async function GET(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  try {
    const query = cleanCompanyQuery(new URL(request.url).searchParams);
    return NextResponse.json({ ...(await listCompanies(query)), page: query.page, pageSize: query.pageSize });
  } catch (err) {
    return serverError(err, "Could not load the companies");
  }
}

/**
 * Creates a company. If it looks like one already in the CRM, nothing is saved and the matches come back (409),
 * so the person can open the existing one or confirm it is genuinely new by sending confirmDuplicate.
 */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const body = await readJson(request);
  const cleaned = cleanCompanyInput(body);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const confirm = (body as { confirmDuplicate?: unknown })?.confirmDuplicate === true;
    const result = await createCompany(cleaned.value, auth.session.user.id, confirm);
    if ("duplicates" in result) return NextResponse.json({ error: "This looks like a company that is already in the CRM", duplicates: result.duplicates }, { status: 409 });
    return NextResponse.json({ id: result.id });
  } catch (err) {
    return serverError(err, "Could not save the company");
  }
}
