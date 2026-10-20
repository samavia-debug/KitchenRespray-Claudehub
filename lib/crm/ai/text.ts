/** Text with control characters removed, trimmed, and cut to `max`. Anything that is not text becomes empty. */
export function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

/** The names of the data blocks used in prompts. Text going into one must not be able to close it early. */
const BLOCKS = ["crm_data", "company_facts", "prospect_facts", "website_text", "our_company", "approved_wording", "record", "question", "request"];
const BLOCK_TAGS = new RegExp(`<\\s*/?\\s*(?:${BLOCKS.join("|")})\\s*>`, "gi");

/**
 * Wraps text in a named block for a prompt. Text from the CRM or from a website is data, not instructions, and the
 * prompt says so; removing anything inside it that looks like one of the block tags stops it pretending to end the
 * data and start new instructions.
 */
export function block(tag: string, content: string): string {
  return `<${tag}>\n${content.replace(BLOCK_TAGS, "")}\n</${tag}>`;
}

/** A model's plain-text answer, made safe to show. */
export function cleanAnswer(text: string, max = 4000): string {
  return clean(text, max).replace(/\n{3,}/g, "\n\n");
}

/** Lower-case, quote-less, single-spaced text, for checking that a quote really is in a passage. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[\s ]+/g, " ")
    .trim();
}

/**
 * True when `quote` appears word for word in `passage`, ignoring case, quote marks and spacing. A quote has to be
 * long enough to mean something (by default at least two words and 12 characters), so a single common word that
 * happens to be on the page cannot stand as evidence.
 */
export function quoteAppears(quote: string, passage: string, min: { chars?: number; words?: number } = {}): boolean {
  const q = normalise(quote).replace(/^\.{3}|\.{3}$|^…|…$/g, "").trim();
  if (q.length < (min.chars ?? 12) || q.split(" ").length < (min.words ?? 2)) return false;
  return normalise(passage).includes(q);
}
