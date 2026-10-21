import { NextResponse } from "next/server";
import { crmAccess, crmOverseer, readJson, serverError } from "@/lib/crm/http";
import { dublinToday } from "@/lib/crm/followups";
import { listSpecials, createSpecial, specialResults } from "@/lib/crm/specials-service";
import { runningFor } from "@/lib/crm/specials";
import { normalizeCounty } from "@/lib/crm/territories";
import { cleanSpecialInput } from "@/lib/crm/validate";

export const maxDuration = 60;

export const dynamic = "force-dynamic";

/**
 * The specials. Everyone in the CRM can see them. ?running=1 gives only those running today, and with ?county= only those
 * that apply in that county (a special for every county always applies). ?results=1 adds what happened while each one ran,
 * which is for Admin and Manager.
 */
export async function GET(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const params = new URL(request.url).searchParams;
  const today = dublinToday();
  try {
    let specials = await listSpecials();
    if (params.get("running") === "1") {
      const county = params.has("county") ? normalizeCounty(params.get("county")) : undefined;
      specials = county === undefined ? specials.filter((s) => runningFor([s], s.county, today).length > 0) : runningFor(specials, county, today);
    }
    const overseer = auth.session.profile?.role === "Admin" || auth.session.profile?.role === "Manager";
    const results = params.get("results") === "1" && overseer ? await specialResults(specials, today) : undefined;
    return NextResponse.json({ specials, today, ...(results ? { results } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError(err, "Could not load the specials");
  }
}

// Setting up a special is for Admin and Manager.
export async function POST(request: Request) {
  const auth = await crmOverseer();
  if ("error" in auth) return auth.error;

  const cleaned = cleanSpecialInput(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    return NextResponse.json(await createSpecial(cleaned.value as Parameters<typeof createSpecial>[0], auth.session.user.id));
  } catch (err) {
    return serverError(err, "Could not save the special");
  }
}
