import { LETTER_TYPE_BY_KEY, LETTER_TYPES, type LetterTypeKey } from "./config";
import { formatLongDate, type LetterFacts } from "./facts";
import { DRAFT_LIMITS, defaultSalutation, unresolvedPlaceholders, type Draft } from "./prompt";
import { fillStock, STOCK, type StockContext } from "./stock";

// Templates are the company's own letter wording, kept in the Hub and edited by staff. They use the same {details}
// as the ready-made paragraphs, so a template fills in from the staff record exactly like "Write the letter for me".

export const TEMPLATE_CATEGORIES = [
  { key: "hr", label: "HR" },
  { key: "sales", label: "Sales" },
  { key: "quote", label: "Quote" },
  { key: "general", label: "General" },
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]["key"];

export const TEMPLATE_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(TEMPLATE_CATEGORIES.map((c) => [c.key, c.label]));

/** The category a template of this kind starts in; it can be changed. */
export function categoryForType(type: string): TemplateCategory {
  return type === "quote" ? "quote" : type === "sales_letter" ? "sales" : type === "general_business" || type === "custom" ? "general" : "hr";
}

export type TemplateInput = {
  name: string;
  category: TemplateCategory;
  letter_type: LetterTypeKey;
  subject: string;
  greeting: string;
  body: string;
  closing: string;
};

export type LetterTemplate = TemplateInput & { id: string; created_at: string; updated_at: string };

/** The details a template can use, with an example of each, for the "insert a detail" list and the sample preview. */
export const TEMPLATE_TOKENS: { token: string; label: string; example: string }[] = [
  { token: "name", label: "Staff member's name", example: "Pat Example" },
  { token: "company", label: "Company name", example: "Kitchen Respray" },
  { token: "is", label: "is / was (was for former staff)", example: "is" },
  { token: "works", label: "works / worked (worked for former staff)", example: "works" },
  { token: "jobTitle", label: "Job title", example: "Spray Technician" },
  { token: "employmentType", label: "Employment type", example: "full time" },
  { token: "department", label: "Department", example: "Production" },
  { token: "branch", label: "Branch", example: "Bray" },
  { token: "team", label: "Team", example: "Spray team" },
  { token: "startDate", label: "Start date", example: "4 March 2024" },
  { token: "employeeId", label: "Employee ID", example: "1042" },
  { token: "phone", label: "Staff member's phone", example: "086 000 0000" },
  { token: "email", label: "Staff member's email", example: "pat@example.com" },
  { token: "recipientName", label: "Name of the person it is addressed to", example: "Mr Murphy" },
  { token: "purpose", label: "The details typed in step 3", example: "a mortgage application" },
  { token: "purposeText", label: "The details typed in step 3, as written", example: "a mortgage application" },
  { token: "period", label: "The dates from step 3", example: "3 March 2026 to 5 March 2026" },
  { token: "reference", label: "Reference number", example: "KR-1042" },
];

export const SAMPLE_CONTEXT: StockContext = {
  facts: {
    name: "Pat Example",
    former: false,
    values: { jobTitle: "Spray Technician", employmentType: "Full time", department: "Production", branch: "Bray", team: "Spray team", startDate: "4 March 2024", employeeId: "1042", phone: "086 000 0000", email: "pat@example.com" },
    sources: {},
  } as LetterFacts,
  company: "Kitchen Respray",
  recipient: { name: "Mr Murphy" },
  details: { purpose: "a mortgage application", periodFrom: "2026-03-03", periodTo: "2026-03-05", reference: "KR-1042" },
};

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "");
const oneLine = (v: unknown, max: number): string => text(v, max).replace(/\s+/g, " ");

/** Checks what the Templates screen sends. */
export function cleanTemplateInput(raw: unknown): { value: TemplateInput } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Nothing was sent" };
  const b = raw as Record<string, unknown>;

  const name = oneLine(b.name, 120);
  if (!name) return { error: "Give the template a name" };

  const category = TEMPLATE_CATEGORIES.find((c) => c.key === b.category)?.key;
  if (!category) return { error: "Choose a category" };

  const type = typeof b.letter_type === "string" ? b.letter_type : "";
  if (!LETTER_TYPE_BY_KEY[type]) return { error: "Choose the kind of letter this template is for" };

  const body = text(b.body, DRAFT_LIMITS.body);
  if (!body) return { error: "The template has no text yet" };

  return {
    value: {
      name,
      category,
      letter_type: type as LetterTypeKey,
      subject: oneLine(b.subject, DRAFT_LIMITS.subject),
      greeting: oneLine(b.greeting, DRAFT_LIMITS.greeting),
      body,
      closing: oneLine(b.closing, DRAFT_LIMITS.closing),
    },
  };
}

