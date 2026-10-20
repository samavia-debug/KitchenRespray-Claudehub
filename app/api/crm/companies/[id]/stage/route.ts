import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { changeStage } from "@/lib/crm/service";
import { cleanStageChange, isUuid } from "@/lib/crm/validate";

/**
 * Moves a company to another pipeline stage and records who did it. Won, Lost and Not Suitable have to be
 * confirmed, and can carry outcome notes (and, for a win, the value actually won).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;
  if (!isUuid(params.id)) return NextResponse.json({ error: "That company was not found" }, { status: 404 });

  const cleaned = cleanStageChange(await readJson(request));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const result = await changeStage(params.id, cleaned.value, auth.session.user.id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ company: result.company });
  } catch (err) {
    return serverError(err, "Could not change the stage");
  }
}
