import { buildZip } from "@/lib/letters/zip";

export type Cell = string | number | null | undefined;

/**
 * A value that a spreadsheet program would run as a formula ("=...", "+...", "-...", "@...") is written as text, so
 * a company or note that starts with one of those characters cannot do anything when the file is opened.
 */
export function protectFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** CSV that Excel opens correctly: UTF-8 with a byte-order mark, quoted where needed, Windows line ends. */
export function toCsv(headers: string[], rows: Cell[][]): Buffer {
  const field = (c: Cell): string => {
    if (c === null || c === undefined) return "";
    const text = typeof c === "number" ? String(c) : protectFormula(c);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers, ...rows].map((r) => r.map(field).join(","));
  return Buffer.from(`﻿${lines.join("\r\n")}\r\n`, "utf8");
}

// Characters XML cannot hold.
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

const esc = (s: string) => s.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** A sheet name Excel accepts: at most 31 characters, none of  [ ] : * ? / \ */
export function safeSheetName(name: string): string {
  return name.replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet1";
}

/** A real .xlsx: bold frozen header row, sensible column widths, text kept as text (so nothing is run as a formula). */
export function buildXlsx(sheetName: string, headers: string[], rows: Cell[][]): Buffer {
  const widths = headers.map((h, c) => Math.min(60, Math.max(10, h.length + 2, ...rows.slice(0, 200).map((r) => String(r[c] ?? "").split("\n")[0].length + 2))));
  const cell = (c: Cell, col: number, row: number, style = 0): string => {
    const ref = `${columnName(col)}${row}`;
    if (c === null || c === undefined || c === "") return "";
    if (typeof c === "number" && Number.isFinite(c)) return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${c}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${esc(String(c))}</t></is></c>`;
  };
  const sheetRows = [headers, ...rows].map((r, i) => `<row r="${i + 1}">${r.map((c, col) => cell(c, col, i + 1, i === 0 ? 1 : 0)).join("")}</row>`).join("");

  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${ns}>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${sheetRows}</sheetData></worksheet>`;

  const files = [
    { name: "[Content_Types].xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(safeSheetName(sheetName))}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${ns}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", text: sheet },
  ];
  return buildZip(files.map((f) => ({ name: f.name, data: Buffer.from(f.text, "utf8") })));
}
