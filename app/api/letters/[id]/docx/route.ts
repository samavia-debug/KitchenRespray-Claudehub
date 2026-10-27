import { NextResponse } from "next/server";
import { lettersAccess, mayUse, notFound } from "@/lib/letters/route-auth";
import { buildDocx } from "@/lib/letters/docx";
import { renderLetter } from "@/lib/letters/layout";
import { LETTERHEAD_PNG_BASE64 } from "@/lib/letters/letterhead-image";
import { getLetter, getSettings, logEvent } from "@/lib/letters/service";
import { getSignerImage } from "@/lib/letters/signer-service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = await lettersAccess();
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const [letter, settings] = await Promise.all([getLetter(params.id), getSettings()]);
    if (!letter || !mayUse(auth, letter.letter_type)) return notFound();

    const rendered = renderLetter(settings, letter, { artwork: true });
    // The signer's picture, only where the letter may show one (finalised, or approved for the sensitive kinds); a signer who has since been removed just leaves the typed name.
    const signature = rendered.signerId ? await getSignerImage(rendered.signerId, auth.role !== "Admin").catch(() => null) : null;
    const file = buildDocx(rendered, new Date(), Buffer.from(LETTERHEAD_PNG_BASE64, "base64"), signature ?? undefined);
    await logEvent(letter.id, auth.userId, "downloaded_docx", { status: letter.status, signed_picture: !!signature });

    const safeName = letter.technician_name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "technician";
    const filename = `Letter-${letter.letter_type.replace(/_/g, "-")}-${safeName}-${letter.letter_date}.docx`;
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not build the Word document" }, { status: 500 });
  }
}
