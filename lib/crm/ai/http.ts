import { NextResponse } from "next/server";
import { isFailure } from "./service";

/** The reply for an AI result: the result itself, or the reason it could not be given. Never cached. */
export function aiReply(result: unknown) {
  if (isFailure(result)) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
