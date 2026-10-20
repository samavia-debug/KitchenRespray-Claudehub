import { openZip, ZipError, type Zip } from "./zip-read";

// Reads the first (or a chosen) sheet of an .xlsx as rows of text. An .xlsx is a ZIP of XML files; the cell values
// are in the sheet, with text kept in a shared list. Only what an import needs is read: values and hyperlinks.
//
// An uploaded file is untrusted, so nothing here may take longer on a hostile file than on a normal one. The XML is
// scanned in a single pass with indexOf (never a pattern that can run to the end of the file again for every tag it
// finds), an element that never closes ends the scan, and over-long attribute text is ignored.

export type Workbook = { sheets: string[]; sheetIndex: number; rows: string[][] };

const MAX_COLUMNS = 200;
const MAX_ROWS_SCANNED = 100_000;
const MAX_ATTRIBUTE_TEXT = 2000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attr(attrs: string, name: string): string | null {
  // No real tag has this much attribute text; refusing it keeps a crafted one from being scanned over and over.
  if (attrs.length > MAX_ATTRIBUTE_TEXT) return null;
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decodeXml(m[2] ?? m[3] ?? "") : null;
}

const isBreak = (code: number) => code === 32 || code === 62 || code === 47 || code === 9 || code === 10 || code === 13;

/**
 * Calls `each(attributes, inner)` for every <tag ...>...</tag> and <tag .../> in `xml`, in one pass. An element that
 * never closes ends the scan, so a damaged or hostile file costs no more than reading it once.
 */
export function elements(xml: string, tag: string, each: (attrs: string, inner: string) => void): void {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let pos = 0;
  for (;;) {
    const start = xml.indexOf(open, pos);
    if (start === -1) return;
    const after = start + open.length;
    // "<c" must not match "<cols" or "<cellXfs".
    if (after < xml.length && !isBreak(xml.charCodeAt(after))) {
      pos = after;
      continue;
    }
    const gt = xml.indexOf(">", after);
    if (gt === -1) return;
    if (xml.charCodeAt(gt - 1) === 47) {
      each(xml.slice(after, gt - 1), "");
      pos = gt + 1;
      continue;
    }
    const end = xml.indexOf(close, gt);
    if (end === -1) return;
    each(xml.slice(after, gt), xml.slice(gt + 1, end));
    pos = end + close.length;
  }
}

/** The text between the first `open` and the next `close`, or "" when either is missing. */
function between(s: string, open: string, close: string): string {
  const i = s.indexOf(open);
  if (i === -1) return "";
  const j = s.indexOf(close, i + open.length);
  return j === -1 ? "" : s.slice(i + open.length, j);
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Za-z]{1,3})(\d+)$/.exec(ref);
  return m ? { col: columnIndex(m[1]), row: parseInt(m[2], 10) - 1 } : null;
}

/** The text of a string element: every text run joined, skipping phonetic hints. */
function textOf(xml: string): string {
  let out = "";
  let pos = 0;
  while (pos < xml.length) {
    const lt = xml.indexOf("<", pos);
    if (lt === -1) break;
    const tag = xml.startsWith("<rPh", lt) ? "rPh" : xml.startsWith("<t", lt) ? "t" : "";
    if (!tag || !isBreak(xml.charCodeAt(lt + 1 + tag.length))) {
      pos = lt + 1;
      continue;
    }
    const gt = xml.indexOf(">", lt);
    if (gt === -1) break;
    if (xml.charCodeAt(gt - 1) === 47) {
      pos = gt + 1;
      continue;
    }
    const end = xml.indexOf(`</${tag}>`, gt);
    if (end === -1) break;
    if (tag === "t") out += decodeXml(xml.slice(gt + 1, end));
    pos = end + tag.length + 3;
  }
  return out;
}

function sharedStrings(zip: Zip): string[] {
  const buf = zip.read("xl/sharedStrings.xml");
  if (!buf) return [];
  const out: string[] = [];
  elements(buf.toString("utf8"), "si", (_a, inner) => out.push(textOf(inner)));
  return out;
}

function relationships(zip: Zip, path: string): Map<string, string> {
  const map = new Map<string, string>();
  const buf = zip.read(path);
  if (!buf) return map;
  elements(buf.toString("utf8"), "Relationship", (attrs) => {
    const id = attr(attrs, "Id");
    const target = attr(attrs, "Target");
    if (id && target) map.set(id, target);
  });
  return map;
}

