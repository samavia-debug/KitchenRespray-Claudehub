import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, fakeFrom } from "./fake-db";

// The database is the shared in-memory stand-in in fake-db.ts.
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: fakeFrom }) }));
const tables = fake.tables;


import { archiveCompany, bulkUpdate, changeStage, createCompany, createContact, deleteContact, getCompany, listCompanies, pipelineSummary, saveStage, updateCompany, updateContact } from "./service";
import { cleanCompanyQuery } from "./validate";

const STAGES = [
  ["New Prospect", "open"], ["Ready to Contact", "open"], ["Contacted", "open"], ["Interested", "open"],
  ["Won", "won"], ["Lost", "lost"], ["Not Suitable", "not_suitable"],
] as const;

const stageId = (name: string) => tables.crm_stages.find((s) => s.name === name)!.id;
const USER = "user-joanna";
const query = (qs = "") => cleanCompanyQuery(new URLSearchParams(qs));

beforeEach(() => {
  fake.reset();
  tables.crm_stages = STAGES.map(([name, kind], i) => ({ id: `stage-${name}`, name, kind, sort_order: i + 1, active: true }));
  tables.crm_categories = [{ id: "cat-builders", name: "Builders", sort_order: 1, active: true }];
  tables.profiles = [
    { id: USER, email: "joanna@example.test", role: "Staff" },
    { id: "user-sajad", email: "sajad@example.test", role: "Staff" },
    { id: "user-viewer", email: "viewer@example.test", role: "Viewer" },
  ];
});

describe("createCompany", () => {
  it("saves a company at the first stage with its search keys, and records who made it", async () => {
    const r = await createCompany({ name: "Ace Roofing Ltd", phone: "+353 87 123 4567", website: "https://www.aceroofing.ie" }, USER, false);
    expect("id" in r).toBe(true);
    const row = tables.crm_companies[0];
    expect(row).toMatchObject({ stage_id: "stage-New Prospect", created_by: USER, name_key: "ace roofing", phone_key: "871234567", website_domain: "aceroofing.ie" });
  });

  it("warns about a look-alike and saves nothing until the person confirms", async () => {
    await createCompany({ name: "Ace Roofing Ltd", phone: "+353 87 123 4567" }, USER, false);
    const dup = await createCompany({ name: "Something Different", phone: "087 123 4567" }, USER, false);
    expect("duplicates" in dup && dup.duplicates[0]).toMatchObject({ name: "Ace Roofing Ltd", strength: "strong" });
    expect(tables.crm_companies).toHaveLength(1);

    const forced = await createCompany({ name: "Something Different", phone: "087 123 4567" }, USER, true);
    expect("id" in forced).toBe(true);
    expect(tables.crm_companies).toHaveLength(2);
  });

  it("does not warn about unrelated companies or archived ones", async () => {
    await createCompany({ name: "Ace Roofing", phone: "087 123 4567" }, USER, false);
    tables.crm_companies[0].archived_at = new Date().toISOString();
    expect("id" in (await createCompany({ name: "Ace Roofing", phone: "087 123 4567" }, USER, false))).toBe(true);
    expect("id" in (await createCompany({ name: "Zed Plumbing" }, USER, false))).toBe(true);
  });

  it("keeps contact details out of the audit trail", async () => {
    await createCompany({ name: "Ace Roofing", phone: "087 123 4567", email: "joe@aceroofing.ie", notes: "Ask for Joe" }, USER, false);
    await updateCompany(tables.crm_companies[0].id, { phone: "087 999 8888" }, null, USER);
    const trail = JSON.stringify(tables.crm_events);
    expect(trail).not.toMatch(/087|joe@|Ask for Joe|aceroofing/i);
    expect(tables.crm_events.map((e) => e.action)).toEqual(["company_created", "company_updated"]);
  });
});

