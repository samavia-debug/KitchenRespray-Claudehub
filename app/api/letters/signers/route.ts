import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { createSigner, listSigners } from "@/lib/letters/signer-service";
import { cleanSignerInput, parseImageDataUrl, type ParsedImage } from "@/lib/letters/signers";

export const maxDuration = 30;

// A signature picture can be misused, so signers are managed by Admins only, like the letters themselves.
export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    return NextResponse.json({ signers: await listSigners() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load the signers" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const cleaned = cleanSignerInput(body);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  let image: ParsedImage | null = null;
  const raw = (body as Record<string, unknown>).image;
  if (typeof raw === "string" && raw) {
    const parsed = parseImageDataUrl(raw);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    image = parsed.image;
  }

  try {
    return NextResponse.json({ id: await createSigner(cleaned.value, image, auth.session.user.id) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not save the signer" }, { status: 500 });
  }
}
