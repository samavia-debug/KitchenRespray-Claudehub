import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, fakeFrom } from "./fake-db";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: fakeFrom }) }));
const tables = fake.tables;

import { bulkUpdate, createCompany, listCompanies } from "./service";
import { buildRow } from "./import/mapping";
import { cleanBulkChange, cleanCompanyInput, cleanCompanyQuery } from "./validate";

const USER = "user-joanna";
const UUIDS = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
const query = (qs = "") => cleanCompanyQuery(new URLSearchParams(qs));

beforeEach(() => {
  fake.reset();
  tables.crm_stages = [{ id: "stage-new", name: "New Prospect", kind: "open", sort_order: 1, active: true }];
  tables.crm_categories = [];
  tables.profiles = [{ id: USER, email: "joanna@example.test", role: "Staff" }];
});

describe("a company's county", () => {
  it("is stored as one of the fixed choices, however it was typed", () => {
    for (const [typed, stored] of [["Co. Carlow", "Carlow"], ["kilkenny", "Kilkenny"], ["Dublin 6W", "Dublin"], ["Cork", "Outside Leinster"]]) {
      const out = cleanCompanyInput({ name: "Ace", county: typed });
      expect("value" in out && out.value.county).toBe(stored);
    }
  });

  it("can be cleared, and is left alone when the form does not mention it", () => {
    expect(cleanCompanyInput({ name: "Ace", county: "" })).toEqual({ value: expect.objectContaining({ county: null }) });
    expect(cleanCompanyInput({ county: null }, true)).toEqual({ value: { county: null } });
    const untouched = cleanCompanyInput({ name: "Ace" });
    expect("value" in untouched && "county" in untouched.value).toBe(false);
    expect(cleanCompanyInput({ notes: "x" }, true)).toEqual({ value: { notes: "x" } });
  });

  it("refuses something that is not a county, and says what is allowed", () => {
    for (const bad of ["Narnia", "Carlow Town", "12", 42, {}]) {
      const out = cleanCompanyInput({ name: "Ace", county: bad });
      expect(out, JSON.stringify(bad)).toHaveProperty("error");
      expect("error" in out && out.error).toMatch(/Leinster/);
    }
  });
});

describe("filtering the company list by county", () => {
  beforeEach(async () => {
    for (const [name, county] of [["Ace", "Carlow"], ["Beta", "Carlow"], ["Cork Joinery", "Outside Leinster"], ["Delta", null], ["Eden", "Kilkenny"]] as const) {
      await createCompany({ name, county }, USER, false);
    }
  });
  const names = async (qs: string) => (await listCompanies(query(qs))).companies.map((c) => c.name).sort();

  it("shows only that county's companies", async () => {
    expect(await names("county=Carlow")).toEqual(["Ace", "Beta"]);
    expect(await names("county=Kilkenny")).toEqual(["Eden"]);
    expect(await names("county=Wexford")).toEqual([]);
  });

  it("can pick the companies with no county, or all of them", async () => {
    expect(await names("county=none")).toEqual(["Delta"]);
    expect(await names("")).toHaveLength(5);
  });

  it("ignores a county that is not one of the choices, instead of searching for it", async () => {
    expect(query("county=Narnia").county).toBeNull();
    expect(query("county=carlow").county).toBeNull(); // the screen always sends the exact name
    expect(await names("county=Narnia")).toHaveLength(5);
  });
});

describe("setting the county of many companies at once", () => {
  const change = (value: unknown) => cleanBulkChange({ ids: UUIDS, action: "county", value, confirmed: true });

  it("accepts a county, a different spelling of one, or none, and refuses anything else", () => {
    expect(change("Louth")).toEqual({ value: expect.objectContaining({ action: "county", value: "Louth" }) });
    expect(change("Co. Louth")).toEqual({ value: expect.objectContaining({ value: "Louth" }) });
    expect(change(null)).toEqual({ value: expect.objectContaining({ value: null }) });
    expect(change("Narnia")).toHaveProperty("error");
  });

  it("changes only the companies chosen, and can clear the county", async () => {
    const a = await createCompany({ name: "Ace" }, USER, false);
    const b = await createCompany({ name: "Beta", county: "Carlow" }, USER, false);
    const c = await createCompany({ name: "Cee", county: "Carlow" }, USER, false);
    const ids = [(a as { id: string }).id, (b as { id: string }).id];
    expect(await bulkUpdate({ ids, action: "county", value: "Wexford", confirmed: true }, USER)).toEqual({ updated: 2 });
    const county = (name: string) => tables.crm_companies.find((r) => r.name === name)!.county;
    expect([county("Ace"), county("Beta"), county("Cee")]).toEqual(["Wexford", "Wexford", "Carlow"]);
    expect(c).toHaveProperty("id");

    await bulkUpdate({ ids, action: "county", value: null, confirmed: true }, USER);
    expect([county("Ace"), county("Beta")]).toEqual([null, null]);
  });

  it("needs confirming, like every bulk change", async () => {
    expect(await bulkUpdate({ ids: UUIDS, action: "county", value: "Louth", confirmed: false }, USER)).toHaveProperty("error");
  });
});

describe("importing a county", () => {
  const headers = ["Company", "County"];
  const row = (county: string) => buildRow(["Ace Joinery", county], headers, ["name", "county"], { categories: [], defaults: { category_id: null, source: null, assigned_to: null, priority: null } });

  it("tidies the spelling without a warning", () => {
    for (const [typed, stored] of [["Co. Carlow", "Carlow"], ["COUNTY KILKENNY", "Kilkenny"], ["Dublin 4", "Dublin"], ["Galway", "Outside Leinster"]]) {
      const built = row(typed);
      expect(built.company?.county, typed).toBe(stored);
      expect(built.warnings, typed).toEqual([]);
    }
  });

  it("leaves out something that is not a county, warns, and keeps what the file said", () => {
    const built = row("Carlow Town");
    expect(built.company?.county).toBeUndefined();
    expect(built.warnings.join(" ")).toMatch(/County "Carlow Town" is not valid/);
    expect(built.extra["Not imported: County"]).toBe("Carlow Town");
    expect(built.company?.name).toBe("Ace Joinery"); // the row itself is still imported
  });

  it("leaves the county unset when the cell is empty", () => {
    const built = row("");
    expect(built.company).not.toHaveProperty("county");
    expect(built.warnings).toEqual([]);
  });
});
