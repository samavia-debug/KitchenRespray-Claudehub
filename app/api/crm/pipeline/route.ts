import { NextResponse } from "next/server";
import { crmAccess, serverError } from "@/lib/crm/http";
import { pipelineSummary } from "@/lib/crm/service";
import { isUuid } from "@/lib/crm/validate";

// Counts and values per stage, optionally for one person or one category.
export async function GET(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const params = new URL(request.url).searchParams;
  const assigned = params.get("assigned_to");
  const category = params.get("category_id");
  try {
    const stages = await pipelineSummary({
      assigned_to: assigned === "none" ? "none" : isUuid(assigned) ? assigned : null,
      category_id: isUuid(category) ? category : null,
    });
    return NextResponse.json({ stages });
  } catch (err) {
    return serverError(err, "Could not load the pipeline");
  }
}
