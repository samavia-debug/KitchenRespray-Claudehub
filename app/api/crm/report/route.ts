import { NextResponse } from "next/server";
import { crmAccess, serverError } from "@/lib/crm/http";
import { loadReport } from "@/lib/crm/report-service";
import { isUuid } from "@/lib/crm/validate";

export const maxDuration = 60;

/**
 * The overview and reports for a date range (?range=this_week|last_week|this_month|last_month|last_30|custom, with
 * ?from= and ?to= for custom), optionally for one category (?category_id=, or "none") and one person (?staff_id=).
 * Every figure is worked out from the records. The table comparing people is only sent to Admin and Manager.
 */
export async function GET(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const p = new URL(request.url).searchParams;
  const category = p.get("category_id");
  const staff = p.get("staff_id");
  if (category && category !== "none" && !isUuid(category)) return NextResponse.json({ error: "That category is not valid" }, { status: 400 });
  if (staff && !isUuid(staff)) return NextResponse.json({ error: "That person is not valid" }, { status: 400 });

  try {
    const result = await loadReport({
      range: p.get("range"),
      from: p.get("from")?.slice(0, 10) ?? null,
      to: p.get("to")?.slice(0, 10) ?? null,
      category_id: category === "none" ? "__none__" : category || null,
      staff_id: staff || null,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

    const overseer = auth.session.profile?.role === "Admin" || auth.session.profile?.role === "Manager";
    return NextResponse.json(overseer ? result : { ...result, byStaff: [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError(err, "Could not build the report");
  }
}
