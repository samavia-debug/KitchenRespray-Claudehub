import { NextResponse } from "next/server";
import { typesFor } from "@/lib/letters/access";
import { lettersAccess, mayUse } from "@/lib/letters/route-auth";
import { createLetter, limitSigner, listLetters } from "@/lib/letters/service";
import { cleanLetterInput } from "@/lib/letters/validate";

// Letters about staff are confidential employment correspondence: Admin only. Customer letters and quotes are open to Managers and
// Staff too, so a list holds only the kinds of letter the caller may use.
export async function GET() {
  const auth = await lettersAccess();
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json({ letters: await listLetters(auth.role === "Admin" ? undefined : typesFor(auth.role)) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load letters" }, { status: 500 });
  }
}

/** Saves a new draft. */
export async function POST(request: Request) {
  const auth = await lettersAccess();
  if ("error" in auth) return auth.error;

  const cleaned = cleanLetterInput(await request.json().catch(() => null));
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  if (!mayUse(auth, cleaned.value.letter_type)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  try {
    const id = await createLetter(await limitSigner(cleaned.value, auth.role), auth.userId);
    return NextResponse.json({ id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not save the letter" }, { status: 500 });
  }
}
