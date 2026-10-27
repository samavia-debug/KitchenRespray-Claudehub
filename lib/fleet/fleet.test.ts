import { describe, expect, it } from "vitest";
import {
  cleanVanInput,
  dueSoon,
  equityOf,
  fleetAlertMessage,
  fleetTotals,
  missingDates,
  parseDueDate,
  parseMoney,
  parseWeight,
  pendingFleetAlerts,
  stageOnEntry,
  tidyReg,
  type Van,
} from "./fleet";
import { readFleetFile, readVanSheet } from "./import";

const TODAY = "2026-08-26";

const van = (over: Partial<Van> = {}): Van => ({
  id: "1", reg: "191 D 30807", reg_key: "191D30807", model: "Opel Vivaro", driver: "Mike", lender: "AIB", agreement: null,
  value_eur: 15000, monthly_eur: 400, settlement_eur: 0, weight_kg: null, tax_pin: null, tax_due: null, doe_due: null, insurance_due: null,
  tax_alerted_stage: 0, doe_alerted_stage: 0, insurance_alerted_stage: 0, status: "active", notes: null, updated_at: "2026-08-01T00:00:00Z", ...over,
});

describe("reading values from a spreadsheet", () => {
  it("amounts: blank is nothing, 'paid' is zero, junk is not an amount", () => {
    expect(parseMoney("")).toBeUndefined();
    expect(parseMoney(undefined)).toBeUndefined();
    expect(parseMoney("paid")).toBe(0);
    expect(parseMoney("Paid 02/05/2025")).toBe(0);
    expect(parseMoney("9645.31")).toBe(9645.31);
    expect(parseMoney("€12,000")).toBe(12000);
    expect(parseMoney("21.130.25")).toBeNull();
    expect(parseMoney("????")).toBeNull();
    expect(parseMoney("-5")).toBeNull();
  });

  it("weights", () => {
    expect(parseWeight("3010 kg")).toBe(3010);
    expect(parseWeight("3300kg")).toBe(3300);
    expect(parseWeight("")).toBeNull();
    expect(parseWeight("heavy")).toBeNull();
  });

  it("dates are day first, an Excel date number is a date, and a month name alone is not a date", () => {
    expect(parseDueDate("2026-11-04")).toEqual({ date: "2026-11-04", monthOnly: false });
    expect(parseDueDate("04/11/2026")).toEqual({ date: "2026-11-04", monthOnly: false });
    expect(parseDueDate("4-11-26")).toEqual({ date: "2026-11-04", monthOnly: false });
    expect(parseDueDate("46260")).toEqual({ date: "2026-08-26", monthOnly: false });
    expect(parseDueDate("june")).toEqual({ date: null, monthOnly: true });
    expect(parseDueDate("Agu")).toEqual({ date: null, monthOnly: true });
    expect(parseDueDate("31/02/2026")).toEqual({ date: null, monthOnly: false });
    expect(parseDueDate("soon")).toEqual({ date: null, monthOnly: false });
    expect(parseDueDate("")).toEqual({ date: null, monthOnly: false });
  });

  it("tidies a registration", () => {
    expect(tidyReg(" 161 d  5265 ")).toBe("161 D 5265");
  });
});

describe("cleanVanInput", () => {
  const valid = { reg: "191 d 30807", model: "Opel Vivaro", value_eur: "15000", tax_due: "2026-10-01" };

  it("accepts a van and tidies it", () => {
    const r = cleanVanInput(valid);
    if (!("value" in r)) throw new Error(r.error);
    expect(r.value).toMatchObject({ reg: "191 D 30807", model: "Opel Vivaro", value_eur: 15000, tax_due: "2026-10-01", doe_due: null, status: "active" });
  });

  it("asks for what is wrong", () => {
    expect(cleanVanInput(null)).toEqual({ error: "Nothing was sent" });
    expect(cleanVanInput({ ...valid, reg: "x" })).toEqual({ error: "Enter the registration, such as 191 D 30807" });
    expect(cleanVanInput({ ...valid, doe_due: "soon" })).toEqual({ error: "DOE date is not a valid date" });
    expect(cleanVanInput({ ...valid, value_eur: "lots" })).toEqual({ error: "Value must be an amount in euro" });
    expect(cleanVanInput({ ...valid, weight_kg: 12.5 })).toEqual({ error: "Weight must be in kilograms" });
  });
});

describe("totals", () => {
  const vans = [
    van({ value_eur: 9000, settlement_eur: 0, monthly_eur: 0 }),
    van({ id: "2", reg_key: "2", value_eur: 25000, settlement_eur: 20000, monthly_eur: 400.5 }),
    van({ id: "3", reg_key: "3", value_eur: 99999, settlement_eur: 1, status: "gone" }),
  ];

  it("equity is value less what is owed", () => {
    expect(equityOf(vans[1])).toBe(5000);
    expect(equityOf(van({ value_eur: null }))).toBeNull();
  });

  it("adds up only the vans on the road", () => {
    expect(fleetTotals(vans)).toEqual({ vans: 2, value: 34000, owed: 20000, equity: 14000, monthly: 400.5 });
  });
});

