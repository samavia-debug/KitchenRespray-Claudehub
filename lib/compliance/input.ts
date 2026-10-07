import { validIsoDate } from "./extract";
import { HOLDER_TYPES, KINDS, STATUSES } from "./summary";

type Clean = Record<string, string | boolean | number | null>;

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null);

/**
 * Checks what an Admin typed into the register. `partial` is for edits, where
 * only the fields that were sent are touched; otherwise a title and an expiry
 * date are required. Returns the columns to write, or an error to show.
 */
export function cleanItemInput(body: unknown, partial: boolean): { value: Clean } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Nothing was sent" };
  const b = body as Record<string, unknown>;
  const out: Clean = {};
  const has = (k: string) => k in b;

  if (!partial || has("title")) {
    const title = text(b.title, 160);
    if (!title) return { error: "A name is required, for example “Driving licence”" };
    out.title = title;
  }

  if (!partial || has("expiry_date")) {
    // A confirmed item with no valid date could never warn anyone, so it is refused outright.
    const expiry = validIsoDate(b.expiry_date);
    if (!expiry) return { error: "A valid expiry date is required" };
    out.expiry_date = expiry;
  }

  if (has("issued_date")) {
    const raw = b.issued_date;
    if (raw === null || raw === "") out.issued_date = null;
    else {
      const issued = validIsoDate(raw);
      if (!issued) return { error: "The issue date is not a valid date" };
      out.issued_date = issued;
    }
  }

  if (has("kind")) {
    if (!(KINDS as readonly string[]).includes(b.kind as string)) return { error: "Unknown type" };
    out.kind = b.kind as string;
  }

  if (has("holder_type")) {
    if (!(HOLDER_TYPES as readonly string[]).includes(b.holder_type as string)) return { error: "Unknown holder" };
    out.holder_type = b.holder_type as string;
  }

  if (has("holder_label")) out.holder_label = text(b.holder_label, 120);
  if (has("notes")) out.notes = text(b.notes, 1000);

  if (has("status")) {
    if (!(STATUSES as readonly string[]).includes(b.status as string)) return { error: "Unknown status" };
    out.status = b.status as string;
  }

  if (out.holder_type === "company") out.holder_label = null;
  if ((out.holder_type === "person" || out.holder_type === "vehicle") && has("holder_label") && !out.holder_label) {
    return { error: out.holder_type === "person" ? "Say whose it is" : "Say which vehicle (its registration)" };
  }

  return { value: out };
}
