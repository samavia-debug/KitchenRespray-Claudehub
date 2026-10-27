import { TOKEN_LABEL, tokenValues, type StockContext } from "./stock";

// When a detail is changed after the letter has been written (a start date added, a name corrected), the letter's own wording is
// kept and only that detail is swapped. A [CONFIRM: ...] note for it is replaced by the value now known; a value that was filled
// in is replaced by the new one wherever it stands as a whole word or phrase. Edits are never rewritten, and nothing is changed
// that was not found.

export type Letter = { subject: string; greeting: string; body: string; closing: string };
export type Change = { label: string; from: string; to: string };

// "is" and "works" turn into "was" and "worked" for former staff and are too short to find safely; the company is not a detail of the person.
const SKIPPED = new Set(["is", "works", "company"]);
const WORD = /[A-Za-z0-9]/;

/** Replaces `from` where it is a whole word or phrase (not inside another word). Returns the new text and how many were replaced. */
function replaceWhole(text: string, from: string, to: string): { text: string; count: number } {
  if (!from) return { text, count: 0 };
  let out = "";
  let at = 0;
  let count = 0;
  for (;;) {
    const found = text.indexOf(from, at);
    if (found === -1) break;
    const before = text[found - 1];
    const after = text[found + from.length];
    const whole = !(before && WORD.test(before) && WORD.test(from[0])) && !(after && WORD.test(after) && WORD.test(from[from.length - 1]));
    out += text.slice(at, found) + (whole ? to : from);
    at = found + from.length;
    if (whole) count++;
  }
  return { text: out + text.slice(at), count };
}

function swapIn(text: string, key: string, from: string, to: string): { text: string; count: number } {
  // What was missing is shown as a [CONFIRM: ...] note; the value that is now known takes its place.
  if (!from) return to ? replaceWhole(text, `[CONFIRM: ${TOKEN_LABEL[key] ?? key}]`, to) : { text, count: 0 };
  if (!to) return { text, count: 0 }; // a value taken away is left in the text: removing words from a letter is the person's call
  if (from.length < 3) return { text, count: 0 };
  return replaceWhole(text, from, to);
}

/** The letter with the details that have changed since it was written swapped in, and what was swapped. */
export function refreshLetter(letter: Letter, was: StockContext, now: StockContext): { letter: Letter; changes: Change[] } {
  const before = tokenValues(was);
  const after = tokenValues(now);
  const done = new Set<string>();
  const changes: Change[] = [];
  let next = { ...letter };

  for (const key of Object.keys(after)) {
    if (SKIPPED.has(key) || before[key] === after[key]) continue;
    // purposeText is the same words as purpose for a one-paragraph letter; swapping both would hit the same text twice.
    const id = `${before[key]}\u0000${after[key]}`;
    if (done.has(id)) continue;

    let count = 0;
    const swapped = {} as Letter;
    for (const field of ["subject", "greeting", "body", "closing"] as const) {
      const r = swapIn(next[field], key, before[key], after[key]);
      swapped[field] = r.text;
      count += r.count;
    }
    if (count > 0) {
      next = swapped;
      done.add(id);
      changes.push({ label: TOKEN_LABEL[key] ?? key, from: before[key] || "(not known)", to: after[key] });
    }
  }

  // A letter greeted "Dear Sir or Madam," because it had no name becomes "Dear <name>," once there is one.
  const name = now.recipient.name?.trim();
  if (!was.recipient.name?.trim() && name && next.greeting === "Dear Sir or Madam,") {
    next = { ...next, greeting: `Dear ${name},`, closing: next.closing === "Yours faithfully," ? "Yours sincerely," : next.closing };
    changes.push({ label: "the name of the person it is addressed to", from: "(not known)", to: name });
  }

  return { letter: next, changes };
}
