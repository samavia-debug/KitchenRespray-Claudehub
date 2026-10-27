import { validIsoDate } from "../compliance/extract";
import { FACT_LABEL, LETTER_TYPE_BY_KEY, type FactKey, type LetterStatus } from "./config";
import type { LetterFacts } from "./facts";
import { DRAFT_LIMITS, unresolvedPlaceholders, type LetterDetails, type Recipient } from "./prompt";

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "");
const oneLine = (v: unknown, max: number): string => text(v, max).replace(/\s+/g, " ");

export function cleanRecipient(v: unknown): Recipient {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { name: oneLine(r.name, 120), organisation: oneLine(r.organisation, 160), address: text(r.address, 400), phone: oneLine(r.phone, 60), email: oneLine(r.email, 160) };
}

export function cleanDetails(v: unknown): LetterDetails {
  const d = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const date = (x: unknown) => (typeof x === "string" && x.trim() ? validIsoDate(x) ?? oneLine(x, 60) : "");
  return {
    purpose: text(d.purpose, 2000),
    instructions: text(d.instructions, 2000),
    reference: oneLine(d.reference, 80),
    periodFrom: date(d.periodFrom),
    periodTo: date(d.periodTo),
    includeContact: d.includeContact === true,
    addressBlock: text(d.addressBlock, 600),
    signatureBlock: text(d.signatureBlock, 300),
  };
}

export function cleanFacts(v: unknown, fallbackName: string): LetterFacts {
  const f = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const values: LetterFacts["values"] = {};
  const sources: LetterFacts["sources"] = {};
  const rawValues = (f.values && typeof f.values === "object" ? f.values : {}) as Record<string, unknown>;
  const rawSources = (f.sources && typeof f.sources === "object" ? f.sources : {}) as Record<string, unknown>;
  for (const key of Object.keys(FACT_LABEL) as FactKey[]) {
    const val = oneLine(rawValues[key], 200);
    if (!val) continue;
    values[key] = val;
    sources[key] = rawSources[key] === "added" ? "added" : "connecteam";
  }
  const sourceName = oneLine(f.sourceName, 160);
  return { name: oneLine(f.name, 160) || fallbackName, ...(sourceName ? { sourceName } : {}), former: f.former === true, values, sources };
}

export type LetterInput = {
  technician_user_id: number | null;
  technician_name: string;
  technician_former: boolean;
  letter_type: string;
  subject: string;
  letter_date: string;
  recipient: Recipient;
  facts: LetterFacts;
  details: LetterDetails;
  greeting: string;
  body: string;
  closing: string;
  missing: string[];
  ai_generated: boolean;
};

/** Checks what the page sends when saving a letter. Statuses are changed only through `nextStatus`, never here. */
export function cleanLetterInput(raw: unknown): { value: LetterInput } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Nothing was sent" };
  const b = raw as Record<string, unknown>;

  const type = typeof b.letter_type === "string" ? b.letter_type : "";
  if (!LETTER_TYPE_BY_KEY[type]) return { error: "Choose a letter type" };

  const name = oneLine(b.technician_name, 160);
  if (!name) return { error: "Choose a technician" };

  const id = b.technician_user_id === null || b.technician_user_id === undefined ? null : Number(b.technician_user_id);
  if (id !== null && !Number.isSafeInteger(id)) return { error: "Invalid technician" };

  const letterDate = validIsoDate(b.letter_date);
  if (!letterDate) return { error: "Enter a valid letter date" };

  const missing = Array.isArray(b.missing)
    ? b.missing.map((m) => oneLine(m, DRAFT_LIMITS.missingItem)).filter(Boolean).slice(0, DRAFT_LIMITS.missing)
    : [];

  return {
    value: {
      technician_user_id: id,
      technician_name: name,
      technician_former: b.technician_former === true,
      letter_type: type,
      subject: oneLine(b.subject, DRAFT_LIMITS.subject),
      letter_date: letterDate,
      recipient: cleanRecipient(b.recipient),
      facts: cleanFacts(b.facts, name),
      details: cleanDetails(b.details),
      greeting: oneLine(b.greeting, DRAFT_LIMITS.greeting),
      body: text(b.body, DRAFT_LIMITS.body),
      closing: oneLine(b.closing, DRAFT_LIMITS.closing),
      missing,
      ai_generated: b.ai_generated === true,
    },
  };
}

export function cleanSettings(raw: unknown): Record<string, string | null> {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const field = (k: string, max: number, multiline = false) => (multiline ? text(b[k], max) : oneLine(b[k], max)) || null;
  return {
    company_name: field("company_name", 160),
    address: field("address", 400, true),
    phone: field("phone", 60),
    email: field("email", 160),
    website: field("website", 160),
    signatory_name: field("signatory_name", 120),
    signatory_title: field("signatory_title", 120),
    footer_text: field("footer_text", 300, true),
  };
}

// ---- Status changes ----

export type StatusAction = "finalise" | "approve" | "reopen";

export type Transition = { ok: true; status: LetterStatus } | { ok: false; error: string };

/**
 * Draft -> Finalised -> Approved, one deliberate step at a time. Nothing is ever
 * approved automatically, a letter with unconfirmed [CONFIRM: ...] placeholders
 * cannot be finalised, and reopening an approved letter withdraws the approval.
 */
export function nextStatus(current: LetterStatus, action: StatusAction, letter: { subject: string; body: string }): Transition {
  if (action === "finalise") {
    if (current !== "draft") return { ok: false, error: "Only a draft can be finalised" };
    if (!letter.subject.trim()) return { ok: false, error: "Add a subject before finalising" };
    if (!letter.body.trim()) return { ok: false, error: "The letter has no text yet" };
    const open = unresolvedPlaceholders(letter.body);
    if (open.length > 0) return { ok: false, error: `Fill in or remove the [CONFIRM: ...] items first: ${open.slice(0, 3).join("; ")}` };
    return { ok: true, status: "finalised" };
  }
  if (action === "approve") {
    if (current !== "finalised") return { ok: false, error: "Only a finalised letter can be approved" };
    return { ok: true, status: "approved" };
  }
  if (current === "draft") return { ok: false, error: "This letter is already a draft" };
  return { ok: true, status: "draft" };
}
