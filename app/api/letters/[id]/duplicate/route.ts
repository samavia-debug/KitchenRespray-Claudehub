import { NextResponse } from "next/server";
import { lettersAccess, mayUse, notFound } from "@/lib/letters/route-auth";
import { duplicateLetter, getLetter } from "@/lib/letters/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const auth = await lettersAccess();
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const source = await getLetter(params.id);
    if (!source || !mayUse(auth, source.letter_type)) return notFound();
    const id = await duplicateLetter(params.id, auth.userId);
    if (!id) return notFound();
    return NextResponse.json({ id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not duplicate the letter" }, { status: 500 });
  }
}