describe("updateCompany", () => {
  it("refuses to overwrite a change someone else saved", async () => {
    await createCompany({ name: "Ace Roofing" }, USER, false);
    const row = tables.crm_companies[0];
    const stale = row.updated_at;

    expect(await updateCompany(row.id, { notes: "First" }, stale, USER)).toHaveProperty("company");
    const second = await updateCompany(row.id, { notes: "Second, from an old screen" }, stale, "user-sajad");
    expect(second).toEqual({ conflict: true });
    expect(tables.crm_companies[0].notes).toBe("First");
  });

  it("recomputes the duplicate keys when a detail they come from changes", async () => {
    await createCompany({ name: "Ace Roofing", phone: "087 123 4567" }, USER, false);
    const row = tables.crm_companies[0];
    await updateCompany(row.id, { phone: "01 555 0100" }, null, USER);
    expect(tables.crm_companies[0].phone_key).toBe("15550100");
  });

  it("reports a company that does not exist or is archived", async () => {
    expect(await updateCompany("nope", { notes: "x" }, null, USER)).toEqual({ notFound: true });
    await createCompany({ name: "Ace" }, USER, false);
    await archiveCompany(tables.crm_companies[0].id, USER);
    expect(await updateCompany(tables.crm_companies[0].id, { notes: "x" }, null, USER)).toEqual({ notFound: true });
  });
});

describe("changeStage", () => {
  async function company() {
    await createCompany({ name: "Ace Roofing" }, USER, false);
    return tables.crm_companies[0].id as string;
  }

  it("moves a company, and records who and when", async () => {
    const id = await company();
    const r = await changeStage(id, { stage_id: stageId("Contacted"), confirmed: false, outcome_note: null, won_value: null }, USER);
    expect("company" in r).toBe(true);
    expect(tables.crm_companies[0].stage_id).toBe("stage-Contacted");
    expect(tables.crm_stage_history[0]).toMatchObject({ company_id: id, from_stage_id: "stage-New Prospect", to_stage_id: "stage-Contacted", user_id: USER });
  });

  it("will not close a deal without confirmation", async () => {
    const id = await company();
    for (const name of ["Won", "Lost", "Not Suitable"]) {
      const r = await changeStage(id, { stage_id: stageId(name), confirmed: false, outcome_note: null, won_value: 5000 }, USER);
      expect(r).toMatchObject({ error: expect.stringMatching(/confirmed/), status: 400 });
    }
    expect(tables.crm_companies[0].stage_id).toBe("stage-New Prospect");
    expect(tables.crm_stage_history ?? []).toHaveLength(0);
  });

  it("records the value won only against a win, apart from the estimate", async () => {
    const id = await company();
    await updateCompany(id, { estimated_value: 20000 }, null, USER);
    await changeStage(id, { stage_id: stageId("Won"), confirmed: true, outcome_note: "Fitted 12 doors", won_value: 14250 }, USER);
    expect(tables.crm_companies[0]).toMatchObject({ won_value: 14250, outcome_note: "Fitted 12 doors", estimated_value: 20000 });

    // A loss never carries a value, even if one was sent.
    await changeStage(id, { stage_id: stageId("Lost"), confirmed: true, outcome_note: "Went elsewhere", won_value: 99 }, USER);
    expect(tables.crm_companies[0]).toMatchObject({ won_value: null, outcome_note: "Went elsewhere" });

    // Reopening clears the closing details but the history keeps them.
    await changeStage(id, { stage_id: stageId("Interested"), confirmed: false, outcome_note: "ignored", won_value: 5 }, USER);
    expect(tables.crm_companies[0]).toMatchObject({ won_value: null, outcome_note: null });
    expect(tables.crm_stage_history.map((h) => h.won_value)).toEqual([14250, null, null]);
  });

  it("rejects the same stage, an unknown stage and a switched-off stage", async () => {
    const id = await company();
    expect(await changeStage(id, { stage_id: stageId("New Prospect"), confirmed: false, outcome_note: null, won_value: null }, USER)).toMatchObject({ status: 400 });
    expect(await changeStage(id, { stage_id: "missing", confirmed: false, outcome_note: null, won_value: null }, USER)).toMatchObject({ status: 400 });
    tables.crm_stages.find((s) => s.name === "Contacted")!.active = false;
    expect(await changeStage(id, { stage_id: stageId("Contacted"), confirmed: false, outcome_note: null, won_value: null }, USER)).toMatchObject({ status: 400 });
    expect(await changeStage("gone", { stage_id: stageId("Interested"), confirmed: false, outcome_note: null, won_value: null }, USER)).toMatchObject({ status: 404 });
  });
});

