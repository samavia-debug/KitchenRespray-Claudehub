import { openZip, ZipError, type Zip } from "./zip-read";

// Reads the first (or a chosen) sheet of an .xlsx as rows of text. An .xlsx is a ZIP of XML files; the cell values
// are in the sheet, with text kept in a shared list. Only what an import needs is read: values and hyperlinks.

export type Workbook = { sheets: string[]; sheetIndex: number; rows: string[][] };

const MAX_COLUMNS = 200;
const MAX_ROWS_SCANNED = 100_000;

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

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decodeXml(m[2] ?? m[3] ?? "") : null;
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
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out += decodeXml(m[1] ?? "");
  return out;
}

function sharedStrings(zip: Zip): string[] {
  const buf = zip.read("xl/sharedStrings.xml");
  if (!buf) return [];
  const xml = buf.toString("utf8");
  const out: string[] = [];
  const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(textOf(m[1] ?? ""));
  return out;
}

function relationships(zip: Zip, path: string): Map<string, string> {
  const map = new Map<string, string>();
  const buf = zip.read(path);
  if (!buf) return map;
  for (const tag of buf.toString("utf8").match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attr(tag, "Id");
    const target = attr(tag, "Target");
    if (id && target) map.set(id, target);
  }
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
  for (const tag of workbookXml.toString("utf8").match(/<sheet\b[^>]*>/g) ?? []) {
    const name = attr(tag, "name");
    const rid = attr(tag, "r:id") ?? attr(tag, "id");
    const target = rid ? rels.get(rid) : null;
    if (name && target) sheets.push({ name, path: resolve("xl/workbook.xml", target) });
  }
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
  for (const tag of xml.match(/<hyperlink\b[^>]*>/g) ?? []) {
    const rid = attr(tag, "r:id") ?? attr(tag, "id");
    const ref = attr(tag, "ref");
    const target = rid ? sheetRels.get(rid) : null;
    if (!ref || !target || !/^(https?:|mailto:)/i.test(target)) continue;
    const [from, to] = ref.split(":");
    const a = cellRef(from);
    const b = cellRef(to ?? from);
    if (!a || !b || (b.row - a.row + 1) * (b.col - a.col + 1) > 5000) continue;
    for (let r = a.row; r <= b.row; r++) for (let c = a.col; c <= b.col; c++) links.set(`${c},${r}`, target.replace(/^mailto:/i, ""));
  }

  const grid: Map<number, string>[] = [];
  let nextRow = 0;
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const rowAttr = attr(rm[1], "r");
    const r = rowAttr ? parseInt(rowAttr, 10) - 1 : nextRow;
    nextRow = r + 1;
    if (r < 0 || r > MAX_ROWS_SCANNED) continue;
    const cells = new Map<number, string>();
    let nextCol = 0;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[2] ?? ""))) {
      const ref = attr(cm[1], "r");
      const pos = ref ? cellRef(ref) : null;
      const c = pos ? pos.col : nextCol;
      nextCol = c + 1;
      if (c < 0 || c >= MAX_COLUMNS) continue;

      const type = attr(cm[1], "t");
      const body = cm[2] ?? "";
      let value = "";
      if (type === "s") value = strings[parseInt(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "", 10)] ?? "";
      else if (type === "inlineStr") value = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "str" || type === "d") value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      else if (type === "b") value = /<v>\s*1\s*<\/v>/.test(body) ? "TRUE" : "FALSE";
      else if (type === "e") value = "";
      else value = plainNumber(decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ""));

      const link = links.get(`${c},${r}`);
      if (link) value = link;
      if (value !== "") cells.set(c, value);
    }
    if (cells.size) grid[r] = cells;
  }

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
