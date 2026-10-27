import { NextResponse } from "next/server";
import { lettersAccess } from "@/lib/letters/route-auth";
import { getSignerImage } from "@/lib/letters/signer-service";
import { SIGNER_ID } from "@/lib/letters/signers";

/**
 * The signature picture, for the letter preview and the signer's own page. Admins can fetch any; a Manager or Staff member only those marked
 * for sales documents (anything else looks like no picture). Never cached or shared.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const auth = await lettersAccess();
  if ("error" in auth) return auth.error;
  if (!SIGNER_ID.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const image = await getSignerImage(params.id, auth.role !== "Admin");
    if (!image) return NextResponse.json({ error: "No signature picture" }, { status: 404 });
    return new NextResponse(new Uint8Array(image.data), {
      headers: {
        "Content-Type": image.type === "png" ? "image/png" : "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not load the picture" }, { status: 500 });
  }
}