describe("bulkUpdate", () => {
  async function two() {
    await createCompany({ name: "Ace Roofing" }, USER, false);
    await createCompany({ name: "Beta Builders" }, USER, false);
    return tables.crm_companies.map((c) => c.id as string);
  }

  it("does nothing until confirmed", async () => {
    const ids = await two();
    expect(await bulkUpdate({ ids, action: "assign", value: "user-sajad", confirmed: false }, USER)).toHaveProperty("error");
    expect(tables.crm_companies.every((c) => c.assigned_to === undefined)).toBe(true);
  });

  it("assigns to a team member but not to a viewer", async () => {
    const ids = await two();
    expect(await bulkUpdate({ ids, action: "assign", value: "user-viewer", confirmed: true }, USER)).toHaveProperty("error");
    expect(await bulkUpdate({ ids, action: "assign", value: "user-sajad", confirmed: true }, USER)).toEqual({ updated: 2 });
    expect(tables.crm_companies.map((c) => c.assigned_to)).toEqual(["user-sajad", "user-sajad"]);
  });

  it("sets a category, and can clear it, and skips archived companies", async () => {
    const ids = await two();
    await archiveCompany(ids[1], USER);
    expect(await bulkUpdate({ ids, action: "category", value: "cat-builders", confirmed: true }, USER)).toEqual({ updated: 1 });
    expect(tables.crm_companies[0].category_id).toBe("cat-builders");
    expect(await bulkUpdate({ ids, action: "category", value: "nope", confirmed: true }, USER)).toHaveProperty("error");
  });
});

describe("listCompanies", () => {
  beforeEach(async () => {
    await createCompany({ name: "Ace Roofing", city: "Dublin", phone: "087 123 4567", priority: "High" }, USER, false);
    await createCompany({ name: "Beta Builders", city: "Bray", assigned_to: "user-sajad" }, USER, false);
    await createCompany({ name: "Cork Carpentry", city: "Cork", estimated_value: 5000 }, USER, false);
    await createContact({ company_id: tables.crm_companies[2].id, full_name: "Mary Murphy", job_title: "Owner" }, USER, false);
  });

  it("finds a company by its name, its town, a phone number written differently, or one of its contacts", async () => {
    const names = async (qs: string) => (await listCompanies(query(qs))).companies.map((c) => c.name);
    expect(await names("q=roofing")).toEqual(["Ace Roofing"]);
    expect(await names("q=bray")).toEqual(["Beta Builders"]);
    expect(await names("q=123 4567")).toEqual(["Ace Roofing"]);
    expect(await names("q=murphy")).toEqual(["Cork Carpentry"]);
  });

  it("filters, sorts and pages", async () => {
    const list = (qs: string) => listCompanies(query(qs));
    expect((await list("assigned_to=none")).companies.map((c) => c.name)).toEqual(["Ace Roofing", "Cork Carpentry"]);
    expect((await list("assigned_to=user-sajad")).total).toBe(3); // not a valid id, so the filter is ignored rather than injected
    expect((await list("min_value=1000")).companies.map((c) => c.name)).toEqual(["Cork Carpentry"]);
    expect((await list("sort=city&dir=desc")).companies.map((c) => c.city)).toEqual(["Dublin", "Cork", "Bray"]);
    const page2 = await list("pageSize=2&page=2");
    expect(page2.total).toBe(3);
    expect(page2.companies.map((c) => c.name)).toEqual(["Cork Carpentry"]);
  });

  it("never lists archived companies", async () => {
    await archiveCompany(tables.crm_companies[0].id, USER);
    expect((await listCompanies(query())).total).toBe(2);
  });

  it("does not let search text change the query", async () => {
    const r = await listCompanies(query("q=x,id.neq.1)"));
    expect(r.companies).toEqual([]);
  });
});

