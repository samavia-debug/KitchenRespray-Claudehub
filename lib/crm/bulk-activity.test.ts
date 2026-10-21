import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, fakeFrom } from "./fake-db";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: fakeFrom }) }));
const tables = fake.tables;

import { bulkLogActivity, logActivity } from "./activity-service";
import { addDays, dublinToday } from "./followups";
import { ACTIVITY_TYPES, CONTACT_ACTIVITY_TYPES } from "./types";
import { cleanActivityInput, cleanBulkActivity } from "./validate";

const JOANNA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SAJAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IDS = [1, 2, 3, 4].map(uuid);
const today = () => dublinToday();
const daysAgo = (n: number, hour = 12) => new Date(Date.parse(`${addDays(today(), -n)}T${String(hour).padStart(2, "0")}:00:00Z`)).toISOString();

const clean = (body: Record<string, unknown>) => {
  const out = cleanBulkActivity({ ids: IDS, type: "WhatsApp message", confirmed: true, ...body });
  if ("error" in out) throw new Error(out.error);
  return out.value;
};
const company = (id: string) => tables.crm_companies.find((c) => c.id === id)!;

beforeEach(() => {
  fake.reset();
  tables.profiles = [
    { id: JOANNA, email: "joanna@example.test", role: "Staff" },
    { id: SAJAD, email: "sajad@example.test", role: "Staff" },
    { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "viewer@example.test", role: "Viewer" },
  ];
  tables.crm_companies = IDS.map((id, i) => ({ id, name: `Joinery ${i + 1}`, archived_at: null, last_activity_type: null, last_activity_at: null, last_contacted_at: null, next_follow_up: null }));
  tables.crm_activities = [];
  tables.crm_tasks = [];
});

describe("WhatsApp activity types", () => {
  it("are activity types, and count as contacting the company", () => {
    for (const t of ["WhatsApp message", "WhatsApp follow-up"]) {
      expect(ACTIVITY_TYPES).toContain(t);
      expect(CONTACT_ACTIVITY_TYPES).toContain(t);
      expect(cleanActivityInput({ company_id: IDS[0], type: t })).toHaveProperty("value");
    }
  });

  it("are in the list the database allows (the migration)", async () => {
    const { readFileSync } = await import("fs");
    const sql = readFileSync(new URL("../../supabase/migrations/20261026100000_crm_whatsapp_activity.sql", import.meta.url), "utf8");
    for (const t of ACTIVITY_TYPES) expect(sql, t).toContain(`'${t}'`);
  });
});

describe("checking a bulk activity", () => {
  it("accepts a list of companies with the usual activity details", () => {
    const v = clean({ notes: "Hi, we have just launched a spray painting calculator", occurred_at: daysAgo(3), next_follow_up: addDays(today(), 5), next_action: "Follow up on WhatsApp" });
    expect(v.ids).toHaveLength(4);
    expect(v.activity).toMatchObject({ type: "WhatsApp message", notes: expect.stringContaining("calculator"), next_action: "Follow up on WhatsApp" });
    expect(v.activity).not.toHaveProperty("company_id");
  });

  it("refuses no companies, too many, a bad id, no type, a future time or a past follow-up date", () => {
    for (const bad of [{ ids: [] }, { ids: Array.from({ length: 201 }, (_, i) => uuid(i + 1)) }, { ids: ["nope"] }, { type: "" }, { type: "Telepathy" }, { occurred_at: new Date(Date.now() + 86_400_000).toISOString() }, { next_follow_up: addDays(today(), -1) }]) {
      expect(cleanBulkActivity({ ids: IDS, type: "WhatsApp message", confirmed: true, ...bad }), JSON.stringify(bad).slice(0, 40)).toHaveProperty("error");
    }
  });

  it("does not take a contact, because a contact belongs to one company", () => {
    expect(clean({ contact_id: uuid(99) }).activity).not.toHaveProperty("contact_id");
  });

  it("removes duplicate ids", () => {
    expect(clean({ ids: [IDS[0], IDS[0], IDS[1]] }).ids).toEqual([IDS[0], IDS[1]]);
  });
});

