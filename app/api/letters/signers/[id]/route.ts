import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { deleteSigner, updateSigner } from "@/lib/letters/signer-service";
import { SIGNER_ID, cleanSignerInput, parseImageDataUrl, type ParsedImage } from "@/lib/letters/signers";

export const maxDuration = 30;

/** Saves the signer. `image` is a new picture, `null` removes the picture, and leaving it out keeps the one there is. */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;
  if (!SIGNER_ID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const cleaned = cleanSignerInput(body);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  let image: ParsedImage | null | undefined;
  const raw = (body as Record<string, unknown>).image;
  if (raw === null) image = null;
  else if (typeof raw === "string" && raw) {
    const parsed = parseImageDataUrl(raw);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    image = parsed.image;
  }

  try {
    const result = await updateSigner(params.id, cleaned.value, image, auth.session.user.id);
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not save the signer" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;
  if (!SIGNER_ID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const result = await deleteSigner(params.id, auth.session.user.id);
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not delete the signer" }, { status: 500 });
  }
}
