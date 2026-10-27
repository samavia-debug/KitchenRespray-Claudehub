import { readXlsx } from "../crm/import/xlsx-read";
import { ZipError } from "../crm/import/zip-read";
import { IRISH_REG, parseDueDate, parseMoney, parseWeight, regKey, tidyReg } from "./fleet";

// Reads the van list spreadsheet (a header row with Reg, Model, Driver, Lender, Value, Settlement and so on, then one row per
// van) into vans. Columns are found by their headings, so a column moving or a blank column between them does not matter.
// Nothing is guessed: a cell that is not an amount or a date is reported, not turned into one.

export type ImportedVan = {
  reg: string;
  model?: string;
  driver?: string;
  lender?: string;
  agreement?: string;
  value_eur?: number;
  monthly_eur?: number;
  settlement_eur?: number;
  weight_kg?: number;
  tax_pin?: string;
  tax_due?: string;
  doe_due?: string;
  insurance_due?: string;
  /** What the sheet said where it held a month name instead of a date, to keep as a note. */
  monthNotes: string[];
  gone: boolean;
};

export type VanSheet = { vans: ImportedVan[]; warnings: string[]; headerRow: number };

type Field = "reg" | "model" | "driver" | "lender" | "agreement" | "value" | "monthly" | "settlement" | "balance" | "weight" | "pin" | "tax" | "doe" | "insurance";

const HEADINGS: Record<string, Field> = {
  reg: "reg", registration: "reg", regno: "reg", regnumber: "reg",
  model: "model", driver: "driver", lender: "lender", agreement: "agreement", value: "value",
  monthly: "monthly", monthlypayment: "monthly", settlement: "settlement", balance: "balance", weight: "weight",
  taxpin: "pin", pin: "pin",
  tax: "tax", taxexpires: "tax", taxdue: "tax",
  doe: "doe", doeexpires: "doe", doedue: "doe",
  insurance: "insurance", insuranceexpires: "insurance", insurancedue: "insurance",
};

const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function findHeader(rows: string[][]): { row: number; cols: Partial<Record<Field, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cols: Partial<Record<Field, number>> = {};
    rows[r].forEach((cell, c) => {
      const field = HEADINGS[key(cell)];
      if (field && cols[field] === undefined) cols[field] = c;
    });
    if (cols.reg !== undefined && (cols.model !== undefined || cols.driver !== undefined)) return { row: r, cols };
  }
  return null;
}

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function readVanSheet(rows: string[][]): VanSheet | null {
  const header = findHeader(rows);
  if (!header) return null;
  const { cols } = header;
  const cell = (row: string[], f: Field) => (cols[f] === undefined ? "" : clean(row[cols[f] as number]));

  const vans: ImportedVan[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (let r = header.row + 1; r < rows.length; r++) {
    const row = rows[r];
    const regText = cell(row, "reg");
    // The totals line and the lenders' addresses under the list have no registration and no model or driver: the list has ended.
    if (!regText && !cell(row, "model") && !cell(row, "driver") && vans.length > 0) break;
    if (!regText) continue;

    const reg = tidyReg(regText);
    const k = regKey(reg);
    const label = `Van ${reg}`;
    if (!IRISH_REG.test(k)) {
      if (cell(row, "model") || cell(row, "driver")) warnings.push(`${label} was skipped: it does not look like an Irish registration. Add that van by hand if it is real.`);
      continue;
    }
    if (seen.has(k)) {
      warnings.push(`${label} appears more than once; only the first is used.`);
      continue;
    }
    seen.add(k);

    const van: ImportedVan = { reg, monthNotes: [], gone: /^gone$/i.test(cell(row, "driver")) };
    for (const f of ["model", "driver", "lender", "agreement"] as const) if (cell(row, f)) van[f] = cell(row, f);
    if (cell(row, "pin")) van.tax_pin = cell(row, "pin");

    const amount = (f: Field, target: "value_eur" | "monthly_eur" | "settlement_eur", name: string) => {
      const v = parseMoney(cell(row, f));
      if (v === null) warnings.push(`${label}: ${name} "${cell(row, f)}" is not an amount, so it was left out.`);
      else if (v !== undefined) van[target] = v;
    };
    amount("value", "value_eur", "value");
    amount("monthly", "monthly_eur", "monthly payment");
    // "Settlement" is what is owed; older sheets also have a "Balance" column that mostly says "paid".
    amount(cols.settlement !== undefined ? "settlement" : "balance", "settlement_eur", "amount owed");

    const weight = parseWeight(cell(row, "weight"));
    if (weight) van.weight_kg = weight;

    for (const [f, target, name] of [["tax", "tax_due", "Tax"], ["doe", "doe_due", "DOE"], ["insurance", "insurance_due", "Insurance"]] as const) {
      const raw = cell(row, f);
      if (!raw) continue;
      const parsed = parseDueDate(raw);
      if (parsed.date) van[target] = parsed.date;
      else if (parsed.monthOnly) van.monthNotes.push(`${name} "${raw}"`);
      else warnings.push(`${label}: ${name} "${raw}" is not a date, so it was left out.`);
    }
    vans.push(van);
  }
  return { vans, warnings, headerRow: header.row + 1 };
}

export type ReadFleetFile = { sheets: string[]; sheetIndex: number; sheet: VanSheet | null };

/** Reads one sheet of an uploaded workbook. With no sheet chosen, the last one with a van list is used (the newest tab), skipping a "Gone" tab. */
export function readFleetWorkbook(buf: Buffer, wanted?: number): ReadFleetFile {
  let first: ReturnType<typeof readXlsx>;
  try {
    first = readXlsx(buf, wanted ?? 0);
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError("This Excel file could not be read. Save it again as .xlsx and try again.");
  }
  if (wanted !== undefined) return { sheets: first.sheets, sheetIndex: first.sheetIndex, sheet: readVanSheet(first.rows) };

  for (let i = first.sheets.length - 1; i >= 0; i--) {
    if (/gone/i.test(first.sheets[i])) continue;
    const wb = i === first.sheetIndex ? first : readXlsx(buf, i);
    const sheet = readVanSheet(wb.rows);
    if (sheet && sheet.vans.length > 0) return { sheets: first.sheets, sheetIndex: i, sheet };
  }
  return { sheets: first.sheets, sheetIndex: first.sheetIndex, sheet: null };
}
