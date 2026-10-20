import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, fakeFrom } from "./fake-db";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: fakeFrom }) }));
const tables = fake.tables;

import { loadReport } from "./report-service";

const TODAY = "2026-10-21"; // a Wednesday; "this week" is 19 to 25 October
const req = (over: Partial<Parameters<typeof loadReport>[0]> = {}) => ({ range: "this_week", from: null, to: null, category_id: null, staff_id: null, ...over });
const ok = async (over = {}) => {
  const r = await loadReport(req(over), TODAY);
  if ("error" in r) throw new Error(r.error);
  return r;
};

beforeEach(() => {
  fake.reset();
  tables.profiles = [{ id: "u1", email: "joanna.byrne@example.test", role: "Staff" }, { id: "viewer", email: "v@example.test", role: "Viewer" }];
  tables.crm_stages = [{ id: "s1", name: "New Prospect", kind: "open", sort_order: "1.00", active: true }, { id: "s2", name: "Won", kind: "won", sort_order: "9.00", active: true }];
  tables.crm_categories = [{ id: "cat", name: "Builders", active: true }];
  tables.crm_companies = [
    { id: "c1", name: "Ace", category_id: "cat", assigned_to: "u1", created_by: "u1", created_at: "2026-10-20T09:00:00.000Z", stage_id: "s1", stage_changed_at: null, last_contacted_at: null, estimated_value: "2500.00", won_value: null, archived_at: null },
    { id: "c2", name: "Won Ltd", category_id: "cat", assigned_to: "u1", created_by: "u1", created_at: "2026-09-01T09:00:00.000Z", stage_id: "s2", stage_changed_at: "2026-10-21T09:00:00.000Z", last_contacted_at: null, estimated_value: null, won_value: "7500.50", archived_at: null },
    { id: "gone", name: "Archived", category_id: "cat", assigned_to: "u1", created_by: "u1", created_at: "2026-10-20T09:00:00.000Z", stage_id: "s1", archived_at: "2026-10-21T00:00:00.000Z" },
  ];
  tables.crm_activities = [
    { id: "in", company_id: "c1", type: "Telephone call", occurred_at: "2026-10-20T09:00:00.000Z", user_id: "u1" },
    { id: "before", company_id: "c1", type: "Telephone call", occurred_at: "2026-10-10T09:00:00.000Z", user_id: "u1" },
    { id: "archived", company_id: "gone", type: "Telephone call", occurred_at: "2026-10-20T09:00:00.000Z", user_id: "u1" },
  ];
  tables.crm_tasks = [
    { id: "open", company_id: "c1", title: "Ring", due_date: "2026-10-21", assigned_to: "u1", status: "open" },
    { id: "cancelled", company_id: "c1", title: "Dropped", due_date: "2026-10-21", assigned_to: "u1", status: "cancelled" },
    { id: "done-in", company_id: "c1", title: "Did it", due_date: "2026-10-19", assigned_to: "u1", status: "done", completed_at: "2026-10-20T10:00:00.000Z", completed_by: "u1" },
    { id: "done-out", company_id: "c1", title: "Long ago", due_date: "2026-09-19", assigned_to: "u1", status: "done", completed_at: "2026-09-20T10:00:00.000Z", completed_by: "u1" },
  ];
  tables.crm_stage_history = [];
  tables.crm_opportunities = [];
  tables.crm_opportunity_history = [];
});

describe("loadReport", () => {
  it("builds the figures from the records, leaving out archived companies and anything outside the range", async () => {
    const r = await ok();
    expect(r.metrics.totalCompanies.value).toBe(2);
    expect(r.metrics.newProspects.rows.map((x) => x.company)).toEqual(["Ace"]);
    expect(r.metrics.contactsMade.value).toBe(1); // not the one from early October, nor the archived company's
    expect(r.metrics.followUpsCompleted.value).toBe(1); // only the one completed this week
    expect(r.metrics.dueToday.value).toBe(1); // a cancelled follow-up is not due
  });

  it("reads amounts that arrive as text, and counts a company-level win", async () => {
    const r = await ok();
    expect(r.metrics.salesValue.money).toBe(7500.5);
    expect(r.sales.fromCompanies).toEqual({ count: 1, value: 7500.5 });
    expect(r.pipeline.find((s) => s.name === "New Prospect")).toMatchObject({ count: 1, estimate: 2500 });
    expect(r.pipeline.map((s) => s.name)).toEqual(["New Prospect", "Won"]); // stage order read as numbers
  });

  it("uses the range asked for", async () => {
    const last = await ok({ range: "last_week" });
    expect(last.range).toMatchObject({ from: "2026-10-12", to: "2026-10-18", label: "Last week" });
    expect(last.metrics.contactsMade.value).toBe(0); // the call on the 10th is before last week began, and this week's is after it
    const custom = await ok({ range: "custom", from: "2026-10-01", to: "2026-10-31" });
    expect(custom.metrics.contactsMade.value).toBe(2);
  });

  it("refuses a bad custom range with a message", async () => {
    expect(await loadReport(req({ range: "custom", from: "2026-10-31", to: "2026-10-01" }), TODAY)).toEqual({ error: "The start date must not be after the end date." });
  });

  it("only lists team members, not viewers", async () => {
    const r = await ok();
    expect(r.byStaff.map((x) => x.label)).toEqual(["Joanna Byrne"]);
  });

  it("surfaces a database failure rather than a report that looks empty", async () => {
    fake.failTable = "crm_stages";
    await expect(loadReport(req(), TODAY)).rejects.toThrow(/Could not load the report data/);
  });
});
