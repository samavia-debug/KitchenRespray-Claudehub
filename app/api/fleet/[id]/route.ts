import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { cleanVanInput } from "@/lib/fleet/fleet";
import { deleteVan, updateVan } from "@/lib/fleet/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const cleaned = cleanVanInput(await request.json().catch(() => null));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const result = await updateVan(params.id, cleaned.value, auth.session.user.id);
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not update the van" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const result = await deleteVan(params.id);
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not delete the van" }, { status: 500 });
  }
}
