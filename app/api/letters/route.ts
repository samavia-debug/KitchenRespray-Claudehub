import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { createLetter, listLetters } from "@/lib/letters/service";
import { cleanLetterInput } from "@/lib/letters/validate";

// Letters are confidential employment correspondence: Admin only, like the other staff data.
export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json({ letters: await listLetters() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load letters" }, { status: 500 });
  }
}

/** Saves a new draft. */
export async function POST(request: Request) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  const cleaned = cleanLetterInput(await request.json().catch(() => null));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  try {
    const id = await createLetter(cleaned.value, auth.session.user.id);
    return NextResponse.json({ id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not save the letter" }, { status: 500 });
  }
}
