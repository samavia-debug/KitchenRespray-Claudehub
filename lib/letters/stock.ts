import { FACT_LABEL, LETTER_TYPE_BY_KEY, type FactKey, type LetterTypeKey } from "./config";
import { formatLongDate, type LetterFacts } from "./facts";
import { defaultSalutation, unresolvedPlaceholders, type Draft, type LetterDetails, type Recipient } from "./prompt";

// Ready-made paragraphs for each kind of letter, filled in from the staff record. This is the letter written
// without the AI service: instant, the same every time, and it only ever says what the record and the form say.
// Nothing is guessed: a detail that is not there becomes a [CONFIRM: ...] note, which the Hub already refuses to
// finalise. The wording avoids "he" and "she", and avoids praise, pay, conduct or legal claims; the person who
// writes the letter adds those if they stand behind them.

export type StockContext = { facts: LetterFacts; company: string; recipient: Recipient; details: LetterDetails };

/** What a paragraph needs before it is included automatically. */
type Need = FactKey | "purpose" | "period" | "reference" | "contactPhone" | "contactEmail";

export type StockParagraph = {
  id: string;
  /** What the person sees in the list. */
  label: string;
  text: string;
  /** "always": in every new letter of this type. "ifKnown": only when everything in `needs` is there. "never": offered, not added. */
  auto: "always" | "ifKnown" | "never";
  needs?: Need[];
};

type TypeStock = { subject: string; paragraphs: StockParagraph[] };

const CONTACT_US: StockParagraph = {
  id: "contact-us",
  label: "Please contact us",
  text: "Please do not hesitate to contact us if you need any further information.",
  auto: "always",
};

/** Offered with every letter type, never added on their own. */
export const COMMON_PARAGRAPHS: StockParagraph[] = [
  { id: "common-contact", label: "Please contact us", text: "Please do not hesitate to contact us if you need any further information.", auto: "never" },
  { id: "common-thanks", label: "Thank you", text: "Thank you for your time and assistance.", auto: "never" },
  { id: "common-receipt", label: "Ask for confirmation of receipt", text: "Please confirm that you have received this letter by replying to us.", auto: "never" },
  { id: "common-records", label: "Keep for your records", text: "Please keep this letter for your records.", auto: "never" },
  { id: "common-reference", label: "Quote the reference number", text: "Please quote reference {reference} in any reply.", auto: "never", needs: ["reference"] },
];