/** Where a relationship target points, as a path inside the zip. */
function resolve(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** A number as Excel stored it, without exponent notation for long digit strings such as phone numbers. */
function plainNumber(raw: string): string {
  const v = raw.trim();
  if (!/e/i.test(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
}

export function readXlsx(buf: Buffer, wantedSheet = 0): Workbook {
  const zip = openZip(buf);
  const workbookXml = zip.read("xl/workbook.xml");
  if (!workbookXml) throw new ZipError("This is not a valid Excel (.xlsx) file.");

  const rels = relationships(zip, "xl/_rels/workbook.xml.rels");
  const sheets: { name: string; path: string }[] = [];
  elements(workbookXml.toString("utf8"), "sheet", (attrs) => {
    const name = attr(attrs, "name");
    const rid = attr(attrs, "r:id") ?? attr(attrs, "id");
    const target = rid ? rels.get(rid) : null;
    if (name && target) sheets.push({ name, path: resolve("xl/workbook.xml", target) });
  });
  if (sheets.length === 0) throw new ZipError("This Excel file has no sheets.");

  const index = Number.isInteger(wantedSheet) && wantedSheet >= 0 && wantedSheet < sheets.length ? wantedSheet : 0;
  const sheet = sheets[index];
  const sheetBuf = zip.read(sheet.path);
  if (!sheetBuf) throw new ZipError("This Excel file is missing a sheet.");
  const xml = sheetBuf.toString("utf8");
  const strings = sharedStrings(zip);

  // Hyperlinks: the link's target, for cells such as a "View on Maps" label that hides the real address.
  const links = new Map<string, string>();
  const sheetRels = relationships(zip, resolve(sheet.path, `_rels/${sheet.path.split("/").pop()}.rels`));
  elements(xml, "hyperlink", (attrs) => {
    const rid = attr(attrs, "r:id") ?? attr(attrs, "id");
    const ref = attr(attrs, "ref");
    const target = rid ? sheetRels.get(rid) : null;
    if (!ref || !target || !/^(https?:|mailto:)/i.test(target)) return;
    const [from, to] = ref.split(":");
    const a = cellRef(from);
    const b = cellRef(to ?? from);
    if (!a || !b || (b.row - a.row + 1) * (b.col - a.col + 1) > 5000) return;
    for (let r = a.row; r <= b.row; r++) for (let c = a.col; c <= b.col; c++) links.set(`${c},${r}`, target.replace(/^mailto:/i, ""));
  });

  const grid: Map<number, string>[] = [];
  let nextRow = 0;
  elements(xml, "row", (rowAttrs, rowXml) => {
    const rowAttr = attr(rowAttrs, "r");
    const r = rowAttr ? parseInt(rowAttr, 10) - 1 : nextRow;
    nextRow = r + 1;
    if (r < 0 || r > MAX_ROWS_SCANNED) return;
    const cells = new Map<number, string>();
    let nextCol = 0;
    elements(rowXml, "c", (cellAttrs, body) => {
      const ref = attr(cellAttrs, "r");
      const pos = ref ? cellRef(ref) : null;
      const c = pos ? pos.col : nextCol;
      nextCol = c + 1;
      if (c < 0 || c >= MAX_COLUMNS) return;

      const type = attr(cellAttrs, "t");
      let value = "";
      if (type === "s") value = strings[parseInt(between(body, "<v>", "</v>"), 10)] ?? "";
      else if (type === "inlineStr") value = textOf(between(body, "<is>", "</is>"));
      else if (type === "str" || type === "d") value = decodeXml(between(body, "<v>", "</v>"));
      else if (type === "b") value = between(body, "<v>", "</v>").trim() === "1" ? "TRUE" : "FALSE";
      else if (type === "e") value = "";
      else value = plainNumber(decodeXml(between(body, "<v>", "</v>")));

      const link = links.get(`${c},${r}`);
      if (link) value = link;
      if (value !== "") cells.set(c, value);
    });
    if (cells.size) grid[r] = cells;
  });

  let width = 0;
  for (const row of grid) if (row) for (const c of Array.from(row.keys())) width = Math.max(width, c + 1);
  const rows: string[][] = [];
  for (const row of grid) {
    if (!row) continue;
    const out: string[] = new Array(width).fill("");
    row.forEach((v, c) => (out[c] = v));
    rows.push(out);
  }
  return { sheets: sheets.map((s) => s.name), sheetIndex: index, rows };
}
