import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { cleanVanInput } from "@/lib/fleet/fleet";
import { createVan, listVans, todayKey } from "@/lib/fleet/service";

// The van list holds finance figures (what is owed to lenders, monthly payments): Admin only.
export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json({ vans: await listVans(), today: todayKey() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load the vans" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  const cleaned = cleanVanInput(await request.json().catch(() => null));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const result = await createVan(cleaned.value, auth.session.user.id);
    return result.ok ? NextResponse.json({ id: result.id }) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not save the van" }, { status: 500 });
  }
}