export const STOCK: Record<LetterTypeKey, TypeStock> = {
  employment_confirmation: {
    subject: "Confirmation of employment: {name}",
    paragraphs: [
      { id: "intro", label: "Confirms the person and their role", text: "This letter confirms that {name} {is} employed by {company} in the role of {jobTitle}.", auto: "always" },
      { id: "start", label: "Start date", text: "Employment began on {startDate}.", auto: "ifKnown", needs: ["startDate"] },
      { id: "type", label: "Full time or part time", text: "The position {is} {employmentType}.", auto: "ifKnown", needs: ["employmentType"] },
      { id: "where", label: "Branch and department", text: "{name} {works} at our {branch} branch, in the {department} department.", auto: "never", needs: ["branch", "department"] },
      { id: "id", label: "Employee ID", text: "Employee ID: {employeeId}.", auto: "never", needs: ["employeeId"] },
      { id: "why", label: "What the letter is for", text: "This letter has been provided at {name}'s request in connection with {purpose}.", auto: "ifKnown", needs: ["purpose"] },
      { id: "scope", label: "Employment only, not pay", text: "This letter confirms employment only. It is not a statement about pay or about future employment.", auto: "always" },
      CONTACT_US,
    ],
  },
  employment_reference: {
    subject: "Employment reference: {name}",
    paragraphs: [
      { id: "intro", label: "Introduces the reference", text: "I am writing to provide a reference for {name}, who {is} employed by {company} in the role of {jobTitle}.", auto: "always" },
      { id: "start", label: "Start date", text: "Employment began on {startDate}.", auto: "ifKnown", needs: ["startDate"] },
      { id: "period", label: "Period of employment", text: "Period of employment: {period}.", auto: "ifKnown", needs: ["period"] },
      { id: "type", label: "Full time or part time", text: "The position {is} {employmentType}.", auto: "ifKnown", needs: ["employmentType"] },
      { id: "points", label: "What you want it to say", text: "We can confirm the following about {name}: {purpose}.", auto: "always" },
      { id: "verify", label: "Contact us to check", text: "Please contact {company} if you would like to check any of the details above.", auto: "never" },
      CONTACT_US,
    ],
  },
  technician_introduction: {
    subject: "Introduction of {name}, {jobTitle}",
    paragraphs: [
      { id: "intro", label: "Introduces the technician", text: "I am writing to introduce {name}, who {works} for {company} in the role of {jobTitle}.", auto: "always" },
      { id: "reason", label: "Reason for the visit", text: "Reason for the introduction: {purpose}.", auto: "always" },
      { id: "dates", label: "Date of the visit", text: "Date of the visit: {period}.", auto: "ifKnown", needs: ["period"] },
      { id: "phone", label: "Technician's phone", text: "{name} can be reached on {phone}.", auto: "ifKnown", needs: ["contactPhone"] },
      { id: "email", label: "Technician's email", text: "{name} can also be reached at {email}.", auto: "ifKnown", needs: ["contactEmail"] },
      { id: "change", label: "Date may change", text: "Please let us know as soon as possible if the date needs to change.", auto: "never" },
      { id: "check", label: "Contact us to confirm", text: "Please do not hesitate to contact us if you would like to confirm anything about the visit.", auto: "always" },
    ],
  },
  work_assignment: {
    subject: "Work assignment",
    paragraphs: [
      { id: "intro", label: "Confirms the assignment", text: "This letter confirms the work you are being assigned.", auto: "always" },
      { id: "work", label: "The work", text: "Work assigned: {purpose}.", auto: "always" },
      { id: "dates", label: "Dates of the work", text: "Dates: {period}.", auto: "ifKnown", needs: ["period"] },
      { id: "team", label: "Team", text: "You are assigned as part of the {team} team.", auto: "never", needs: ["team"] },
      { id: "unclear", label: "Ask them to get in touch", text: "If anything is unclear, or you are unable to attend as arranged, please contact us as soon as possible.", auto: "always" },
    ],
  },
  experience_confirmation: {
    subject: "Confirmation of experience: {name}",
    paragraphs: [
      { id: "intro", label: "Confirms the person and their role", text: "This letter confirms that {name} {works} for {company} in the role of {jobTitle}.", auto: "always" },
      { id: "start", label: "Start date", text: "Employment began on {startDate}.", auto: "ifKnown", needs: ["startDate"] },
      { id: "period", label: "Period of experience", text: "Period of experience: {period}.", auto: "ifKnown", needs: ["period"] },
      { id: "experience", label: "The experience", text: "{name}'s experience with {company} includes: {purpose}.", auto: "always" },
      { id: "scope", label: "Experience only, not a reference", text: "This letter confirms the experience listed above and is not a reference.", auto: "always" },
      CONTACT_US,
    ],
  },
  warning: {
    subject: "Confidential: letter regarding your employment",
    paragraphs: [
      { id: "intro", label: "Opens the letter", text: "I am writing to you about a matter concerning your work with {company}.", auto: "always" },
      { id: "matter", label: "The matter, in facts", text: "The matter is as follows: {purpose}.", auto: "always" },
      { id: "dates", label: "Date(s) of the matter", text: "Date(s): {period}.", auto: "ifKnown", needs: ["period"] },
      { id: "outcome", label: "Outcome and next steps (to confirm)", text: "[CONFIRM: the outcome, and any next steps]", auto: "always" },
      { id: "previous", label: "Previous warnings (to confirm)", text: "[CONFIRM: any previous warnings on this matter, or delete this line]", auto: "never" },
      { id: "discuss", label: "Who to contact", text: "If you would like to discuss this letter, please contact [CONFIRM: who to contact].", auto: "always" },
    ],
  },
  general_business: {
    subject: "",
    paragraphs: [
      { id: "intro", label: "Says what the letter is about", text: "I am writing to you about the following: {purpose}.", auto: "always" },
      CONTACT_US,
    ],
  },
  custom: {
    subject: "",
    paragraphs: [{ id: "text", label: "Your own wording", text: "{purposeText}", auto: "always" }],
  },
};

/** The addressee block for a letter to the person themselves: name, home address (one line each) and contact details. */
export function staffAsRecipient(facts: LetterFacts): Recipient {
  const address = (facts.values.address ?? "").split(/\s*,\s*/).map((l) => l.trim()).filter(Boolean).join("\n");
  return { name: facts.name, address, phone: facts.values.phone ?? "", email: facts.values.email ?? "" };
}

/** Everything that can be added to a letter of this type: its own paragraphs first, then the general ones. */
export function stockFor(type: LetterTypeKey): StockParagraph[] {
  const own = STOCK[type]?.paragraphs ?? [];
  const taken = new Set(own.map((p) => p.text));
  return [...own, ...COMMON_PARAGRAPHS.filter((p) => !taken.has(p.text))];
}

