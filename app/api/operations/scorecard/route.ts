import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getScorecard } from "@/lib/connecteam/operations-sync";
import type { GroupBy } from "@/lib/connecteam/scorecard";

export const maxDuration = 30;

const GROUPINGS: GroupBy[] = ["branch", "team", "department"];

export async function GET(request: NextRequest) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  const groupBy = (request.nextUrl.searchParams.get("groupBy") ?? "branch") as GroupBy;
  if (!GROUPINGS.includes(groupBy)) {
    return NextResponse.json({ error: "groupBy must be branch, team or department" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getScorecard(groupBy));
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not build the scorecard" }, { status: 500 });
  }
}
