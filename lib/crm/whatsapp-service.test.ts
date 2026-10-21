import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, fakeFrom } from "./fake-db";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: fakeFrom }) }));
const tables = fake.tables;

import { bulkLogActivity } from "./activity-service";
import { addDays, dublinToday } from "./followups";
import { dublinDayStart } from "./report-range";
import { DEFAULT_TEMPLATES, fillTemplate } from "./whatsapp";
import { buildQueue, cleanTemplates, getTemplates, saveTemplates } from "./whatsapp-service";
import { cleanBulkActivity } from "./validate";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D, E] = [1, 2, 3, 4, 5].map(uuid);
const TODAY = dublinToday();
const day = (n: number) => addDays(TODAY, n);
const earlier = (n: number) => new Date(Date.parse(`${day(-n)}T12:00:00Z`)).toISOString();

const ids = () => [A, B, C, D, E];

beforeEach(() => {
  fake.reset();
  tables.profiles = [{ id: USER, email: "joanna@example.test", role: "Staff" }];
  tables.crm_companies = [
    { id: A, name: "Murphy Joinery", city: "Kilkenny", county: "Kilkenny", phone: "01 555 0100", mobile: "087 111 2222", archived_at: null },
    { id: B, name: "Byrne Carpentry", city: "Carlow", county: "County Carlow", phone: "086 333 4444", mobile: null, archived_at: null },
    { id: C, name: "Landline Only Ltd", city: "Naas", county: "Kildare", phone: "045 555 0100", mobile: null, archived_at: null },
    { id: D, name: "Archived Ltd", city: "Cork", county: null, phone: "087 999 8888", mobile: null, archived_at: "2026-01-01T00:00:00Z" },
    { id: E, name: "No County Ltd", city: null, county: null, phone: null, mobile: null, archived_at: null },
  ];
  tables.crm_contacts = [
    { id: "ct1", company_id: A, full_name: "Mr Murphy", phone: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "ct2", company_id: A, full_name: "Sean Murphy", phone: "085 000 1111", created_at: "2026-01-02T00:00:00Z" },
    { id: "ct3", company_id: C, full_name: "Pat Ryan", phone: "083 222 3333", created_at: "2026-01-01T00:00:00Z" },
  ];
  tables.crm_activities = [];
  tables.crm_tasks = [];
  tables.crm_specials = [];
  tables.crm_events = [];
  tables.crm_whatsapp_settings = [];
});

describe("the fixed messages", () => {
  it("are the starter messages until an Admin saves their own", async () => {
    expect(await getTemplates()).toEqual({ ...DEFAULT_TEMPLATES, saved: false });
  });

  it("are kept once saved, and the saving is logged", async () => {
    await saveTemplates({ first_message: "Hi {name}, {sender} from Kitchen Respray. {offer}", follow_up: "Hi {name}, checking you saw this" }, USER);
    expect(await getTemplates()).toEqual({ first_message: "Hi {name}, {sender} from Kitchen Respray. {offer}", follow_up: "Hi {name}, checking you saw this", saved: true });
    expect(tables.crm_events).toEqual([expect.objectContaining({ action: "whatsapp_templates_saved", user_id: USER })]);
    // Saving again replaces the one row rather than adding another.
    await saveTemplates({ first_message: "New {name}", follow_up: "New again {name}" }, USER);
    expect(tables.crm_whatsapp_settings).toHaveLength(1);
  });

  it("falls back to the starter wording for a message that was left blank in the database", async () => {
    tables.crm_whatsapp_settings = [{ id: 1, first_message: "  ", follow_up: "Only this {name}" }];
    expect(await getTemplates()).toEqual({ first_message: DEFAULT_TEMPLATES.first_message, follow_up: "Only this {name}", saved: true });
  });

  it("are checked before saving: text only, not empty, not too long, only blanks we fill in", () => {
    const ok = { first_message: "Hi {name}\r\nfrom {sender}", follow_up: "Hi {name}" };
    expect(cleanTemplates(ok)).toEqual({ value: { first_message: "Hi {name}\nfrom {sender}", follow_up: "Hi {name}" } });
    for (const bad of [null, [], "x", {}, { first_message: "a", follow_up: 5 }, { first_message: "  ", follow_up: "a" }, { first_message: "a", follow_up: "x".repeat(1001) }]) {
      expect("error" in cleanTemplates(bad), JSON.stringify(bad)).toBe(true);
    }
    expect(cleanTemplates({ first_message: "Hi {nmae}", follow_up: "a" })).toEqual({ error: expect.stringContaining("{nmae}") });
    expect(cleanTemplates({ first_message: "a", follow_up: "x".repeat(1000) })).toHaveProperty("value");
  });
});