describe("due dates", () => {
  const vans = [
    van({ id: "a", reg: "A", tax_due: "2026-08-20", doe_due: "2026-09-10", insurance_due: "2027-03-01" }),
    van({ id: "b", reg: "B", tax_due: "2026-09-25" }),
    van({ id: "c", reg: "C", doe_due: "2026-08-01", status: "gone" }),
  ];

  it("lists what is overdue or due within 30 days, most overdue first, never for a gone van", () => {
    const soon = dueSoon(vans, TODAY, 30);
    expect(soon.map((i) => `${i.van.reg} ${i.kind} ${i.days}`)).toEqual(["A tax -6", "A doe 15", "B tax 30"]);
    expect(soon[0]).toMatchObject({ level: "expired", text: "expired 6 days ago" });
  });

  it("counts the dates still to be entered", () => {
    expect(missingDates(vans)).toEqual({ tax: 0, doe: 1, insurance: 1 });
  });
});

describe("warnings", () => {
  it("warns once per stage, and not for a date with no stage reached or already warned", () => {
    const vans = [
      van({ id: "a", reg: "A", tax_due: "2026-09-02" }), // 7 days: stage 3
      van({ id: "b", reg: "B", doe_due: "2026-09-20" }), // 25 days: stage 1
      van({ id: "c", reg: "C", insurance_due: "2027-01-01" }), // far off
      van({ id: "d", reg: "D", tax_due: "2026-09-02", tax_alerted_stage: 3 }), // already warned
      van({ id: "e", reg: "E", tax_due: "2026-08-01" }), // expired: stage 4
    ];
    const alerts = pendingFleetAlerts(vans, TODAY);
    expect(alerts.map((a) => `${a.van.reg} ${a.kind} ${a.stage}`)).toEqual(["E tax 4", "A tax 3", "B doe 1"]);
  });

  it("does not warn about a van that has gone", () => {
    expect(pendingFleetAlerts([van({ tax_due: "2026-08-01", status: "gone" })], TODAY)).toEqual([]);
  });

  it("a date just entered starts at the stage it is already in, so it does not warn at once", () => {
    expect(stageOnEntry("2026-09-02", TODAY)).toBe(3);
    expect(stageOnEntry("2027-01-01", TODAY)).toBe(0);
    expect(stageOnEntry(null, TODAY)).toBe(0);
  });

  it("the message names the van, the driver, what is due and when", () => {
    const msg = fleetAlertMessage(pendingFleetAlerts([van({ reg: "191 D 30807", driver: "Mike", doe_due: "2026-09-02" })], TODAY));
    expect(msg).toContain("191 D 30807 (Mike): DOE 7 days left, 2026-09-02");
    expect(msg).toContain("1 date needs attention");
  });
});

// The layout of the real "Aug 26" tab: a title, a blank gap column, the heading row part way down, then the vans, a totals row and
// the lenders' addresses underneath. Everything here is made up.
const row = (cells: Record<number, string>, width = 30) => Array.from({ length: width }, (_, i) => cells[i] ?? "");
const HEAD = row({ 2: "No", 3: "Reg", 5: "Model", 7: "Driver", 10: "Lender", 12: "Agreement", 14: "Value", 16: "Monthly", 18: "Settlement", 20: "Equity", 22: "Weight", 24: "Tax Pin", 26: "Tax Expires", 28: "DOE Expires" });

