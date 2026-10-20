import { decodeCsv, parseCsv } from "./csv";
import { readXlsx } from "./xlsx-read";
import { openZip, ZipError } from "./zip-read";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_COLUMNS = 60;
const MAX_CELL_CHARS = 5000;

/** A problem with the uploaded file that the person can fix, worded for them. */
export class ImportFileError extends Error {}

export type ParsedSheet = {
  sheets: string[];
  sheetIndex: number;
  headers: string[];
  rows: string[][];
  /** How many cells were cut because they were extremely long. */
  cellsShortened: number;
};

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);

const NUMBERS_MESSAGE =
  "This is an Apple Numbers file, which cannot be read directly. In Numbers choose File, then Export To, then Excel (or CSV), save it, and upload that file instead.";

/** An Apple Numbers document is a zip whose parts are an "Index" folder of .iwa files. It is told apart from an Excel file by that. */
function isNumbersDocument(buf: Buffer): boolean {
  try {
    return openZip(buf).names.some((n) => /^Index\/[^/]*\.iwa$/i.test(n));
  } catch {
    return false;
  }
}

/**
 * Reads an uploaded .xlsx or CSV into a header row and data rows. The first row with anything in it is the header.
 * Fully empty rows and columns are dropped. A file with too many rows is refused rather than quietly cut short.
 */
export function parseSpreadsheet(filename: string, buf: Buffer, sheet = 0): ParsedSheet {
  // Checked first: a Numbers file is usually large, and "too large" would hide the real fix, which is to export it.
  if (/\.numbers$/i.test(filename)) throw new ImportFileError(NUMBERS_MESSAGE);
  if (buf.length === 0) throw new ImportFileError("That file is empty.");
  if (buf.length > MAX_FILE_BYTES) throw new ImportFileError(`That file is too large (the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB). Split it into smaller files.`);

  let raw: string[][];
  let sheets: string[] = [];
  let sheetIndex = 0;

  // Whatever it is called, a file built like a Numbers document is one.
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) && isNumbersDocument(buf)) throw new ImportFileError(NUMBERS_MESSAGE);

  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    try {
      const wb = readXlsx(buf, sheet);
      raw = wb.rows;
      sheets = wb.sheets;
      sheetIndex = wb.sheetIndex;
    } catch (err) {
      if (err instanceof ZipError) throw new ImportFileError(err.message);
      throw new ImportFileError("This Excel file could not be read. Save it again as .xlsx or CSV and try again.");
    }
  } else if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new ImportFileError("This is an old Excel (.xls) file. Open it in Excel, choose Save As, and save it as an Excel Workbook (.xlsx) or CSV.");
  } else if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) {
    throw new ImportFileError("A PDF cannot be imported. Use the original Excel or CSV file, or export the table to Excel from the program that made the PDF.");
  } else {
    if (buf.subarray(0, 2000).includes(0)) throw new ImportFileError("That does not look like a spreadsheet. Upload an Excel (.xlsx) or CSV file.");
    if (!/\.(csv|tsv|txt)$/i.test(filename)) throw new ImportFileError("Upload an Excel (.xlsx) or CSV file.");
    raw = parseCsv(decodeCsv(buf));
  }

  const nonEmpty = raw.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) throw new ImportFileError("There is nothing in that file.");
  if (nonEmpty.length - 1 > MAX_IMPORT_ROWS) throw new ImportFileError(`That file has ${nonEmpty.length - 1} rows. The limit is ${MAX_IMPORT_ROWS} at a time, so please split it.`);

  const width = Math.max(...nonEmpty.map((r) => r.length));
  const head = nonEmpty[0];
  const body = nonEmpty.slice(1);

  // Keep a column when it has a heading or any data.
  const keep: number[] = [];
  for (let c = 0; c < width; c++) if ((head[c] ?? "").trim() !== "" || body.some((r) => (r[c] ?? "").trim() !== "")) keep.push(c);
  if (keep.length > MAX_IMPORT_COLUMNS) throw new ImportFileError(`That file has ${keep.length} columns. The limit is ${MAX_IMPORT_COLUMNS}.`);

  const seen = new Map<string, number>();
  const headers = keep.map((c, i) => {
    const base = (head[c] ?? "").replace(/\s+/g, " ").trim() || `Column ${i + 1}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n === 1 ? base : `${base} (${n})`;
  });

  let cellsShortened = 0;
  const rows = body.map((r) =>
    keep.map((c) => {
      const v = (r[c] ?? "").replace(/\u0000/g, "").trim();
      if (v.length > MAX_CELL_CHARS) {
        cellsShortened++;
        return v.slice(0, MAX_CELL_CHARS);
      }
      return v;
    })
  );
  return { sheets, sheetIndex, headers, rows, cellsShortened };
}
