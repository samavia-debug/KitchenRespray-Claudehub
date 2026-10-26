import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getTechnicianFacts } from "@/lib/letters/service";

export async function GET(_request: Request, { params }: { params: { userId: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  const userId = Number(params.userId);
  if (!Number.isSafeInteger(userId)) return NextResponse.json({ error: "Invalid technician" }, { status: 400 });

  try {
    const facts = await getTechnicianFacts(userId, true);
    if (!facts) return NextResponse.json({ error: "Technician not found" }, { status: 404 });
    return NextResponse.json({ facts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load the technician" }, { status: 500 });
  }
}
