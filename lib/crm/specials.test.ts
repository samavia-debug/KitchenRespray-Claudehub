import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, fakeFrom } from "./fake-db";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: fakeFrom }) }));
const tables = fake.tables;

import { addDays, dublinToday } from "./followups";
import { unsupportedFigures } from "./ai/prompts";
import { appliesTo, describeDates, runningFor, specialStatus, specialWindows } from "./specials";
import { createSpecial, deleteSpecial, listSpecials, specialResults, specialsRunningFor, updateSpecial } from "./specials-service";
import type { Special } from "./types";
import { cleanSpecialInput } from "./validate";

const USER = "user-philip";
const TODAY = dublinToday();
const day = (n: number) => addDays(TODAY, n);
const fmt = (iso: string) => iso;

const special = (over: Partial<Special> = {}): Special => ({
  id: "s1", title: "Kilkenny spring offer", offer: "15% off kitchen doors", code: null, county: "Kilkenny", starts_on: day(-5), ends_on: day(10), active: true,
  created_at: "2026-10-01T09:00:00.000Z", updated_at: "2026-10-01T09:00:00.000Z", ...over,
});

beforeEach(() => {
  fake.reset();
  tables.crm_specials = [];
  tables.crm_events = [];
});

describe("where a special stands", () => {
  it("is upcoming, running or ended by its dates, and the end day itself still counts as running", () => {
    expect(specialStatus(special({ starts_on: day(1), ends_on: day(9) }), TODAY)).toBe("upcoming");
    expect(specialStatus(special({ starts_on: TODAY, ends_on: day(9) }), TODAY)).toBe("running");
    expect(specialStatus(special({ starts_on: day(-9), ends_on: TODAY }), TODAY)).toBe("running");
    expect(specialStatus(special({ starts_on: day(-9), ends_on: day(-1) }), TODAY)).toBe("ended");
    expect(specialStatus(special({ starts_on: day(-9), ends_on: null }), TODAY)).toBe("running");
  });

  it("is off when switched off, whatever the dates say", () => {
    expect(specialStatus(special({ active: false }), TODAY)).toBe("off");
    expect(specialStatus(special({ active: false, starts_on: day(2) }), TODAY)).toBe("off");
  });

  it("describes its dates in words", () => {
    expect(describeDates(special({ ends_on: day(10) }), TODAY, fmt)).toBe(`Ends ${day(10)}`);
    expect(describeDates(special({ ends_on: null }), TODAY, fmt)).toBe("No end date");
    expect(describeDates(special({ starts_on: day(3), ends_on: day(9) }), TODAY, fmt)).toBe(`Starts ${day(3)}, ends ${day(9)}`);
    expect(describeDates(special({ starts_on: day(-9), ends_on: day(-2) }), TODAY, fmt)).toBe(`Ended ${day(-2)}`);
    expect(describeDates(special({ active: false }), TODAY, fmt)).toBe("Switched off");
  });
});

describe("which specials apply to a company", () => {
  const list = [
    special({ id: "k", county: "Kilkenny", starts_on: day(-5) }),
    special({ id: "all", title: "Leinster trade price", county: null, starts_on: day(-20) }),
    special({ id: "c", title: "Carlow only", county: "Carlow" }),
    special({ id: "old", county: "Kilkenny", ends_on: day(-1) }),
    special({ id: "new", county: "Kilkenny", starts_on: day(-1), title: "Newer Kilkenny" }),
    special({ id: "off", county: "Kilkenny", active: false }),
  ];

  it("takes the specials for its county and for every county, running now, newest first", () => {
    expect(runningFor(list, "Kilkenny", TODAY).map((s) => s.id)).toEqual(["new", "k", "all"]);
    expect(runningFor(list, "Carlow", TODAY).map((s) => s.id)).toEqual(["c", "all"]);
  });

  it("gives a company with no county, or outside Leinster, only the specials for every county", () => {
    expect(runningFor(list, null, TODAY).map((s) => s.id)).toEqual(["all"]);
    expect(runningFor(list, "Outside Leinster", TODAY).map((s) => s.id)).toEqual(["all"]);
    expect(appliesTo(special({ county: null }), undefined)).toBe(true);
    expect(appliesTo(special({ county: "Kilkenny" }), undefined)).toBe(false);
  });
});

describe("the days a special is measured over", () => {
  it("covers the days so far, and the same number of days straight before", () => {
    const w = specialWindows(special({ starts_on: day(-9), ends_on: null }), TODAY)!;
    expect(w.days).toBe(10);
    expect(w.during).toEqual({ from: day(-9), to: TODAY });
    expect(w.before).toEqual({ from: day(-19), to: day(-10) });
  });

  it("stops at the end date once it has ended", () => {
    const w = specialWindows(special({ starts_on: day(-30), ends_on: day(-21) }), TODAY)!;
    expect(w.days).toBe(10);
    expect(w.during.to).toBe(day(-21));
    expect(w.before.to).toBe(day(-31));
  });

  it("has nothing to measure before it starts, and keeps within a year", () => {
    expect(specialWindows(special({ starts_on: day(2) }), TODAY)).toBeNull();
    const long = specialWindows(special({ starts_on: day(-700), ends_on: null }), TODAY)!;
    expect(long.days).toBe(365);
    expect(long.during.from).toBe(day(-364));
  });
});

