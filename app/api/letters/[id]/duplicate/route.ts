import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { duplicateLetter } from "@/lib/letters/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const id = await duplicateLetter(params.id, auth.session.user.id);
    if (!id) return NextResponse.json({ error: "Letter not found" }, { status: 404 });
    return NextResponse.json({ id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not duplicate the letter" }, { status: 500 });
  }
}