describe("contacts", () => {
  async function company() {
    await createCompany({ name: "Ace Roofing" }, USER, false);
    return tables.crm_companies[0].id as string;
  }

  it("adds contacts, and warns about the same email or the same name at the same company", async () => {
    const id = await company();
    expect("id" in (await createContact({ company_id: id, full_name: "Joe Byrne", email: "joe@aceroofing.ie" }, USER, false))).toBe(true);

    const sameEmail = await createContact({ company_id: id, full_name: "J Byrne", email: "JOE@aceroofing.ie" }, USER, false);
    expect("duplicates" in sameEmail && sameEmail.duplicates[0].reasons).toEqual(["same email address"]);
    const sameName = await createContact({ company_id: id, full_name: "joe byrne" }, USER, false);
    expect("duplicates" in sameName && sameName.duplicates[0].reasons).toEqual(["same name at this company"]);
    expect(tables.crm_contacts).toHaveLength(1);

    expect("id" in (await createContact({ company_id: id, full_name: "joe byrne" }, USER, true))).toBe(true);
    expect(tables.crm_contacts).toHaveLength(2);
  });

  it("does not let a crafted email address change the duplicate check, and still saves the contact", async () => {
    const id = await company();
    await createContact({ company_id: id, full_name: "Joe Byrne", email: "joe@aceroofing.ie" }, USER, false);
    const crafted = await createContact({ company_id: id, full_name: "Someone Else", email: "x@y.ie),email_key.neq.(z" }, USER, false);
    // Nothing is reported as a duplicate of the real contact, and the contact is saved without error.
    expect("id" in crafted).toBe(true);
    expect(tables.crm_contacts).toHaveLength(2);
  });

  it("allows the same name at a different company", async () => {
    const id = await company();
    await createContact({ company_id: id, full_name: "Joe Byrne" }, USER, false);
    await createCompany({ name: "Other Builders" }, USER, false);
    expect("id" in (await createContact({ company_id: tables.crm_companies[1].id, full_name: "Joe Byrne" }, USER, false))).toBe(true);
  });

  it("will not add a contact to a company that is missing or archived", async () => {
    expect(await createContact({ company_id: "nope", full_name: "Joe" }, USER, false)).toEqual({ notFound: true });
    const id = await company();
    await archiveCompany(id, USER);
    expect(await createContact({ company_id: id, full_name: "Joe" }, USER, false)).toEqual({ notFound: true });
  });

  it("detects a conflicting edit, and never moves a contact to another company", async () => {
    const id = await company();
    await createContact({ company_id: id, full_name: "Joe Byrne" }, USER, false);
    const contact = tables.crm_contacts[0];
    const stale = contact.updated_at;

    const ok = await updateContact(contact.id, { job_title: "Owner", company_id: "other-company" }, stale, USER);
    expect(ok).toMatchObject({ ok: true });
    expect(tables.crm_contacts[0]).toMatchObject({ job_title: "Owner", company_id: id });

    expect(await updateContact(contact.id, { job_title: "Manager" }, stale, "user-sajad")).toEqual({ conflict: true });
    expect(tables.crm_contacts[0].job_title).toBe("Owner");
  });

  it("deletes a contact and leaves only a note that it happened", async () => {
    const id = await company();
    await createContact({ company_id: id, full_name: "Joe Byrne", phone: "087 123 4567" }, USER, false);
    expect(await deleteContact(tables.crm_contacts[0].id, USER)).toBe(true);
    expect(tables.crm_contacts).toHaveLength(0);
    expect(JSON.stringify(tables.crm_events)).not.toMatch(/Byrne|087/);
    expect(await deleteContact("gone", USER)).toBe(false);
  });
});

