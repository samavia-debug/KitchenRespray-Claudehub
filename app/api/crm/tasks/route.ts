import { NextResponse } from "next/server";
import { companyTasks, createTask, listTasks } from "@/lib/crm/activity-service";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { cleanTaskInput, cleanTaskQuery, isUuid } from "@/lib/crm/validate";

/**
 * Follow-ups. With ?company_id it returns that company's open and recently completed ones; otherwise one of the
 * follow-up lists (?view=overdue|today|week|upcoming|completed, optionally ?assigned_to=) with the size of each list.
 */
export async function GET(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const params = new URL(request.url).searchParams;
  try {
    const companyId = params.get("company_id");
    if (companyId !== null) {
      if (!isUuid(companyId)) return NextResponse.json({ error: "Choose a company" }, { status: 400 });
      return NextResponse.json(await companyTasks(companyId));
    }
    const query = cleanTaskQuery(params);
    return NextResponse.json({ ...(await listTasks(query)), view: query.view, page: query.page, pageSize: query.pageSize });
  } catch (err) {
    return serverError(err, "Could not load the follow-ups");
  }
}

export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanTaskInput(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const result = await createTask(cleaned.value as Parameters<typeof createTask>[0], auth.session.user.id);
    if ("notFound" in result) return NextResponse.json({ error: "That company was not found" }, { status: 404 });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "Could not save the follow-up");
  }
}