// ---- Fill-in boxes ----
//
// A template can ask for something that is different every time, such as the date of a conversation or what the employee said, by
// putting [[a label]] where it goes. Writing a letter from the template shows one box for each label, and what is typed goes into the
// text. A box left empty becomes a [CONFIRM: label] note, which stops the letter being finalised, like any other detail that is not known.

export type TemplateField = { label: string; kind: "text" | "date" | "long" };

const FIELD = /\[\[([^\[\]\n]{1,80})\]\]/g;
const tidyLabel = (raw: string) => raw.trim().replace(/\s+/g, " ");

/** A date for a label that says date, a larger box for an explanation, a line for anything else. */
export function fieldKind(label: string): TemplateField["kind"] {
  if (/\bdate\b|\bwhen\b/i.test(label)) return "date";
  if (/reason|why|explanation|details|describe|what happened|notes?\b/i.test(label)) return "long";
  return "text";
}

/** The fill-in boxes a template asks for, in the order they first appear, each label once. */
export function templateFields(t: Pick<TemplateInput, "subject" | "greeting" | "body" | "closing">): TemplateField[] {
  const seen = new Set<string>();
  const out: TemplateField[] = [];
  for (const text of [t.subject, t.greeting, t.body, t.closing]) {
    text.replace(FIELD, (whole: string, raw: string) => {
      const label = tidyLabel(raw);
      if (label && !seen.has(label)) {
        seen.add(label);
        out.push({ label, kind: fieldKind(label) });
      }
      return whole;
    });
  }
  return out;
}

/** Puts what was typed into each [[label]]; an empty box becomes a [CONFIRM: label] note. A date typed as 2026-10-28 is written out. */
export function fillFields(text: string, values: Record<string, string> = {}): string {
  return text.replace(FIELD, (_whole: string, raw: string) => {
    const label = tidyLabel(raw);
    const typed = (values[label] ?? "").replace(/\[\[|\]\]/g, "").replace(/\r\n/g, "\n").trim();
    if (!typed) return `[CONFIRM: ${label}]`;
    return fieldKind(label) === "date" ? formatLongDate(typed) : typed;
  });
}

/** A letter from a template: its details filled in, anything not known marked [CONFIRM: ...] like every other letter. */
export function buildFromTemplate(
  t: Pick<TemplateInput, "subject" | "greeting" | "body" | "closing" | "letter_type">,
  ctx: StockContext,
  fields: Record<string, string> = {}
): Draft {
  const subject = fillStock(fillFields(t.subject, fields), ctx);
  const body = fillStock(fillFields(t.body, fields), ctx);

  const toThem = LETTER_TYPE_BY_KEY[t.letter_type]?.recipient === "technician";
  const fallback = defaultSalutation(ctx.recipient.name || (toThem ? ctx.facts.name : undefined));
  const greeting = t.greeting.trim() ? fillStock(fillFields(t.greeting, fields), ctx) : fallback.greeting;
  const closing = t.closing.trim() ? fillStock(fillFields(t.closing, fields), ctx) : fallback.closing;

  const missing = new Set<string>(unresolvedPlaceholders(`${subject}\n\n${greeting}\n\n${body}\n\n${closing}`));
  if (!subject) missing.add("Add a subject line");
  return { subject, greeting, body, closing, missing: Array.from(missing).slice(0, DRAFT_LIMITS.missing) };
}

/**
 * The ready-made wording as templates with the {details} left in, so each can be changed. Only the paragraphs a
 * letter of that kind always has, plus start date and employment type, which every record carries.
 */
export function starterTemplates(): TemplateInput[] {
  return LETTER_TYPES.map((t) => {
    const stock = STOCK[t.key];
    const paragraphs = stock.paragraphs.filter(
      (p) => p.auto === "always" || (p.auto === "ifKnown" && (p.needs ?? []).every((n) => n === "startDate" || n === "employmentType"))
    );
    return {
      name: `${t.label} (starter)`,
      category: categoryForType(t.key),
      letter_type: t.key,
      subject: stock.subject,
      greeting: "",
      body: paragraphs.map((p) => p.text).join("\n\n"),
      closing: "",
    } as TemplateInput;
  });
}

/**
 * A saved letter's wording as a template: the person's name and the company name are put back as {name} and
 * {company}, so the template fills in for the next person. Everything else is kept exactly as written.
 */
export function generaliseLetterText(value: string, facts: { name: string }, company: string): string {
  let out = value;
  const swap = (word: string, token: string) => {
    const w = word.trim();
    if (w.length < 3) return;
    out = out.split(w).join(`{${token}}`);
  };
  swap(facts.name, "name");
  swap(company, "company");
  return out;
}
