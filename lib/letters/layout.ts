import { LETTER_TYPE_BY_KEY } from "./config";
import { formatLongDate } from "./facts";
import { parseBlocks, type Block } from "./format";
import { SIGNER_ID, showSignatureImage } from "./signers";
import type { LetterDetails, Recipient } from "./prompt";

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
  /** Typed over the address block and the signature on this letter only; the rest of `details` is not used for layout. */
  details?: Pick<LetterDetails, "addressBlock" | "signatureBlock" | "signerId">;
};

export type RenderedLetter = {
  banner: string | null;
  letterhead: string[];
  dateText: string;
  recipientLines: string[];
  subject: string;
  greeting: string;
  paragraphs: string[];
  /** The same text as paragraphs, lists and bold or italic runs. */
  blocks: Block[];
  closing: string;
  /** Typed signatory block; empty lines leave room for a handwritten signature. */
  signature: string[];
  /** The signer whose signature picture goes above the typed name, only once the letter may show one. */
  signerId: string | null;
  footer: string | null;
};

const lines = (s: string | null | undefined) => (s ? s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []);

/** The addressee block built from the recipient details: name, organisation, address, then phone and email. */
export function recipientLinesOf(r: Recipient): string[] {
  return [r.name, r.organisation, ...lines(r.address), r.phone ? `Tel: ${r.phone}` : "", r.email ? `Email: ${r.email}` : ""].filter((x): x is string => !!x && !!x.trim());
}

/** The sign-off: room to sign, then the signatory's name and title. */
export function signatureLinesOf(settings: Pick<LetterSettings, "signatory_name" | "signatory_title">): string[] {
  return settings.signatory_name
    ? ["", "", settings.signatory_name, settings.signatory_title || ""].filter((l, i) => i < 2 || !!l)
    : ["", "", "[Signatory not set — add it in the Letter Writer settings]"];
}

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

/**
 * `artwork` is for the company letterhead artwork, which carries the logo, address and contact details itself, so
 * the typed letterhead lines are left off rather than printed on top of it.
 */
export function renderLetter(settings: LetterSettings, c: LetterContent, options: { artwork?: boolean } = {}): RenderedLetter {
  const contact = [settings.phone, settings.email, settings.website].filter(Boolean).join("  ·  ");
  const letterhead = options.artwork ? [] : [settings.company_name || "", ...lines(settings.address), contact].filter(Boolean);

  // Words typed over the address block or the signature on this letter win over the ones built from the details.
  const typedAddress = lines(c.details?.addressBlock);
  const typedSignature = lines(c.details?.signatureBlock);
  const recipientLines = typedAddress.length > 0 ? typedAddress : recipientLinesOf(c.recipient || {});
  const signature = typedSignature.length > 0 ? ["", "", ...typedSignature] : signatureLinesOf(settings);

  return {
    banner: bannerFor(c.status, c.letter_type),
    letterhead,
    dateText: formatLongDate(c.letter_date),
    recipientLines,
    subject: c.subject.trim(),
    greeting: c.greeting.trim(),
    paragraphs: c.body.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    blocks: parseBlocks(c.body),
    closing: c.closing.trim(),
    signature,
    signerId: c.details?.signerId && SIGNER_ID.test(c.details.signerId) && showSignatureImage(c.status, c.letter_type) ? c.details.signerId : null,
    footer: settings.footer_text?.trim() || null,
  };
}
