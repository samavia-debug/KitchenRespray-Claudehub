import { NextResponse } from "next/server";
import { crmAccess, serverError } from "@/lib/crm/http";
import { getMeta } from "@/lib/crm/service";

// The lists the CRM screens need: categories, pipeline stages and the people a company can be assigned to.
export async function GET() {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json({ ...(await getMeta()), role: auth.session.profile?.role ?? null, me: auth.session.user.id });
  } catch (err) {
    return serverError(err, "Could not load the CRM lists");
  }
}
