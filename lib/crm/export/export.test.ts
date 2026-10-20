import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, fakeFrom } from "../fake-db";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: fakeFrom }) }));
const tables = fake.tables;

import { readXlsx } from "../import/xlsx-read";
import { openZip } from "../import/zip-read";
import { cleanCompanyQuery } from "../validate";
import { exportFile, exportTable } from "./export-service";
import { buildXlsx, protectFormula, safeSheetName, toCsv } from "./files";

const USER = "user-philip";

describe("toCsv", () => {
  it("starts with a byte-order mark, uses Windows line ends, and quotes what needs it", () => {
    const text = toCsv(["Company", "Note"], [["Ace, Roofing", 'He said "hi"\nthen left'], ["Beta", null]]).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe('Company,Note\r\n"Ace, Roofing","He said ""hi""\nthen left"\r\nBeta,\r\n');
  });

  it("writes numbers as numbers and leaves empty cells empty", () => {
    expect(toCsv(["A", "B", "C"], [[12500.5, 0, undefined]]).toString("utf8")).toBe("﻿A,B,C\r\n12500.5,0,\r\n");
  });

  it("writes anything a spreadsheet would run as a formula as plain text", () => {
    expect(protectFormula("=HYPERLINK(\"http://evil\")")).toBe("'=HYPERLINK(\"http://evil\")");
    for (const v of ["=1+1", "+353 87 123 4567", "-5", "@SUM(A1)", "\tcmd", "\rcmd"]) expect(protectFormula(v).startsWith("'")).toBe(true);
    expect(protectFormula("Ace Roofing")).toBe("Ace Roofing");
    expect(toCsv(["x"], [["=cmd|' /C calc'!A0"]]).toString("utf8")).toContain("'=cmd|' /C calc'!A0");
  });
});

describe("buildXlsx", () => {
  const headers = ["Company", "Estimate", "Note"];
  const rows = [["Ace & Sons <Roofing>", 12500, 'Line one\nLine "two"'], ["Café Ó Murchú 🙂", null, "=SUM(A1)"], ["Bell\u0007Char", 0, ""]];

  it("round-trips through a spreadsheet reader, including awkward text", () => {
    const wb = readXlsx(buildXlsx("Companies", headers, rows));
    expect(wb.sheets).toEqual(["Companies"]);
    expect(wb.rows[0]).toEqual(headers);
    expect(wb.rows[1]).toEqual(["Ace & Sons <Roofing>", "12500", 'Line one\nLine "two"']);
    expect(wb.rows[2]).toEqual(["Café Ó Murchú 🙂", "", "=SUM(A1)"]);
    expect(wb.rows[3][0]).toBe("BellChar"); // a control character XML cannot hold is dropped
  });

  it("keeps a formula-looking value as text, not as a formula", () => {
    const zip = openZip(buildXlsx("Companies", headers, rows));
    const sheet = zip.read("xl/worksheets/sheet1.xml")!.toString("utf8");
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain("t=\"inlineStr\"");
  });

  it("has a bold, frozen header row and sensible widths", () => {
    const zip = openZip(buildXlsx("Companies", headers, rows));
    const sheet = zip.read("xl/worksheets/sheet1.xml")!.toString("utf8");
    expect(sheet).toMatch(/<pane ySplit="1"[^>]*state="frozen"/);
    expect(sheet).toMatch(/<c r="A1" t="inlineStr" s="1">/);
    expect(zip.read("xl/styles.xml")!.toString("utf8")).toContain("<b/>");
    const widths = Array.from(sheet.matchAll(/width="(\d+)"/g)).map((m) => Number(m[1]));
    expect(widths).toHaveLength(3);
    expect(widths.every((w) => w >= 10 && w <= 60)).toBe(true);
  });

  it("makes a sheet name Excel will accept", () => {
    expect(safeSheetName("Companies/Contacts: [all]?")).toBe("Companies Contacts   all");
    expect(safeSheetName("x".repeat(50))).toHaveLength(31);
    expect(safeSheetName("   ")).toBe("Sheet1");
  });

  it("handles a very large sheet", () => {
    const big = Array.from({ length: 6000 }, (_, i) => [`Company ${i}`, i, "note"]);
    const wb = readXlsx(buildXlsx("Big", headers, big));
    expect(wb.rows).toHaveLength(6001);
    expect(wb.rows[6000][0]).toBe("Company 5999");
  });
});

// ---- The data behind an export ----

const stage = (id: string, name: string) => ({ id, name, kind: "open", sort_order: 1, active: true });

