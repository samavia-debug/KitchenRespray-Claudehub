import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { changeStatus, deleteDraft, getLetter, updateLetter } from "@/lib/letters/service";
import { cleanLetterInput, type StatusAction } from "@/lib/letters/validate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS: StatusAction[] = ["finalise", "approve", "reopen"];

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const letter = await getLetter(params.id);
    if (!letter) return NextResponse.json({ error: "Letter not found" }, { status: 404 });
    return NextResponse.json({ letter });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load the letter" }, { status: 500 });
  }
}

/**
 * Either changes the status ({ action }) or saves edits to a draft (the letter
 * fields). A status is never taken from the request body: it only moves
 * through the checked transitions.
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => null);

  try {
    if (body && typeof body === "object" && "action" in body) {
      const action = (body as { action: unknown }).action as StatusAction;
      if (!ACTIONS.includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
      const result = await changeStatus(params.id, action, auth.session.user.id);
      return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
    }

    const cleaned = cleanLetterInput(body);
    if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
    const result = await updateLetter(params.id, cleaned.value, auth.session.user.id);
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not update the letter" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const result = await deleteDraft(params.id, auth.session.user.id);
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not delete the letter" }, { status: 500 });
  }
}