describe("bulkLogActivity", () => {
  it("records the activity on every company, with the wording, and moves last contacted", async () => {
    const sentAt = daysAgo(3);
    const r = await bulkLogActivity(clean({ occurred_at: sentAt, notes: "Calculator message" }), JOANNA);
    expect(r).toEqual({ logged: 4, alreadyLogged: 0, notFound: 0, followUps: 0 });
    expect(tables.crm_activities).toHaveLength(4);
    expect(tables.crm_activities.every((a) => a.type === "WhatsApp message" && a.notes === "Calculator message" && a.user_id === JOANNA && a.occurred_at === sentAt)).toBe(true);
    for (const id of IDS) expect(company(id)).toMatchObject({ last_activity_type: "WhatsApp message", last_activity_at: sentAt, last_contacted_at: sentAt });
    expect(tables.crm_events.some((e) => e.action === "bulk_activity")).toBe(true);
  });

  it("does nothing unless confirmed", async () => {
    const r = await bulkLogActivity({ ...clean({}), confirmed: false }, JOANNA);
    expect(r).toHaveProperty("error");
    expect(tables.crm_activities).toHaveLength(0);
  });

  it("does not record it twice for the same day if the button is pressed again", async () => {
    await bulkLogActivity(clean({ occurred_at: daysAgo(3) }), JOANNA);
    const again = await bulkLogActivity(clean({ occurred_at: daysAgo(3, 15) }), JOANNA);
    expect(again).toEqual({ logged: 0, alreadyLogged: 4, notFound: 0, followUps: 0 });
    expect(tables.crm_activities).toHaveLength(4);
  });

  it("does record the same kind of message on a different day, or a different kind on the same day", async () => {
    await bulkLogActivity(clean({ occurred_at: daysAgo(10) }), JOANNA);
    expect((await bulkLogActivity(clean({ occurred_at: daysAgo(3) }), JOANNA)) as any).toMatchObject({ logged: 4 });
    expect((await bulkLogActivity(clean({ type: "WhatsApp follow-up", occurred_at: daysAgo(3) }), JOANNA)) as any).toMatchObject({ logged: 4 });
    expect(tables.crm_activities).toHaveLength(12);
  });

  it("only skips the companies that already have it, and logs the rest", async () => {
    await logActivity({ company_id: IDS[0], type: "WhatsApp message", occurred_at: daysAgo(3) }, JOANNA);
    const r = await bulkLogActivity(clean({ occurred_at: daysAgo(3, 14) }), JOANNA);
    expect(r).toEqual({ logged: 3, alreadyLogged: 1, notFound: 0, followUps: 0 });
  });

  it("skips archived and missing companies and says so", async () => {
    company(IDS[1]).archived_at = new Date().toISOString();
    const r = await bulkLogActivity(clean({ ids: [...IDS, uuid(77)], occurred_at: daysAgo(2) }), JOANNA);
    expect(r).toEqual({ logged: 3, alreadyLogged: 0, notFound: 2, followUps: 0 });
    expect(tables.crm_activities.some((a) => a.company_id === IDS[1])).toBe(false);
  });

  it("never moves 'last contacted' backwards when an older message is entered late", async () => {
    const recent = daysAgo(1);
    company(IDS[0]).last_activity_at = recent;
    company(IDS[0]).last_activity_type = "Telephone call";
    company(IDS[0]).last_contacted_at = recent;
    await bulkLogActivity(clean({ occurred_at: daysAgo(20) }), JOANNA);
    expect(company(IDS[0])).toMatchObject({ last_activity_type: "Telephone call", last_activity_at: recent, last_contacted_at: recent });
    expect(company(IDS[1]).last_contacted_at).toBe(daysAgo(20)); // the others had nothing, so it moves
  });

  it("does not count research as contact", async () => {
    await bulkLogActivity(clean({ type: "Initial research", occurred_at: daysAgo(2) }), JOANNA);
    expect(company(IDS[0])).toMatchObject({ last_activity_type: "Initial research", last_contacted_at: null });
  });

  it("books a follow-up for each company, and keeps the earliest as the next follow-up", async () => {
    const soon = addDays(today(), 5);
    company(IDS[0]).next_follow_up = addDays(today(), 2); // already has an earlier one
    company(IDS[1]).next_follow_up = addDays(today(), 30); // has a later one, which the new one beats
    const r = await bulkLogActivity(clean({ occurred_at: daysAgo(1), next_follow_up: soon, next_action: "Follow up on WhatsApp" }), JOANNA);
    expect(r).toMatchObject({ logged: 4, followUps: 4 });
    expect(tables.crm_tasks).toHaveLength(4);
    expect(tables.crm_tasks.every((t) => t.title === "Follow up on WhatsApp" && t.due_date === soon && t.assigned_to === JOANNA && t.status === "open")).toBe(true);
    expect(tables.crm_tasks.every((t) => tables.crm_activities.some((a) => a.id === t.source_activity_id && a.company_id === t.company_id))).toBe(true);
    expect(company(IDS[0]).next_follow_up).toBe(addDays(today(), 2));
    expect(company(IDS[1]).next_follow_up).toBe(soon);
    expect(company(IDS[2]).next_follow_up).toBe(soon);
  });

  it("can be recorded as another team member's work, but not a Viewer's", async () => {
    await bulkLogActivity(clean({ user_id: SAJAD, occurred_at: daysAgo(2) }), JOANNA);
    expect(tables.crm_activities.every((a) => a.user_id === SAJAD && a.created_by === JOANNA)).toBe(true);
    const viewer = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    expect(await bulkLogActivity(clean({ user_id: viewer, occurred_at: daysAgo(5) }), JOANNA)).toHaveProperty("error");
  });

  it("handles the largest list in one go", async () => {
    const many = Array.from({ length: 200 }, (_, i) => uuid(1000 + i));
    tables.crm_companies = many.map((id, i) => ({ id, name: `Joinery ${i}`, archived_at: null, last_activity_at: null, last_contacted_at: null, next_follow_up: null }));
    const r = await bulkLogActivity(clean({ ids: many, occurred_at: daysAgo(1), next_follow_up: addDays(today(), 4) }), JOANNA);
    expect(r).toEqual({ logged: 200, alreadyLogged: 0, notFound: 0, followUps: 200 });
  });
});
