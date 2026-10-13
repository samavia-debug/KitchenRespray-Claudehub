import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getLetter, logEvent } from "@/lib/letters/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Records that the letter was printed or saved as a PDF from the browser (the file itself never passes through the server). */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const letter = await getLetter(params.id);
  if (!letter) return NextResponse.json({ error: "Letter not found" }, { status: 404 });
  await logEvent(letter.id, auth.session.user.id, "printed", { status: letter.status });
  return NextResponse.json({ ok: true });
}