describe("checking a special", () => {
  const ok = { title: "Kilkenny spring offer", offer: "15% off kitchen doors", county: "Kilkenny", starts_on: day(1), ends_on: day(20) };

  it("accepts a complete special and fills in the defaults", () => {
    const out = cleanSpecialInput(ok);
    expect(out).toEqual({ value: expect.objectContaining({ title: "Kilkenny spring offer", county: "Kilkenny", active: true, starts_on: day(1), ends_on: day(20) }) });
  });

  it("reads a county however it is typed, and 'all counties' as every county", () => {
    expect("value" in cleanSpecialInput({ ...ok, county: "Co. Carlow" }) && (cleanSpecialInput({ ...ok, county: "Co. Carlow" }) as any).value.county).toBe("Carlow");
    for (const all of ["", null, "All", "All counties", "all leinster"]) expect((cleanSpecialInput({ ...ok, county: all }) as any).value.county, String(all)).toBeNull();
    expect((cleanSpecialInput({ title: "x", offer: "y", starts_on: day(1) }) as any).value.county).toBeNull();
  });

  it("refuses a county that is not a Leinster county, including Outside Leinster", () => {
    for (const bad of ["Cork", "Outside Leinster", "Narnia", 42]) expect(cleanSpecialInput({ ...ok, county: bad }), String(bad)).toHaveProperty("error");
  });

  it("refuses a missing title, offer or start date, an end before the start, and a bad date", () => {
    for (const bad of [{ title: "" }, { title: "   " }, { offer: "" }, { starts_on: "" }, { starts_on: "next week" }, { ends_on: day(0) }, { ends_on: "2026-02-30" }, { title: "x".repeat(121) }, { offer: "x".repeat(1001) }, { code: "x".repeat(41) }, { active: "yes" }]) {
      expect(cleanSpecialInput({ ...ok, ...bad }), JSON.stringify(bad).slice(0, 40)).toHaveProperty("error");
    }
  });

  it("can be started in the past, and can have no end date", () => {
    expect(cleanSpecialInput({ ...ok, starts_on: day(-30), ends_on: null })).toHaveProperty("value");
  });

  it("returns only what was sent for an update, and does not default anything", () => {
    expect(cleanSpecialInput({ active: false }, true)).toEqual({ value: { active: false } });
    expect(cleanSpecialInput({ county: null }, true)).toEqual({ value: { county: null } });
    expect(cleanSpecialInput({ ends_on: null }, true)).toEqual({ value: { ends_on: null } });
    expect(cleanSpecialInput({ title: "" }, true)).toHaveProperty("error");
  });
});

describe("keeping specials", () => {
  const input = { title: "Kilkenny spring offer", offer: "15% off kitchen doors", code: "KK15", county: "Kilkenny", starts_on: day(-1), ends_on: day(10), active: true };

  it("saves, lists newest first, changes and deletes, and records each in the audit trail", async () => {
    const a = await createSpecial(input, USER);
    await createSpecial({ ...input, title: "Carlow offer", county: "Carlow", starts_on: day(3), ends_on: null }, USER);
    expect((await listSpecials()).map((s) => s.title)).toEqual(["Carlow offer", "Kilkenny spring offer"]);

    expect(await updateSpecial(a.id, { offer: "20% off kitchen doors", active: false }, USER)).toEqual({ ok: true });
    expect(tables.crm_specials.find((s) => s.id === a.id)).toMatchObject({ offer: "20% off kitchen doors", active: false, updated_by: USER });

    expect(await deleteSpecial(a.id, USER)).toBe(true);
    expect(await deleteSpecial(a.id, USER)).toBe(false);
    expect(tables.crm_events.map((e) => e.action)).toEqual(["special_created", "special_created", "special_updated", "special_deleted"]);
  });

  it("checks an end date against the start date as it will be, not just as sent", async () => {
    const a = await createSpecial(input, USER);
    expect(await updateSpecial(a.id, { ends_on: day(-5) }, USER)).toHaveProperty("error"); // before the existing start
    expect(await updateSpecial(a.id, { starts_on: day(20) }, USER)).toHaveProperty("error"); // after the existing end
    expect(await updateSpecial(a.id, { starts_on: day(20), ends_on: day(30) }, USER)).toEqual({ ok: true });
    expect(await updateSpecial(a.id, { ends_on: null }, USER)).toEqual({ ok: true });
  });

  it("says when the special is not there", async () => {
    expect(await updateSpecial("99999999-9999-4999-8999-999999999999", { title: "x" }, USER)).toEqual({ notFound: true });
  });

  it("finds the running specials for a company's county, including one written the old way", async () => {
    await createSpecial(input, USER);
    await createSpecial({ ...input, title: "Everywhere", county: null }, USER);
    expect((await specialsRunningFor("Kilkenny", TODAY)).map((s) => s.title).sort()).toEqual(["Everywhere", "Kilkenny spring offer"]);
    expect((await specialsRunningFor("County Kilkenny", TODAY)).map((s) => s.title).sort()).toEqual(["Everywhere", "Kilkenny spring offer"]);
    expect((await specialsRunningFor("Carlow", TODAY)).map((s) => s.title)).toEqual(["Everywhere"]);
  });
});

