import type { StaffDetails } from "../connecteam/mapping";
import { FACT_LABEL, LETTER_TYPE_BY_KEY, type FactKey, type LetterTypeKey } from "./config";

export type FactSource = "connecteam" | "added";

export type LetterFacts = {
  /** The name to use on the letter (any one-letter code removed). */
  name: string;
  /** The name exactly as Connecteam holds it, when it differs. */
  sourceName?: string;
  former: boolean;
  values: Partial<Record<FactKey, string>>;
  /** Where each value came from, so the page can show what was added for this letter only. */
  sources: Partial<Record<FactKey, FactSource>>;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2024-03-04" (the format a date field produces) as "4 March 2024". Anything else is returned as typed. */
export function formatLongDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(Number(m[1]), month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return iso;
  return `${day} ${MONTHS[month - 1]} ${m[1]}`;
}

/**
 * Connecteam stores start dates as MM/DD/YYYY (month first; in the current
 * records the second number goes above 12 and the first never does). Reading
 * 03/04/2023 as 3 April instead of 4 March would put a wrong date on an
 * employment letter, so the order is fixed here and the page shows the result
 * as a written-out date for the person to confirm.
 */
export function startDateToIso(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatLongDate(text) === text ? null : text;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const FACT_KEYS = Object.keys(FACT_LABEL) as FactKey[];

export function factsFromStaff(name: string, details: StaffDetails): LetterFacts {
  const values: LetterFacts["values"] = {};
  const sources: LetterFacts["sources"] = {};
  for (const key of FACT_KEYS) {
    // The staff record has no home address (it is read separately), so that key is simply absent here.
    const raw = (details as Partial<Record<FactKey, string>>)[key]?.trim();
    if (!raw) continue;
    // A start date is shown written out so a day/month mix-up is easy to spot.
    const iso = key === "startDate" ? startDateToIso(raw) : null;
    values[key] = key === "startDate" ? (iso ? formatLongDate(iso) : raw) : raw;
    sources[key] = "connecteam";
  }
  return { name, former: !!details.former, values, sources };
}

/** Values typed in for this letter only. The technician's record is never touched. */
export function applyAdded(base: LetterFacts, added: Partial<Record<FactKey, string>>): LetterFacts {
  const values = { ...base.values };
  const sources = { ...base.sources };
  for (const key of FACT_KEYS) {
    const v = added[key]?.replace(/\s+/g, " ").trim();
    if (!v) continue;
    if (v !== values[key]) sources[key] = "added";
    values[key] = v.slice(0, 200);
  }
  return { ...base, values, sources };
}

export function missingFacts(type: LetterTypeKey, facts: LetterFacts): FactKey[] {
  return (LETTER_TYPE_BY_KEY[type]?.requiredFacts ?? []).filter((k) => !facts.values[k]);
}

/** Only what this letter type needs, labelled, and never contact details unless asked for. */
export function factsForModel(type: LetterTypeKey, facts: LetterFacts, includeContact: boolean): Record<string, string> {
  const config = LETTER_TYPE_BY_KEY[type];
  const keys: FactKey[] = [...(config?.sendFacts ?? [])];
  if (includeContact && config?.allowContact) keys.push("email", "phone");
  const out: Record<string, string> = { "Full name": facts.name, "Employment status": facts.former ? "former employee" : "current employee" };
  for (const k of keys) {
    const v = facts.values[k];
    if (v) out[FACT_LABEL[k]] = v;
  }
  return out;
}
