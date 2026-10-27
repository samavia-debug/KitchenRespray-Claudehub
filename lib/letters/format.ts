// The light formatting a letter's text can carry, written as plain text so it is saved, searched and edited like any other
// text, and shown the same way in the preview, the print and the Word file:
//   **bold**   *italic*   "- " or "• " at the start of a line for a bullet list   "1. " for a numbered list
// A blank line starts a new paragraph. Anything that is not one of these is just text, so a stray asterisk stays an asterisk.

export type Run = { text: string; bold?: boolean; italic?: boolean };

export type Block =
  | { kind: "text"; lines: Run[][] }
  | { kind: "list"; ordered: boolean; items: Run[][] };

const INLINE = /\*\*([^*]+?)\*\*|\*([^\s*](?:[^*]*[^\s*])?)\*/g;

export function parseInline(s: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  s.replace(INLINE, (whole: string, bold: string | undefined, italic: string | undefined, at: number) => {
    if (at > last) runs.push({ text: s.slice(last, at) });
    runs.push(bold !== undefined ? { text: bold, bold: true } : { text: italic as string, italic: true });
    last = at + whole.length;
    return whole;
  });
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs.length ? runs : [{ text: "" }];
}

/** The words of a line with the formatting marks taken off, for anything that must read as plain text. */
export const plainText = (s: string): string => parseInline(s).map((r) => r.text).join("");

const BULLET = /^\s*(?:[-•]|\*(?=\s))\s+(.*)$/;
const NUMBER = /^\s*\d{1,2}[.)]\s+(.*)$/;

type Line = { kind: "text" | "bullet" | "number"; text: string };

function classify(line: string): Line {
  const b = BULLET.exec(line);
  if (b) return { kind: "bullet", text: b[1] };
  const n = NUMBER.exec(line);
  if (n) return { kind: "number", text: n[1] };
  return { kind: "text", text: line.trim() };
}

/** The letter's text as paragraphs, lists and formatted runs. */
export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  for (const paragraph of body.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const lines = paragraph.split("\n").map(classify).filter((l) => l.kind !== "text" || l.text !== "");
    let i = 0;
    while (i < lines.length) {
      if (lines[i].kind === "text") {
        const text: Run[][] = [];
        while (i < lines.length && lines[i].kind === "text") text.push(parseInline(lines[i++].text));
        blocks.push({ kind: "text", lines: text });
      } else {
        const kind = lines[i].kind;
        const items: Run[][] = [];
        while (i < lines.length && lines[i].kind === kind) items.push(parseInline(lines[i++].text));
        blocks.push({ kind: "list", ordered: kind === "number", items });
      }
    }
  }
  return blocks;
}

// ---- The buttons above the text box ----

export type FormatAction = "bold" | "italic" | "bullets" | "numbers";
export type Edit = { text: string; start: number; end: number };

function wrap(value: string, start: number, end: number, mark: string): Edit {
  const selected = value.slice(start, end);
  const m = mark.length;
  // Already wrapped, inside the selection or just around it: take the marks off again.
  if (selected.length >= 2 * m && selected.startsWith(mark) && selected.endsWith(mark)) {
    const inner = selected.slice(m, selected.length - m);
    return { text: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  if (value.slice(start - m, start) === mark && value.slice(end, end + m) === mark) {
    return { text: value.slice(0, start - m) + selected + value.slice(end + m), start: start - m, end: end - m };
  }
  if (selected === "") return { text: value.slice(0, start) + mark + mark + value.slice(end), start: start + m, end: start + m };
  return { text: value.slice(0, start) + mark + selected + mark + value.slice(end), start: start + m, end: end + m };
}

function listLines(value: string, start: number, end: number, ordered: boolean): Edit {
  // Whole lines: from the start of the first line touched to the end of the last.
  const from = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const to = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextBreak = value.indexOf("\n", to);
  const stop = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(from, stop).split("\n");

  const kind = ordered ? NUMBER : BULLET;
  const live = lines.filter((l) => l.trim() !== "");
  const allListed = live.length > 0 && live.every((l) => kind.test(l));
  let n = 0;
  const changed = lines.map((l) => {
    if (l.trim() === "") return l;
    const plain = l.replace(/^\s*(?:[-•]|\*(?=\s)|\d{1,2}[.)])\s+/, "");
    if (allListed) return plain;
    n++;
    return ordered ? `${n}. ${plain}` : `- ${plain}`;
  });
  const joined = changed.join("\n");
  return { text: value.slice(0, from) + joined + value.slice(stop), start: from, end: from + joined.length };
}

/** What a formatting button does to the text: wraps or unwraps the selection, or turns the lines it touches into a list and back. */
export function applyFormat(value: string, start: number, end: number, action: FormatAction): Edit {
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(value.length, Math.max(start, end));
  if (action === "bold") return wrap(value, a, b, "**");
  if (action === "italic") return wrap(value, a, b, "*");
  return listLines(value, a, b, action === "numbers");
}