describe("getCompany", () => {
  it("returns its contacts and stage history, with the person's email, and hides the search keys", async () => {
    await createCompany({ name: "Ace Roofing", phone: "087 123 4567" }, USER, false);
    const id = tables.crm_companies[0].id;
    await createContact({ company_id: id, full_name: "Joe Byrne" }, USER, false);
    await changeStage(id, { stage_id: stageId("Contacted"), confirmed: false, outcome_note: null, won_value: null }, USER);

    const found = await getCompany(id);
    expect(found!.contacts.map((c) => c.full_name)).toEqual(["Joe Byrne"]);
    expect(found!.history[0].user_email).toBe("joanna@example.test");
    expect(JSON.stringify(found)).not.toMatch(/name_key|phone_key|website_domain/);
    expect(await getCompany("nope")).toBeNull();
  });
});

describe("saveStage", () => {
  it("will not switch off Won, Lost or Not Suitable, but can switch off a working stage", async () => {
    expect(await saveStage(USER, { id: stageId("Won"), active: false })).toHaveProperty("error");
    expect(await saveStage(USER, { id: stageId("Contacted"), active: false })).toHaveProperty("id");
    expect(tables.crm_stages.find((s) => s.name === "Contacted")!.active).toBe(false);
  });

  it("places a new stage before the closing ones", async () => {
    const r = await saveStage(USER, { name: "Showroom Visit Booked" });
    expect("id" in r).toBe(true);
    const created = tables.crm_stages.find((s) => s.name === "Showroom Visit Booked")!;
    expect(created.kind).toBe("open");
    expect(created.sort_order).toBeGreaterThan(4);
    expect(created.sort_order).toBeLessThan(5);
  });

  it("validates names", async () => {
    expect(await saveStage(USER, { name: "   " })).toHaveProperty("error");
    expect(await saveStage(USER, {})).toHaveProperty("error");
  });
});

describe("database trouble", () => {
  it("surfaces a failure instead of pretending a company was saved", async () => {
    fake.failTable = "crm_companies";
    await expect(createCompany({ name: "Ace" }, USER, false)).rejects.toThrow(/crm_companies unavailable/);
  });
});

describe("pipelineSummary", () => {
  it("counts each stage and keeps the estimate apart from what was won", async () => {
    await createCompany({ name: "Ace", estimated_value: 10000 }, USER, false);
    await createCompany({ name: "Beta", estimated_value: 4000 }, USER, false);
    await createCompany({ name: "Cork", estimated_value: 6000, assigned_to: "user-sajad" }, USER, false);
    const [ace, , cork] = tables.crm_companies.map((c) => c.id as string);
    await changeStage(ace, { stage_id: stageId("Won"), confirmed: true, outcome_note: null, won_value: 9000 }, USER);

    const all = await pipelineSummary({ assigned_to: null, category_id: null });
    const won = all.find((s) => s.stage_id === "stage-Won")!;
    const fresh = all.find((s) => s.stage_id === "stage-New Prospect")!;
    expect(won).toMatchObject({ count: 1, won_total: 9000, estimated_total: 10000 });
    expect(fresh).toMatchObject({ count: 2, estimated_total: 10000, won_total: 0 });

    const sajad = await pipelineSummary({ assigned_to: "user-sajad", category_id: null });
    expect(sajad).toEqual([{ stage_id: "stage-New Prospect", count: 1, estimated_total: 6000, won_total: 0 }]);
    expect(cork).toBeTruthy();
  });

  it("leaves out archived companies", async () => {
    await createCompany({ name: "Ace" }, USER, false);
    await archiveCompany(tables.crm_companies[0].id, USER);
    expect(await pipelineSummary({ assigned_to: null, category_id: null })).toEqual([]);
  });
});
