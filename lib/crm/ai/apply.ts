// What saving research onto a company changes. Kept apart from the screen so the rules can be tested: nothing the company
// already has is overwritten, every change is marked on the company as AI-suggested and unverified, and saving several
// suggestions together makes one change and one note.

type Current = {
  category_id?: string | null;
  services: string | null;
  description: string | null;
  notes: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
};

export type SuggestionToApply = { field: "category" | "services" | "description" | "priority" | "notes"; value: string; source: string; category_id?: string };

export const FIELD_LABEL: Record<string, string> = { category: "Category", services: "Potential services", description: "Business description", priority: "Priority", notes: "Notes" };

const join = (existing: string | null, add: string, sep: string) => (existing ? `${existing}${sep}${add}` : add);
const unique = <T,>(xs: T[]) => Array.from(new Set(xs));

/** The marker added to a company's notes, so anyone reading them knows where it came from and that nobody has checked it. */
const marker = (what: string, from: string, who: string, date: string) => `AI-assisted (${date}, ${who}): ${what} from ${from}, unverified.`;

/**
 * The change to save for these suggestions, starting from the company as it is now. Text fields are added to, never
 * replaced; category and priority are set. One note line covers everything saved.
 */
export function researchPatch(current: Current, items: SuggestionToApply[], who: string, date: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  let services = current.services;
  let description = current.description;
  let notes = current.notes;
  for (const s of items) {
    if (s.field === "category") patch.category_id = s.category_id;
    else if (s.field === "priority") patch.priority = s.value;
    else if (s.field === "services") services = join(services, s.value, "; ");
    else if (s.field === "description") description = join(description, s.value, "\n");
    else if (s.field === "notes") notes = join(notes, s.value, "\n");
  }
  if (services !== current.services) patch.services = services;
  if (description !== current.description) patch.description = description;
  const what = unique(items.map((s) => FIELD_LABEL[s.field])).join(", ");
  const from = unique(items.map((s) => s.source)).join(" and ");
  patch.notes = join(notes, marker(what, from, who, date), "\n");
  return patch;
}

const isIrishMobile = (value: string) => /^(?:3538|003538|08)\d{8}$/.test(value.replace(/\D/g, ""));

export type DetailPlacement = "email" | "mobile" | "phone" | "notes";

/**
 * Where a phone number or email found on the company's website goes: into the empty field for it (an Irish mobile into
 * Mobile, any other number into Telephone), or, when that field already has something, into the notes so nothing is lost.
 */
export function detailPatch(current: Current, kind: "email" | "phone", value: string, who: string, date: string): { patch: Record<string, unknown>; placed: DetailPlacement } {
  let placed: DetailPlacement = "notes";
  const patch: Record<string, unknown> = {};
  if (kind === "email") {
    if (!current.email) {
      patch.email = value;
      placed = "email";
    }
  } else if (isIrishMobile(value) && !current.mobile) {
    patch.mobile = value;
    placed = "mobile";
  } else if (!isIrishMobile(value) && !current.phone) {
    patch.phone = value;
    placed = "phone";
  } else if (!current.phone && isIrishMobile(value) && current.mobile) {
    // A second mobile: the Telephone field is the only other place for a number.
    patch.phone = value;
    placed = "phone";
  }
  const line =
    placed === "notes"
      ? `AI-assisted (${date}, ${who}): their website also shows ${value}; not saved to a field because the record already has one. Unverified.`
      : marker(kind === "email" ? "Email" : placed === "mobile" ? "Mobile" : "Telephone", "their website", who, date);
  patch.notes = join(current.notes, line, "\n");
  return { patch, placed };
}
