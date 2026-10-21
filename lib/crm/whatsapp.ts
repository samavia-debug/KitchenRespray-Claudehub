// Sending WhatsApp messages one at a time from the CRM: the wording (a fixed template with a few blanks), the number to
// open, and the link that opens WhatsApp with the message already typed. Kept apart from the screen so the rules can be tested.
// Nothing here sends anything: a person presses Send in WhatsApp.

/** The blanks a template may use. {name} is the contact's first name ("there" when the company has no contact). */
export const PLACEHOLDERS = ["name", "company", "county", "sender", "offer", "code"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export const TEMPLATE_MAX = 1000;

export const DEFAULT_FIRST_MESSAGE = "Hi {name}, it's {sender} from Kitchen Respray. I wanted to introduce what we do and ask whether it could be useful to you. Is this a good number to reach you on?";
export const DEFAULT_FOLLOW_UP = "Hi {name}, it's {sender} from Kitchen Respray again. I sent a message a little while ago and wanted to check you saw it. Any questions, just reply here.";

export type WhatsappTemplates = { first_message: string; follow_up: string };
export const DEFAULT_TEMPLATES: WhatsappTemplates = { first_message: DEFAULT_FIRST_MESSAGE, follow_up: DEFAULT_FOLLOW_UP };

const BLANK = /\{([^{}\s]+)\}/g;

/** The blanks in a template that are not ones we fill in (a typo such as {nmae} would otherwise be sent as written). */
export function unknownPlaceholders(template: string): string[] {
  const found: string[] = [];
  template.replace(BLANK, (whole, word: string) => {
    if (!(PLACEHOLDERS as readonly string[]).includes(word) && found.indexOf(whole) === -1) found.push(whole);
    return whole;
  });
  return found;
}

export type Fill = { name: string | null; company: string; county: string | null; sender: string; offer: string | null; code: string | null };

/**
 * The message for one company. `problems` says what could not be filled in; a message with a problem is never offered
 * for sending, so a gap like "{offer}" cannot go out to a customer.
 */
export function fillTemplate(template: string, fill: Fill): { text: string; problems: string[] } {
  const problems: string[] = [];
  const note = (p: string) => {
    if (problems.indexOf(p) === -1) problems.push(p);
  };
  const text = template.replace(BLANK, (whole, word: string) => {
    switch (word) {
      case "name":
        return fill.name || "there";
      case "company":
        return fill.company;
      case "sender":
        return fill.sender;
      case "county":
        if (!fill.county) note("This company has no county set");
        return fill.county ?? whole;
      case "offer":
        if (!fill.offer) note(fill.county ? `No special is running in ${fill.county}` : "This company has no county set, so there is no special to use");
        return fill.offer ?? whole;
      case "code":
        if (!fill.code) note(fill.county ? `The special running in ${fill.county} has no code` : "This company has no county set, so there is no special code to use");
        return fill.code ?? whole;
      default:
        note(`The template has an unknown blank ${whole}`);
        return whole;
    }
  });
  return { text: text.trim(), problems };
}

/** The first word of a contact's name, or null when there is nothing usable ("Mr", initials and the like are not a name). */
export function firstName(fullName: string | null | undefined): string | null {
  const word = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  const clean = word.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'’-]/g, "");
  if (clean.length < 2) return null;
  if (/^(mr|mrs|ms|miss|dr|sir)$/i.test(clean)) return null;
  const word2 = clean === clean.toUpperCase() ? clean.toLowerCase() : clean;
  return word2[0].toUpperCase() + word2.slice(1);
}

export type WhatsappNumber = { number: string; mobile: boolean };

/**
 * A phone number as WhatsApp wants it: country code first, digits only ("087 123 4567" -> "353871234567"). `mobile` is
 * whether it looks like a mobile; a landline is not usually on WhatsApp, so it is not offered. Null when it is not a number.
 */
export function whatsappNumber(raw: string | null | undefined): WhatsappNumber | null {
  if (!raw) return null;
  const text = raw.replace(/\(0\)/g, "").trim();
  if (!text || /[a-z]/i.test(text.replace(/\b(ext|x)\b.*$/i, ""))) return null;
  const plus = text.startsWith("+");
  let digits = text.replace(/\D/g, "");
  if (!plus) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.startsWith("0")) digits = `353${digits.slice(1)}`;
    else return null; // no country code and no leading 0: there is no telling which country it is
  }

  if (digits.startsWith("353")) {
    let national = digits.slice(3);
    if (national.startsWith("0")) national = national.slice(1);
    if (!/^\d{7,9}$/.test(national)) return null;
    // Irish mobiles are 083 to 089 and then 7 digits, so after the country code they start with 8; a landline (01, 021...) does not.
    return { number: `353${national}`, mobile: /^8\d{8}$/.test(national) };
  }
  if (digits.length < 8 || digits.length > 15) return null;
  // Another country: there is no way to tell a mobile from a landline here, so it is offered.
  return { number: digits, mobile: true };
}

/** A link that opens WhatsApp to this number with the message typed in, ready for the person to press Send. */
export function chatLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export type NumberChoice = { number: string; shown: string; from: "mobile" | "phone" | "contact" } | { number: null; shown: string | null; reason: string };

/**
 * Which number to message: the company's mobile, then its phone if that is a mobile, then a contact's phone that is.
 * A landline on its own is reported, not offered.
 */
export function chooseNumber(company: { mobile: string | null; phone: string | null }, contactPhones: (string | null)[]): NumberChoice {
  const candidates: { raw: string; from: "mobile" | "phone" | "contact" }[] = [];
  if (company.mobile) candidates.push({ raw: company.mobile, from: "mobile" });
  if (company.phone) candidates.push({ raw: company.phone, from: "phone" });
  for (const p of contactPhones) if (p) candidates.push({ raw: p, from: "contact" });

  let landline: string | null = null;
  for (const c of candidates) {
    const n = whatsappNumber(c.raw);
    if (n?.mobile) return { number: n.number, shown: c.raw, from: c.from };
    if (n && !landline) landline = c.raw;
  }
  if (landline) return { number: null, shown: landline, reason: "Only a landline is on record, which is not usually on WhatsApp" };
  return { number: null, shown: null, reason: candidates.length ? "The number on record is not a valid phone number" : "No phone number on record" };
}