describe("what happened while a special ran", () => {
  const at = (n: number, hour = 10) => new Date(Date.parse(`${day(n)}T${String(hour).padStart(2, "0")}:00:00Z`)).toISOString();

  beforeEach(() => {
    tables.profiles = [{ id: "u1", email: "joanna.byrne@example.test", role: "Staff" }];
    tables.crm_stages = [{ id: "s-new", name: "New Prospect", kind: "open", sort_order: 1, active: true }, { id: "s-won", name: "Won", kind: "won", sort_order: 9, active: true }];
    tables.crm_categories = [];
    const co = (id: string, county: string | null) => ({ id, name: `Joinery ${id}`, county, category_id: null, assigned_to: "u1", created_by: "u1", created_at: at(-60), stage_id: "s-new", stage_changed_at: null, last_contacted_at: null, estimated_value: null, won_value: null, archived_at: null });
    tables.crm_companies = [co("k1", "Kilkenny"), co("k2", "Kilkenny"), co("c1", "Carlow"), co("n1", null)];
    const act = (id: string, company_id: string, n: number) => ({ id, company_id, type: "WhatsApp message", occurred_at: at(n), user_id: "u1" });
    tables.crm_activities = [
      // The special runs for the last 10 days. Kilkenny has 3 contacts during it and 1 in the 10 days before it.
      act("a1", "k1", -2), act("a2", "k2", -3), act("a3", "k1", -8),
      act("a4", "k1", -15),
      // Carlow and a company with no county are never counted for Kilkenny.
      act("a5", "c1", -2), act("a6", "n1", -4),
    ];
    tables.crm_tasks = [];
    tables.crm_stage_history = [];
    tables.crm_opportunities = [{ id: "o1", company_id: "k1", title: "Doors", status: "won", status_changed_at: at(-4), estimated_value: 5000, won_value: 4200, source: "Direct prospecting", assigned_to: "u1", created_by: "u1", created_at: at(-12) }];
    tables.crm_opportunity_history = [];
  });

  it("counts the county's own contacts and sales during the special, next to the same number of days before", async () => {
    const s = special({ id: "k", county: "Kilkenny", starts_on: day(-9), ends_on: null });
    const r = (await specialResults([s], TODAY))["k"];
    expect(r.days).toBe(10);
    expect(r.during).toMatchObject({ from: day(-9), to: TODAY });
    expect(r.during.counts).toMatchObject({ contactsMade: 3, contacted: 2, won: 1, wonValue: 4200 });
    expect(r.before.counts).toMatchObject({ contactsMade: 1, contacted: 1, won: 0, wonValue: 0 });
  });

  it("measures a special for every county across all counties", async () => {
    const r = (await specialResults([special({ id: "all", county: null, starts_on: day(-9), ends_on: null })], TODAY))["all"];
    expect(r.during.counts.contactsMade).toBe(5); // Kilkenny 3, Carlow 1, no county 1
  });

  it("stops measuring at the end date of a special that has finished", async () => {
    const r = (await specialResults([special({ id: "k", starts_on: day(-12), ends_on: day(-7) })], TODAY))["k"];
    expect(r.during.counts.contactsMade).toBe(1); // only the contact on day -8 falls in days -12 to -7
    expect(r.days).toBe(6);
  });

  it("gives nothing for a special that has not started", async () => {
    expect(await specialResults([special({ starts_on: day(3), ends_on: day(10) })], TODAY)).toEqual({});
    expect(await specialResults([], TODAY)).toEqual({});
  });
});

describe("a figure the writer was not given", () => {
  const allowed = "15% off kitchen doors with code WICK15. Trade prices from €1,200 for a full kitchen.";

  it("lets through the percentages and amounts that are in the allowed text, however they are spaced", () => {
    expect(unsupportedFigures("We have 15% off, from €1200.", allowed)).toEqual([]);
    expect(unsupportedFigures("That is 15 % off, from € 1,200.", allowed)).toEqual([]);
  });

  it("names the ones that are not", () => {
    expect(unsupportedFigures("We can do 25% off, or €3,500 for a kitchen, 15% for doors.", allowed)).toEqual(["25%", "€3,500"]);
  });

  it("ignores ordinary numbers such as phone numbers and years", () => {
    expect(unsupportedFigures("Call 087 123 4567, we started in 1998 and have 3 vans.", allowed)).toEqual([]);
  });

  it("reports each figure once", () => {
    expect(unsupportedFigures("25% off! Yes, 25% off.", "")).toEqual(["25%"]);
  });
});
