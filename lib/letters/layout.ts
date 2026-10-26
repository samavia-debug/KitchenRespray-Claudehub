import { LETTER_TYPE_BY_KEY } from "./config";
import { formatLongDate } from "./facts";
import type { Recipient } from "./prompt";

export type LetterSettings = {
  company_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  signatory_name: string | null;
  signatory_title: string | null;
  footer_text: string | null;
};

export const EMPTY_SETTINGS: LetterSettings = {
  company_name: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  signatory_name: null,
  signatory_title: null,
  footer_text: null,
};

export type LetterContent = {
  letter_type: string;
  status: "draft" | "finalised" | "approved";
  letter_date: string;
  subject: string;
  recipient: Recipient;
  greeting: string;
  body: string;
  closing: string;
};

export type RenderedLetter = {
  banner: string | null;
  letterhead: string[];
  dateText: string;
  recipientLines: string[];
  subject: string;
  greeting: string;
  paragraphs: string[];
  closing: string;
  /** Typed signatory block; empty lines leave room for a handwritten signature. */
  signature: string[];
  footer: string | null;
};

const lines = (s: string | null | undefined) => (s ? s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []);

/**
 * A letter that has not been approved must not be mistaken for one that has,
 * once it is printed or downloaded: drafts and unapproved sensitive letters
 * carry a visible banner at the top.
 */
export function bannerFor(status: LetterContent["status"], letterType: string): string | null {
  if (status === "draft") return "DRAFT — not finalised. Remove this line only once the letter has been checked.";
  if (status === "finalised" && LETTER_TYPE_BY_KEY[letterType]?.sensitive) return "AWAITING MANAGEMENT APPROVAL — do not send until approved.";
  return null;
}

export function renderLetter(settings: LetterSettings, c: LetterContent): RenderedLetter {
  const contact = [settings.phone, settings.email, settings.website].filter(Boolean).join("  ·  ");
  const letterhead = [settings.company_name || "", ...lines(settings.address), contact].filter(Boolean);

  const r = c.recipient || {};
  const recipientLines = [r.name, r.organisation, ...lines(r.address), r.phone ? `Tel: ${r.phone}` : "", r.email ? `Email: ${r.email}` : ""].filter((x): x is string => !!x && !!x.trim());

  const signature = settings.signatory_name
    ? ["", "", settings.signatory_name, settings.signatory_title || ""].filter((l, i) => i < 2 || !!l)
    : ["", "", "[Signatory not set — add it in the Letter Writer settings]"];

  return {
    banner: bannerFor(c.status, c.letter_type),
    letterhead,
    dateText: formatLongDate(c.letter_date),
    recipientLines,
    subject: c.subject.trim(),
    greeting: c.greeting.trim(),
    paragraphs: c.body.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    closing: c.closing.trim(),
    signature,
    footer: settings.footer_text?.trim() || null,
  };
}