// ---- Filling in ----

const TOKEN_LABEL: Record<string, string> = {
  name: "name",
  jobTitle: "job title",
  employmentType: "employment type",
  department: "department",
  branch: "branch",
  team: "team",
  startDate: "start date",
  employeeId: "employee ID",
  phone: "the technician's phone number",
  email: "the technician's email address",
  purpose: "the details for this letter",
  purposeText: "the text of the letter",
  period: "the dates",
  reference: "the reference number",
};

const oneLine = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** "3 March 2026 to 5 March 2026", or one date, or nothing. */
export function periodText(details: LetterDetails): string {
  const from = details.periodFrom ? formatLongDate(details.periodFrom) : "";
  const to = details.periodTo ? formatLongDate(details.periodTo) : "";
  return from && to ? `${from} to ${to}` : from || to;
}

function tokenValues(ctx: StockContext): Record<string, string> {
  const v = ctx.facts.values;
  const former = ctx.facts.former;
  return {
    name: ctx.facts.name,
    company: ctx.company,
    is: former ? "was" : "is",
    works: former ? "worked" : "works",
    jobTitle: oneLine(v.jobTitle),
    employmentType: oneLine(v.employmentType).toLowerCase(),
    department: oneLine(v.department),
    branch: oneLine(v.branch),
    team: oneLine(v.team),
    startDate: oneLine(v.startDate),
    employeeId: oneLine(v.employeeId),
    phone: oneLine(v.phone),
    email: oneLine(v.email),
    // Dropping a final full stop lets a sentence put the detail in the middle and end with its own.
    purpose: oneLine(ctx.details.purpose).replace(/[.\s]+$/, ""),
    purposeText: (ctx.details.purpose ?? "").replace(/\r\n/g, "\n").trim(),
    period: periodText(ctx.details),
    reference: oneLine(ctx.details.reference),
  };
}

/** Fills {tokens} in; one that has no value becomes a [CONFIRM: ...] note rather than a gap or a guess. */
export function fillStock(text: string, ctx: StockContext): string {
  const values = tokenValues(ctx);
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (!(key in values)) return whole;
    return values[key] || `[CONFIRM: ${TOKEN_LABEL[key] ?? key}]`;
  });
}

function needMet(need: Need, ctx: StockContext): boolean {
  const { facts, details } = ctx;
  switch (need) {
    case "purpose":
      return !!oneLine(details.purpose);
    case "period":
      return !!periodText(details);
    case "reference":
      return !!oneLine(details.reference);
    case "contactPhone":
      return !!details.includeContact && !!facts.values.phone;
    case "contactEmail":
      return !!details.includeContact && !!facts.values.email;
    default:
      return !!facts.values[need];
  }
}

/** The paragraphs a new letter of this type starts with. */
export function defaultParagraphIds(type: LetterTypeKey, ctx: StockContext): string[] {
  return (STOCK[type]?.paragraphs ?? [])
    .filter((p) => p.auto === "always" || (p.auto === "ifKnown" && (p.needs ?? []).every((n) => needMet(n, ctx))))
    .map((p) => p.id);
}

/**
 * The whole letter, written from the ready-made paragraphs. `ids` picks which ones, in the type's own order;
 * left out, it is the usual set for what is known about this person and this letter.
 */
export function buildFromStock(type: LetterTypeKey, ctx: StockContext, ids?: string[]): Draft {
  const stock = STOCK[type];
  const chosen = new Set(ids ?? defaultParagraphIds(type, ctx));
  const body = stock.paragraphs.filter((p) => chosen.has(p.id)).map((p) => fillStock(p.text, ctx));
  const subject = fillStock(stock.subject, ctx);

  // A letter to the person themselves is greeted by name even when the recipient box was left empty.
  const toThem = LETTER_TYPE_BY_KEY[type]?.recipient === "technician";
  const salutation = defaultSalutation(ctx.recipient.name || (toThem ? ctx.facts.name : undefined));

  const missing = new Set<string>(unresolvedPlaceholders(`${subject}\n\n${body.join("\n\n")}`));
  if (!subject) missing.add("Add a subject line");
  // A fact the letter type expects, even where no paragraph in use mentions it.
  for (const key of LETTER_TYPE_BY_KEY[type]?.requiredFacts ?? []) if (!ctx.facts.values[key]) missing.add(`${FACT_LABEL[key]} is not recorded for this technician`);

  return { subject, greeting: salutation.greeting, body: body.join("\n\n"), closing: salutation.closing, missing: Array.from(missing).slice(0, 10) };
}