describe("reading the van list sheet", () => {
  const sheet = [
    row({ 3: "Fleet Info" }),
    row({ 3: "46260" }),
    HEAD,
    row({ 2: "1", 3: "161 D  5265", 5: "Renault Traffic", 7: "Spare", 10: "First citizen", 14: "9000", 18: "0", 22: "3010 kg", 24: "117854", 26: "Agu" }),
    row({ 2: "2", 3: "231 D 10647", 5: "Renault Traffic", 7: "Gary.", 10: "finance Ireland", 14: "25000", 18: "20000", 26: "04/11/2026", 28: "46300" }),
    row({ 2: "3", 3: "162 WW  652", 5: "Renault Traffic", 7: "GONE", 10: "RCI", 14: "9000", 18: "paid" }),
    row({ 2: "4", 3: "999", 5: "Mystery van", 7: "Someone" }),
    row({ 2: "5", 3: "162 WW 652", 5: "Duplicate", 7: "Someone" }),
    row({ 2: "6", 3: "181 D 25606", 5: "Ford Transit", 7: "Rafael", 14: "lots", 18: "21.130.25" }),
    row({ 14: "476000", 18: "277216.91", 20: "198783.09" }),
    row({ 3: "FIRST CITIZEN", 10: "Close brothers" }),
    row({ 3: "Dublin 1. D01 C576." }),
  ];

  const result = readVanSheet(sheet)!;

  it("finds the headings wherever they are and reads one van per row", () => {
    expect(result.vans.map((v) => v.reg)).toEqual(["161 D 5265", "231 D 10647", "162 WW 652", "181 D 25606"]);
    expect(result.vans[0]).toMatchObject({ model: "Renault Traffic", driver: "Spare", lender: "First citizen", value_eur: 9000, settlement_eur: 0, weight_kg: 3010, tax_pin: "117854" });
  });

  it("stops at the totals row, so the lenders' addresses underneath are not vans", () => {
    expect(result.vans.some((v) => /citizen|dublin/i.test(v.reg))).toBe(false);
    expect(result.warnings.some((w) => /dublin|citizen/i.test(w))).toBe(false);
  });

  it("a month name is kept as a note, never as a date; a real date or Excel date is read", () => {
    expect(result.vans[0].tax_due).toBeUndefined();
    expect(result.vans[0].monthNotes).toEqual(['Tax "Agu"']);
    expect(result.vans[1]).toMatchObject({ tax_due: "2026-11-04", doe_due: "2026-10-05" });
  });

  it("'paid' is nothing owed, and a van whose driver says GONE is marked gone", () => {
    expect(result.vans[2]).toMatchObject({ settlement_eur: 0, gone: true });
    expect(result.vans[0].gone).toBe(false);
  });

  it("says what it could not use instead of guessing", () => {
    expect(result.warnings).toContain("Van 999 was skipped: it does not look like an Irish registration. Add that van by hand if it is real.");
    expect(result.warnings).toContain("Van 162 WW 652 appears more than once; only the first is used.");
    expect(result.warnings).toContain('Van 181 D 25606: value "lots" is not an amount, so it was left out.');
    expect(result.warnings).toContain('Van 181 D 25606: amount owed "21.130.25" is not an amount, so it was left out.');
    expect(result.vans[3].value_eur).toBeUndefined();
  });

  it("uses a Balance column for what is owed only when there is no Settlement column", () => {
    const old = [row({ 3: "Reg", 5: "Model", 6: "Balance" }), row({ 3: "161 D 5265", 5: "Traffic", 6: "471.89" })];
    expect(readVanSheet(old)!.vans[0].settlement_eur).toBe(471.89);
  });

  it("returns nothing for a sheet with no van list", () => {
    expect(readVanSheet([row({ 1: "Just", 2: "notes" })])).toBeNull();
  });
});

describe("a CSV export of the van list", () => {
  // What Excel writes for one sheet: the same layout, blank rows and empty columns kept, amounts as formatted, and the
  // address lines under the list. Everything here is made up.
  const csv = [
    ",,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    ",,Fleet Info,,,,,,,,,,,,,,,,,,,,,,,,,,",
    ",,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    ",,Reg,,Model,,Driver,,,Lender,,Agreement,,Value,,Monthly,,Settlement,,Equity,,Weight,,Tax Pin,,Tax Expires,,DOE Expires",
    ',1,161 D  5265,,Renault Traffic,,Spare,,,First citizen,,,,"€9,000",,,,0,,"€9,000",,3010 kg,,117854,,Agu,,',
    ",,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    ',2,231 D 10647,,Renault Traffic,,Gary.,,,finance Ireland,,,,"€25,000",,"€400.50",,"€20,000.00",,"€5,000",,,,,,04/11/2026,,05/10/2026',
    ",,,,,,,,,,,,,,,,,,,,,,,,,,,,",
    ',,,,,,,,,,,,,,,,"€34,000",,"€20,000",,,,,,,,,',
    ",,FIRST CITIZEN,,,,,,,,Close brothers,,,,,,,,,,,,,,,,,,",
  ].join("\r\n");

  it("is read like a sheet, whatever its blank columns and rows", () => {
    const read = readFleetFile("New Van List 2024(Aug 26).csv", Buffer.from(csv));
    expect(read.sheets).toEqual(["CSV file"]);
    const vans = read.sheet!.vans;
    expect(vans.map((v) => v.reg)).toEqual(["161 D 5265", "231 D 10647"]);
    expect(vans[0]).toMatchObject({ value_eur: 9000, settlement_eur: 0, weight_kg: 3010, model: "Renault Traffic" });
    expect(vans[0].monthNotes).toEqual(['Tax "Agu"']);
    expect(vans[1]).toMatchObject({ value_eur: 25000, monthly_eur: 400.5, settlement_eur: 20000, tax_due: "2026-11-04", doe_due: "2026-10-05" });
    expect(read.sheet!.warnings).toEqual([]);
  });

  it("still takes a CSV saved with semicolons by a European Excel", () => {
    const semi = "Reg;Model;Driver;Value\n191 D 30807;Opel Vivaro;Mike;15000\n";
    expect(readFleetFile("vans.csv", Buffer.from(semi)).sheet!.vans[0]).toMatchObject({ reg: "191 D 30807", value_eur: 15000 });
  });
});