beforeEach(() => {
  fake.reset();
  tables.profiles = [{ id: "u1", email: "joanna@example.test", role: "Staff" }];
  tables.crm_stages = [stage("s1", "New Prospect")];
  tables.crm_categories = [{ id: "cat1", name: "Hotels", sort_order: 1, active: true }];
  const company = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    id, name, archived_at: null, priority: "Medium", country: "Ireland", category_id: "cat1", stage_id: "s1", assigned_to: "u1", created_at: "2026-10-01T09:00:00.000Z",
    city: "Dublin", phone: "01 555 0100", mobile: null, estimated_value: null, won_value: null, extra: {}, last_activity_type: null, ...over,
  });
  tables.crm_companies = [
    company("c1", "Ace Roofing", { city: "Dublin", estimated_value: "12500.00", extra: { "Google Rating": "4.5", "AI Summary": "A roofing firm." }, last_activity_type: "Telephone call", last_activity_at: "2026-10-15T09:30:00.000Z" }),
    company("c2", "Beta Builders", { city: "Cork", priority: "High" }),
    company("c3", "=EVIL()", { city: "Bray" }),
    company("gone", "Archived Ltd", { archived_at: "2026-10-02T00:00:00.000Z" }),
  ];
  tables.crm_contacts = [{ id: "k1", company_id: "c1", full_name: "Mick Doyle", email: "mick@ace.ie", assigned_to: "u1", created_at: "2026-10-02T09:00:00.000Z" }, { id: "k2", company_id: "gone", full_name: "Hidden Person", created_at: "2026-10-02T09:00:00.000Z" }];
  tables.crm_activities = [{ id: "a1", company_id: "c1", contact_id: "k1", user_id: "u1", type: "Telephone call", occurred_at: "2026-10-15T09:30:00.000Z", outcome: "Interested" }];
  tables.crm_opportunities = [{ id: "o1", company_id: "c1", title: "40 doors", status: "won", estimated_value: "18000.00", won_value: "16500.00", assigned_to: "u1", status_changed_at: "2026-10-12T10:00:00.000Z", created_at: "2026-10-05T10:00:00.000Z" }];
});

const q = (qs = "") => cleanCompanyQuery(new URLSearchParams(qs));
const col = (t: { headers: string[]; rows: any[][] }, name: string) => t.rows.map((r) => r[t.headers.indexOf(name)]);

describe("exportTable", () => {
  it("exports every active company, with names for the related records and the imported details", async () => {
    const t = await exportTable("companies", {}, USER);
    // Order is the database's (by name); what matters here is which companies are in, and that the archived one is not.
    expect(col(t, "Company").sort()).toEqual(["=EVIL()", "Ace Roofing", "Beta Builders"]);
    const ace = t.rows[col(t, "Company").indexOf("Ace Roofing")];
    expect(ace[t.headers.indexOf("Category")]).toBe("Hotels");
    expect(ace[t.headers.indexOf("Stage")]).toBe("New Prospect");
    expect(ace[t.headers.indexOf("Assigned to")]).toBe("joanna@example.test");
    expect(ace[t.headers.indexOf("Estimated value (EUR, a guess)")]).toBe(12500);
    expect(ace[t.headers.indexOf("Last activity")]).toBe("Telephone call, 2026-10-15");
    expect(ace[t.headers.indexOf("Imported details")]).toBe("Google Rating: 4.5\nAI Summary: A roofing firm.");
    expect(ace[t.headers.indexOf("Value won (EUR)")]).toBeNull();
  });

  it("exports what the list is showing: the same filters and sort", async () => {
    expect(col(await exportTable("companies", { query: q("priority=High") }, USER), "Company")).toEqual(["Beta Builders"]);
    expect(col(await exportTable("companies", { query: q("q=ace") }, USER), "Company")).toEqual(["Ace Roofing"]);
    expect(col(await exportTable("companies", { query: q("sort=city&dir=desc") }, USER), "Town or city")).toEqual(["Dublin", "Cork", "Bray"]);
  });

  it("exports just the chosen companies, and never an archived one", async () => {
    expect(col(await exportTable("companies", { ids: ["c2", "c1", "gone"] }, USER), "Company")).toEqual(["Ace Roofing", "Beta Builders"]);
  });

  it("exports contacts, activities and opportunities with their company names, leaving out archived companies' records", async () => {
    const contacts = await exportTable("contacts", {}, USER);
    expect(col(contacts, "Name")).toEqual(["Mick Doyle"]);
    expect(col(contacts, "Company")).toEqual(["Ace Roofing"]);

    const activities = await exportTable("activities", {}, USER);
    expect(activities.rows[0].slice(0, 5)).toEqual(["2026-10-15 10:30", "Telephone call", "Ace Roofing", "Mick Doyle", "joanna@example.test"]);

    const opps = await exportTable("opportunities", {}, USER);
    expect(opps.rows[0].slice(0, 5)).toEqual(["Ace Roofing", "40 doors", "won", 18000, 16500]);
  });

  it("records who exported what, as counts only", async () => {
    await exportTable("companies", { query: q("q=ace") }, USER);
    expect(tables.crm_events[0]).toMatchObject({ action: "exported", user_id: USER, meta: { type: "companies", rows: 1, selected: false, filtered: true } });
    expect(JSON.stringify(tables.crm_events)).not.toMatch(/Ace|mick|555/i);
  });
});

describe("exportFile", () => {
  const table = { headers: ["Company"], rows: [["Ace"]] };
  const when = new Date("2026-10-22T09:00:00Z");

  it("names the file by what it holds and the Irish date", () => {
    expect(exportFile("companies", "csv", table, when)).toMatchObject({ filename: "crm-companies-2026-10-22.csv", contentType: "text/csv; charset=utf-8" });
    expect(exportFile("contacts", "xlsx", table, when)).toMatchObject({ filename: "crm-contacts-2026-10-22.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  });

  it("produces a file that opens: CSV with a byte-order mark, Excel that reads back", () => {
    expect(exportFile("companies", "csv", table, when).body.toString("utf8")).toBe("﻿Company\r\nAce\r\n");
    expect(readXlsx(exportFile("companies", "xlsx", table, when).body).rows).toEqual([["Company"], ["Ace"]]);
  });
});
