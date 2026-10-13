import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { FACT_LABEL, LETTER_TYPE_BY_KEY, type FactKey, type LetterTypeKey } from "@/lib/letters/config";
import { generateLetter, todayIso } from "@/lib/letters/service";
import { cleanDetails, cleanRecipient } from "@/lib/letters/validate";
import { validIsoDate } from "@/lib/compliance/extract";

// Thinking plus a letter-length answer can take a while.
export const maxDuration = 60;

/** Writes a draft with the AI service. Nothing is saved or sent: the page shows the draft for editing. */
export async function POST(request: Request) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as Record<string, any> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Nothing was sent" }, { status: 400 });

  const type = body.letter_type as string;
  const config = LETTER_TYPE_BY_KEY[type];
  if (!config) return NextResponse.json({ error: "Choose a letter type" }, { status: 400 });

  const userId = Number(body.technician_user_id);
  if (!Number.isSafeInteger(userId)) return NextResponse.json({ error: "Choose a technician" }, { status: 400 });

  const letterDate = validIsoDate(body.letter_date) ?? todayIso();
  const recipient = cleanRecipient(body.recipient);
  const details = cleanDetails(body.details);

  if (config.purposeRequired && !details.purpose) return NextResponse.json({ error: `${config.purposeLabel.replace(/\?$/, "")} is required` }, { status: 400 });
  if (config.recipient === "required" && !recipient.name && !recipient.organisation) {
    return NextResponse.json({ error: "Say who the letter is for" }, { status: 400 });
  }

  // Values typed in for this letter only; only known fact fields are accepted.
  const added: Partial<Record<FactKey, string>> = {};
  const rawAdded = body.added && typeof body.added === "object" ? body.added : {};
  for (const key of Object.keys(FACT_LABEL) as FactKey[]) {
    if (typeof rawAdded[key] === "string") added[key] = rawAdded[key];
  }

  const name = typeof body.name === "string" ? body.name : undefined;
  const result = await generateLetter({ technicianUserId: userId, name, letterType: type as LetterTypeKey, added, recipient, details, letterDate }, auth.session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // A letter to the technician themselves is addressed to them.
  const addressedTo = config.recipient === "technician" && !recipient.name ? result.facts.name : recipient.name;
  return NextResponse.json({ draft: result.draft, facts: result.facts, recipientName: addressedTo ?? "" });
}
