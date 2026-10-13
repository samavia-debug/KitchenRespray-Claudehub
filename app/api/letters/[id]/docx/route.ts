import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { buildDocx } from "@/lib/letters/docx";
import { renderLetter } from "@/lib/letters/layout";
import { getLetter, getSettings, logEvent } from "@/lib/letters/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const [letter, settings] = await Promise.all([getLetter(params.id), getSettings()]);
    if (!letter) return NextResponse.json({ error: "Letter not found" }, { status: 404 });

    const file = buildDocx(renderLetter(settings, letter));
    await logEvent(letter.id, auth.session.user.id, "downloaded_docx", { status: letter.status });

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
