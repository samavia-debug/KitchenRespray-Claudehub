import { NextResponse } from "next/server";
import { crmAdmin, readJson, serverError } from "@/lib/crm/http";
import { saveCategory, saveStage } from "@/lib/crm/service";
import { isUuid } from "@/lib/crm/validate";

/**
 * Adds or changes a category or pipeline stage (Admin only): rename it, switch it on or off, or move it.
 * Nothing needs a code change.
 */
export async function POST(request: Request) {
  const auth = await crmAdmin();
  if ("error" in auth) return auth.error;

  const body = (await readJson(request)) as Record<string, unknown> | null;
  if (!body || (body.kind !== "category" && body.kind !== "stage")) return NextResponse.json({ error: "Unknown setting" }, { status: 400 });
  if (body.id !== undefined && !isUuid(body.id)) return NextResponse.json({ error: "Not valid" }, { status: 400 });
  if (body.name !== undefined && typeof body.name !== "string") return NextResponse.json({ error: "A name must be text" }, { status: 400 });
  if (body.active !== undefined && typeof body.active !== "boolean") return NextResponse.json({ error: "Active must be true or false" }, { status: 400 });
  if (body.sort_order !== undefined && (typeof body.sort_order !== "number" || !Number.isFinite(body.sort_order))) {
    return NextResponse.json({ error: "The order must be a number" }, { status: 400 });
  }

  const input = { id: body.id as string | undefined, name: body.name as string | undefined, active: body.active as boolean | undefined, sort_order: body.sort_order as number | undefined };
  try {
    const result = body.kind === "category" ? await saveCategory(auth.session.user.id, input) : await saveStage(auth.session.user.id, input);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    return serverError(err, "Could not save the setting");
  }
}
