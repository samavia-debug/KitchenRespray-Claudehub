import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { cleanItemInput } from "@/lib/compliance/input";
import { getRegister } from "@/lib/compliance/service";

export const maxDuration = 30;

export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json(await getRegister());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load the register" }, { status: 500 });
  }
}

/** Adds an item by hand. Typed in by an Admin, so it counts straight away. */
export async function POST(request: Request) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  const cleaned = cleanItemInput(await request.json().catch(() => null), false);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  const holderType = (cleaned.value.holder_type as string) || "company";
  if (holderType !== "company" && !cleaned.value.holder_label) {
    return NextResponse.json({ error: holderType === "person" ? "Say whose it is" : "Say which vehicle (its registration)" }, { status: 400 });
  }

  const { data, error } = await createServiceClient()
    .from("compliance_items")
    .insert({ ...cleaned.value, status: "confirmed", source: "manual", confirmed_at: new Date().toISOString() })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