describe("the queue", () => {
  it("lists the companies in the order they were selected, leaving out archived and unknown ones", async () => {
    const q = await buildQueue([C, A, D, "99999999-9999-4999-8999-999999999999", B], TODAY);
    expect(q.entries.map((e) => e.name)).toEqual(["Landline Only Ltd", "Murphy Joinery", "Byrne Carpentry"]);
    expect(q.notFound).toBe(2);
  });

  it("picks the number to open, and says why there is none", async () => {
    const q = await buildQueue(ids(), TODAY);
    const by = (name: string) => q.entries.find((e) => e.name === name)!;
    expect(by("Murphy Joinery")).toMatchObject({ number: "353871112222", shown: "087 111 2222", reason: null });
    expect(by("Byrne Carpentry")).toMatchObject({ number: "353863334444", shown: "086 333 4444" });
    // The company's own phone is a landline, so a contact's mobile is used.
    expect(by("Landline Only Ltd")).toMatchObject({ number: "353832223333", shown: "083 222 3333" });
    expect(by("No County Ltd")).toMatchObject({ number: null, reason: "No phone number on record" });
  });

  it("uses a contact's first name, skipping a title, and writes the county the modern way", async () => {
    const q = await buildQueue([A, B], TODAY);
    expect(q.entries[0]).toMatchObject({ contact_first_name: "Sean", county: "Kilkenny" });
    expect(q.entries[1]).toMatchObject({ contact_first_name: null, county: "Carlow" });
  });

  it("brings the special running in the company's county, preferring its own county over a Leinster-wide one", async () => {
    const base = { code: null, ends_on: null, active: true, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
    tables.crm_specials = [
      { id: "s1", title: "Kilkenny", offer: "free colour match", county: "Kilkenny", starts_on: day(-10), ...base, code: "KK1" },
      { id: "s2", title: "All Leinster", offer: "free quote", county: null, starts_on: day(-1), ...base },
      { id: "s3", title: "Not yet", offer: "later", county: "Carlow", starts_on: day(5), ...base },
      { id: "s4", title: "Finished", offer: "old", county: "Carlow", starts_on: day(-20), ...base, ends_on: day(-10) },
      { id: "s5", title: "Switched off", offer: "off", county: "Carlow", starts_on: day(-3), ...base, active: false },
    ];
    const q = await buildQueue([A, B, E], TODAY);
    expect(q.entries[0]).toMatchObject({ offer: "free colour match", code: "KK1" });
    expect(q.entries[1]).toMatchObject({ offer: "free quote", code: null }); // Carlow: only the Leinster-wide one is running
    expect(q.entries[2]).toMatchObject({ offer: "free quote" }); // no county: only an everywhere special applies
  });

  it("shows the last WhatsApp, and leaves out a company that already had one today", async () => {
    tables.crm_activities = [
      { id: "a1", company_id: A, type: "WhatsApp message", occurred_at: earlier(9) },
      { id: "a2", company_id: A, type: "WhatsApp follow-up", occurred_at: earlier(2) },
      { id: "a3", company_id: B, type: "WhatsApp message", occurred_at: new Date().toISOString() },
      { id: "a4", company_id: C, type: "Telephone call", occurred_at: new Date().toISOString() },
    ];
    const q = await buildQueue([A, B, C], TODAY);
    const by = (name: string) => q.entries.find((e) => e.name === name)!;
    expect(by("Murphy Joinery")).toMatchObject({ last_whatsapp: { type: "WhatsApp follow-up", at: earlier(2) }, sent_today: false });
    expect(by("Byrne Carpentry").sent_today).toBe(true);
    // A phone call is not a WhatsApp.
    expect(by("Landline Only Ltd")).toMatchObject({ last_whatsapp: null, sent_today: false });
  });

  it("counts 'today' as the Irish day, not the UTC one", async () => {
    const start = dublinDayStart(TODAY);
    const justBefore = new Date(Date.parse(start) - 60_000).toISOString();
    const justAfter = new Date(Date.parse(start) + 60_000).toISOString();
    tables.crm_activities = [
      { id: "a1", company_id: A, type: "WhatsApp message", occurred_at: justBefore },
      { id: "a2", company_id: B, type: "WhatsApp message", occurred_at: justAfter },
    ];
    const q = await buildQueue([A, B], TODAY);
    expect(q.entries.map((e) => e.sent_today)).toEqual([false, true]);
  });

  it("carries the messages, and whether they are saved", async () => {
    expect(await buildQueue([A], TODAY)).toMatchObject({ templates: DEFAULT_TEMPLATES, templatesSaved: false });
    await saveTemplates({ first_message: "Hi {name}", follow_up: "Again {name}" }, USER);
    expect(await buildQueue([A], TODAY)).toMatchObject({ templates: { first_message: "Hi {name}", follow_up: "Again {name}" }, templatesSaved: true });
  });

  it("gives a plain message when the database fails, not the database's own words", async () => {
    fake.failTable = "crm_contacts";
    await expect(buildQueue([A], TODAY)).rejects.toMatchObject({ publicMessage: "Could not load the contacts" });
  });
});

describe("working through the queue", () => {
  const send = async (id: string, text: string, extra: Record<string, unknown> = {}) => {
    const cleaned = cleanBulkActivity({ ids: [id], type: "WhatsApp message", occurred_at: new Date().toISOString(), notes: text, user_id: USER, confirmed: true, ...extra });
    if ("error" in cleaned) throw new Error(cleaned.error);
    return bulkLogActivity(cleaned.value, USER);
  };

  it("fills each company's message, records what was sent, and leaves the company out next time", async () => {
    await saveTemplates({ first_message: "Hi {name}, {sender} here. In {county} we have {offer}.", follow_up: "Hi {name} again" }, USER);
    tables.crm_specials = [{ id: "s1", title: "K", offer: "a free colour match", code: null, county: "Kilkenny", starts_on: day(-1), ends_on: null, active: true, created_at: "x", updated_at: "x" }];

    const q = await buildQueue([A, B], TODAY);
    const msgs = q.entries.map((e) => fillTemplate(q.templates.first_message, { name: e.contact_first_name, company: e.name, county: e.county, sender: "Joanna", offer: e.offer, code: e.code }));
    expect(msgs[0]).toEqual({ text: "Hi Sean, Joanna here. In Kilkenny we have a free colour match.", problems: [] });
    // Carlow has no special running, so its message is held back instead of going out with a gap.
    expect(msgs[1].problems).toEqual(["No special is running in Carlow"]);

    // Murphy's message was sent: record it with the text that went out.
    expect(await send(A, msgs[0].text)).toMatchObject({ logged: 1, alreadyLogged: 0 });
    expect(tables.crm_activities).toEqual([expect.objectContaining({ company_id: A, type: "WhatsApp message", notes: msgs[0].text, user_id: USER })]);
    expect(tables.crm_companies.find((c) => c.id === A)).toMatchObject({ last_activity_type: "WhatsApp message" });
    expect(tables.crm_companies.find((c) => c.id === A)!.last_contacted_at).toBeTruthy();

    // Opening the queue again leaves that company out; the one that was held back is still there.
    const again = await buildQueue([A, B], TODAY);
    expect(again.entries.map((e) => [e.name, e.sent_today])).toEqual([["Murphy Joinery", true], ["Byrne Carpentry", false]]);
  });

  it("pressing 'Sent' twice for one company records it once", async () => {
    expect(await send(A, "Hi")).toMatchObject({ logged: 1 });
    expect(await send(A, "Hi")).toMatchObject({ logged: 0, alreadyLogged: 1 });
    expect(tables.crm_activities).toHaveLength(1);
  });

  it("books the follow-up for just that company", async () => {
    const due = day(7);
    expect(await send(A, "Hi", { next_follow_up: due, next_action: "Follow up on WhatsApp" })).toMatchObject({ logged: 1, followUps: 1 });
    expect(tables.crm_tasks).toEqual([expect.objectContaining({ company_id: A, due_date: due, title: "Follow up on WhatsApp", assigned_to: USER })]);
    expect(tables.crm_companies.find((c) => c.id === A)!.next_follow_up).toBe(due);
    expect(tables.crm_companies.find((c) => c.id === B)!.next_follow_up ?? null).toBeNull();
  });
});
