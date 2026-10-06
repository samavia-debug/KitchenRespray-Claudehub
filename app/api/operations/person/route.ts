import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getPersonDetail } from "@/lib/connecteam/operations-sync";

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  const userId = Number(request.nextUrl.searchParams.get("userId"));
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "A valid userId is required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getPersonDetail(userId));
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load this person" }, { status: 500 });
  }
}
