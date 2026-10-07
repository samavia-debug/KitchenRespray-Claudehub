import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { cleanItemInput } from "@/lib/compliance/input";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Edit an item, or confirm / dismiss a suggestion. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const cleaned = cleanItemInput(await request.json().catch(() => null), true);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  const changes: Record<string, unknown> = { ...cleaned.value, updated_at: new Date().toISOString() };
  const supabase = createServiceClient();

  const { data: current } = await supabase.from("compliance_items").select("status, expiry_date, holder_type, holder_label").eq("id", params.id).single();
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextStatus = (changes.status as string) ?? current.status;
  const nextHolder = (changes.holder_type as string) ?? current.holder_type;
  const nextLabel = "holder_label" in changes ? changes.holder_label : current.holder_label;
  if (nextStatus === "confirmed" && nextHolder !== "company" && !nextLabel) {
    return NextResponse.json({ error: nextHolder === "person" ? "Say whose it is before confirming" : "Say which vehicle before confirming" }, { status: 400 });
  }

  if (nextStatus === "confirmed" && current.status !== "confirmed") {
    // A person has now looked at it.
    changes.confirmed_at = new Date().toISOString();
    changes.needs_check = false;
  }
  // A new date or a fresh confirmation restarts the warnings from scratch.
  if ((changes.expiry_date && changes.expiry_date !== current.expiry_date) || (nextStatus === "confirmed" && current.status !== "confirmed")) {
    changes.alerted_stage = 0;
  }
  if (changes.expiry_date && changes.expiry_date !== current.expiry_date) changes.needs_check = false;

  const { error } = await supabase.from("compliance_items").update(changes).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { error } = await createServiceClient().from("compliance_items").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
