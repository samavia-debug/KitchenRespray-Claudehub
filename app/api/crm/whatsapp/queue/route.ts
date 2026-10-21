import { NextResponse } from "next/server";
import { crmAccess, readJson, serverError } from "@/lib/crm/http";
import { isUuid, MAX_BULK } from "@/lib/crm/validate";
import { buildQueue } from "@/lib/crm/whatsapp-service";

/**
 * What the WhatsApp send queue needs for the selected companies: the number to open, the county's running special, whether
 * a WhatsApp already went out today, and the two fixed messages. It reads only; nothing is sent or recorded here.
 */
export async function POST(request: Request) {
  const auth = await crmAccess();
  if ("error" in auth) return auth.error;

  const body = (await readJson(request)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? (body?.ids as unknown[]) : [];
  if (ids.length === 0) return NextResponse.json({ error: "Select at least one company" }, { status: 400 });
  if (ids.length > MAX_BULK) return NextResponse.json({ error: `Select no more than ${MAX_BULK} companies at a time` }, { status: 400 });
  if (!ids.every(isUuid)) return NextResponse.json({ error: "One of the selected companies is not valid" }, { status: 400 });

  try {
    return NextResponse.json(await buildQueue(Array.from(new Set(ids as string[]))), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return serverError(err, "Could not prepare the WhatsApp queue");
  }
}
