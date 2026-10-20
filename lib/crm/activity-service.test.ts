import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, fakeFrom } from "./fake-db";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: fakeFrom }) }));
const tables = fake.tables;

import {
  cancelTask,
  companyTasks,
  completeTask,
  createOpportunity,
  createTask,
  deleteActivity,
  deleteOpportunity,
  listActivities,
  listOpportunities,
  listTasks,
  logActivity,
  setOpportunityStatus,
  updateOpportunity,
  updateTask,
} from "./activity-service";
import { cleanTaskQuery } from "./validate";

const JOANNA = "user-joanna";
const SAJAD = "user-sajad";
const CO = "co1";
const query = (qs = "") => cleanTaskQuery(new URLSearchParams(qs));
const company = () => tables.crm_companies.find((c) => c.id === CO)!;
const contact = () => tables.crm_contacts.find((c) => c.id === "ct1")!;

beforeEach(() => {
  fake.reset();
  tables.profiles = [
    { id: JOANNA, email: "joanna@example.test", role: "Staff" },
    { id: SAJAD, email: "sajad@example.test", role: "Staff" },
    { id: "user-viewer", email: "viewer@example.test", role: "Viewer" },
  ];
  tables.crm_companies = [
    { id: CO, name: "Ace Roofing", archived_at: null, last_activity_at: null, last_contacted_at: null, next_follow_up: null },
    { id: "co2", name: "Beta Builders", archived_at: null },
    { id: "co-archived", name: "Old Ltd", archived_at: "2026-01-01T00:00:00.000Z" },
  ];
  tables.crm_contacts = [
    { id: "ct1", company_id: CO, full_name: "Mick Doyle", last_contacted_at: null, next_follow_up: null },
    { id: "ct-other", company_id: "co2", full_name: "Mary Murphy" },
  ];
});

describe("logActivity", () => {
  it("records a call and moves the last-contacted markers on the company and the contact", async () => {
    const r = await logActivity({ company_id: CO, contact_id: "ct1", type: "Telephone call", outcome: "Interested in the winter work", notes: "Spoke to Mick" }, JOANNA);
    expect("id" in r && r.taskId).toBeNull();
    const a = tables.crm_activities[0];
    expect(a).toMatchObject({ company_id: CO, contact_id: "ct1", type: "Telephone call", user_id: JOANNA, created_by: JOANNA });
    expect(company()).toMatchObject({ last_activity_type: "Telephone call" });
    expect(company().last_contacted_at).toBe(a.occurred_at);
    expect(contact().last_contacted_at).toBe(a.occurred_at);
  });

  it("counts research as work but not as contact", async () => {
    await logActivity({ company_id: CO, type: "Initial research", notes: "Looked at their website" }, JOANNA);
    expect(company().last_activity_type).toBe("Initial research");
    expect(company().last_contacted_at).toBeNull();
  });

  it("does not move the markers backwards when something is entered late", async () => {
    await logActivity({ company_id: CO, type: "Telephone call", occurred_at: "2026-10-20T10:00:00.000Z" }, JOANNA);
    await logActivity({ company_id: CO, type: "Email sent", occurred_at: "2026-10-01T09:00:00.000Z" }, JOANNA);
    expect(company().last_activity_type).toBe("Telephone call");
    expect(company().last_contacted_at).toBe("2026-10-20T10:00:00.000Z");
    expect(tables.crm_activities).toHaveLength(2);
  });

  it("creates a follow-up when a date is given, owned by the person who did it, and shows it as the next follow-up", async () => {
    const r = await logActivity({ company_id: CO, contact_id: "ct1", type: "Email sent", next_action: "Phone Mick about the quote", next_follow_up: "2026-10-28", user_id: SAJAD }, JOANNA);
    expect("taskId" in r && r.taskId).toBeTruthy();
    expect(tables.crm_tasks[0]).toMatchObject({ company_id: CO, contact_id: "ct1", title: "Phone Mick about the quote", due_date: "2026-10-28", assigned_to: SAJAD, status: "open", source_activity_id: tables.crm_activities[0].id });
    expect(company().next_follow_up).toBe("2026-10-28");
    expect(contact().next_follow_up).toBe("2026-10-28");
  });

  it("gives the follow-up a plain title when no next action is written", async () => {
    await logActivity({ company_id: CO, type: "Meeting", next_follow_up: "2026-10-30" }, JOANNA);
    expect(tables.crm_tasks[0].title).toBe("Follow up");
  });

  it("refuses a contact from another company, a missing or archived company, and a person who is not on the team", async () => {
    expect(await logActivity({ company_id: CO, contact_id: "ct-other", type: "Meeting" }, JOANNA)).toMatchObject({ error: expect.stringMatching(/does not belong/) });
    expect(await logActivity({ company_id: "nope", type: "Meeting" }, JOANNA)).toEqual({ notFound: true });
    expect(await logActivity({ company_id: "co-archived", type: "Meeting" }, JOANNA)).toEqual({ notFound: true });
    expect(await logActivity({ company_id: CO, type: "Meeting", user_id: "user-viewer" }, JOANNA)).toHaveProperty("error");
    expect(tables.crm_activities ?? []).toHaveLength(0);
  });

  it("keeps what was said out of the audit trail", async () => {
    await logActivity({ company_id: CO, type: "Telephone call", outcome: "Secret outcome words", notes: "Private note words", next_action: "Next action words", next_follow_up: "2026-10-30" }, JOANNA);
    expect(JSON.stringify(tables.crm_events)).not.toMatch(/Secret|Private|Next action words/);
    expect(tables.crm_events[0]).toMatchObject({ action: "activity_logged", meta: { type: "Telephone call", follow_up_created: true } });
  });
});

describe("listActivities and deleteActivity", () => {
  it("lists newest first with the contact and who did it", async () => {
    await logActivity({ company_id: CO, contact_id: "ct1", type: "Telephone call", occurred_at: "2026-10-10T09:00:00.000Z" }, JOANNA);
    await logActivity({ company_id: CO, type: "Email sent", occurred_at: "2026-10-15T09:00:00.000Z", user_id: SAJAD }, JOANNA);
    const list = await listActivities(CO);
    expect(list.map((a) => a.type)).toEqual(["Email sent", "Telephone call"]);
    expect(list[0].user_email).toBe("sajad@example.test");
    expect(list[1].contact_name).toBe("Mick Doyle");
    expect(JSON.stringify(list)).not.toMatch(/created_by/);
  });

  it("works the last-activity markers out again when one is deleted", async () => {
    await logActivity({ company_id: CO, type: "Telephone call", occurred_at: "2026-10-10T09:00:00.000Z" }, JOANNA);
    await logActivity({ company_id: CO, type: "Initial research", occurred_at: "2026-10-18T09:00:00.000Z" }, JOANNA);
    const research = tables.crm_activities.find((a) => a.type === "Initial research")!;
    expect(await deleteActivity(research.id, JOANNA)).toBe(true);
    expect(company()).toMatchObject({ last_activity_type: "Telephone call", last_activity_at: "2026-10-10T09:00:00.000Z" });

    const call = tables.crm_activities[0];
    await deleteActivity(call.id, JOANNA);
    expect(company()).toMatchObject({ last_activity_type: null, last_activity_at: null, last_contacted_at: null });
    expect(await deleteActivity("gone", JOANNA)).toBe(false);
  });
});

describe("tasks", () => {
  it("creates a follow-up owned by whoever sets it unless told otherwise", async () => {
    const r = await createTask({ company_id: CO, title: "Send brochure", due_date: "2026-10-25" }, JOANNA);
    expect("id" in r).toBe(true);
    expect(tables.crm_tasks[0].assigned_to).toBe(JOANNA);
    expect(company().next_follow_up).toBe("2026-10-25");
  });

  it("shows the earliest open follow-up as the next one", async () => {
    await createTask({ company_id: CO, title: "Later", due_date: "2026-11-10" }, JOANNA);
    await createTask({ company_id: CO, title: "Sooner", due_date: "2026-10-26" }, JOANNA);
    expect(company().next_follow_up).toBe("2026-10-26");
    await cancelTask(tables.crm_tasks.find((t) => t.title === "Sooner")!.id, JOANNA);
    expect(company().next_follow_up).toBe("2026-11-10");
    await cancelTask(tables.crm_tasks.find((t) => t.title === "Later")!.id, JOANNA);
    expect(company().next_follow_up).toBeNull();
  });

  it("refuses an owner who is not on the team, and a contact from another company", async () => {
    expect(await createTask({ company_id: CO, title: "x", due_date: "2026-10-25", assigned_to: "user-viewer" }, JOANNA)).toHaveProperty("error");
    expect(await createTask({ company_id: CO, title: "x", due_date: "2026-10-25", contact_id: "ct-other" }, JOANNA)).toHaveProperty("error");
    expect(await createTask({ company_id: "co-archived", title: "x", due_date: "2026-10-25" }, JOANNA)).toEqual({ notFound: true });
    expect(tables.crm_tasks ?? []).toHaveLength(0);
  });

  it("can be rescheduled and reassigned, and the company's next follow-up follows", async () => {
    await createTask({ company_id: CO, title: "Call", due_date: "2026-10-25" }, JOANNA);
    const id = tables.crm_tasks[0].id;
    expect(await updateTask(id, { due_date: "2026-11-05", assigned_to: SAJAD, company_id: "co2" }, JOANNA)).toEqual({ ok: true });
    expect(tables.crm_tasks[0]).toMatchObject({ due_date: "2026-11-05", assigned_to: SAJAD, company_id: CO });
    expect(company().next_follow_up).toBe("2026-11-05");
    expect(await updateTask(id, { assigned_to: "user-viewer" }, JOANNA)).toHaveProperty("error");
  });

  it("cannot change a follow-up that is already done", async () => {
    await createTask({ company_id: CO, title: "Call", due_date: "2026-10-25" }, JOANNA);
    const id = tables.crm_tasks[0].id;
    await completeTask(id, { result: null, activity_type: null, next: null }, JOANNA);
    expect(await updateTask(id, { due_date: "2026-12-01" }, JOANNA)).toEqual({ notFound: true });
    expect(await cancelTask(id, JOANNA)).toBe(false);
  });
});

describe("completeTask", () => {
  async function task(over: Record<string, any> = {}) {
    await createTask({ company_id: CO, contact_id: "ct1", title: "Phone Mick", due_date: "2026-10-25", ...over }, JOANNA);
    return tables.crm_tasks[tables.crm_tasks.length - 1].id as string;
  }

  it("marks it done with the result, who did it and when, and clears the next follow-up", async () => {
    const id = await task();
    expect(await completeTask(id, { result: "Left a voicemail", activity_type: null, next: null }, SAJAD)).toMatchObject({ ok: true, nextTaskId: null, activityId: null });
    expect(tables.crm_tasks[0]).toMatchObject({ status: "done", result: "Left a voicemail", completed_by: SAJAD });
    expect(tables.crm_tasks[0].completed_at).toBeTruthy();
    expect(company().next_follow_up).toBeNull();
  });

  it("does not claim a call happened unless the person says so", async () => {
    const id = await task();
    await completeTask(id, { result: "Done", activity_type: null, next: null }, JOANNA);
    expect(tables.crm_activities ?? []).toHaveLength(0);
    expect(company().last_contacted_at).toBeNull();
  });

  it("records the activity when the person chooses one, which then counts as contact", async () => {
    const id = await task();
    const r = await completeTask(id, { result: "Spoke to Mick", activity_type: "Follow-up call", next: null }, JOANNA);
    expect("activityId" in r && r.activityId).toBeTruthy();
    expect(tables.crm_activities[0]).toMatchObject({ type: "Follow-up call", outcome: "Spoke to Mick", contact_id: "ct1", user_id: JOANNA });
    expect(company().last_contacted_at).toBeTruthy();
  });

  it("sets the next follow-up in the same step, keeping the contact and owner", async () => {
    const id = await task({ assigned_to: SAJAD });
    const r = await completeTask(id, { result: "Asked to ring back", activity_type: null, next: { due_date: "2026-11-02", title: null, assigned_to: null } }, JOANNA);
    expect("nextTaskId" in r && r.nextTaskId).toBeTruthy();
    const next = tables.crm_tasks.find((t) => t.status === "open")!;
    expect(next).toMatchObject({ title: "Phone Mick", due_date: "2026-11-02", assigned_to: SAJAD, contact_id: "ct1" });
    expect(company().next_follow_up).toBe("2026-11-02");
  });

  it("can only be completed once", async () => {
    const id = await task();
    await completeTask(id, { result: null, activity_type: null, next: null }, JOANNA);
    expect(await completeTask(id, { result: "again", activity_type: null, next: null }, SAJAD)).toEqual({ notFound: true });
    expect(tables.crm_tasks[0].completed_by).toBe(JOANNA);
    expect(await completeTask("gone", { result: null, activity_type: null, next: null }, JOANNA)).toEqual({ notFound: true });
  });
});

describe("listTasks", () => {
  const TODAY = "2026-10-21"; // a Wednesday

  async function seed() {
    const mk = (title: string, due: string, who = JOANNA, companyId = CO) => createTask({ company_id: companyId, title, due_date: due, assigned_to: who, contact_id: companyId === CO ? "ct1" : undefined }, JOANNA);
    await mk("overdue-old", "2026-10-01");
    await mk("overdue-yesterday", "2026-10-20", SAJAD);
    await mk("today-a", "2026-10-21");
    await mk("this-week", "2026-10-24");
    await mk("sunday", "2026-10-25");
    await mk("upcoming", "2026-10-26");
    await mk("far-away", "2027-01-15");
    await mk("archived-company", "2026-10-21", JOANNA, "co-archived").catch(() => undefined);
    await mk("finished", "2026-10-15");
    await completeTask(tables.crm_tasks.find((t) => t.title === "finished")!.id, { result: "Sent it", activity_type: null, next: null }, JOANNA);
  }

  const titles = async (qs: string) => (await listTasks(query(qs), TODAY)).tasks.map((t) => t.title);

  it("puts every open follow-up in exactly one list", async () => {
    await seed();
    expect(await titles("view=overdue")).toEqual(["overdue-old", "overdue-yesterday"]);
    expect(await titles("view=today")).toEqual(["today-a"]);
    expect(await titles("view=week")).toEqual(["this-week", "sunday"]);
    expect(await titles("view=upcoming")).toEqual(["upcoming", "far-away"]);
    expect(await titles("view=completed")).toEqual(["finished"]);
  });

  it("counts each list, and the counts follow the person filter", async () => {
    await seed();
    expect((await listTasks(query(), TODAY)).counts).toEqual({ overdue: 2, today: 1, week: 2, upcoming: 2, completed: 1 });
    expect((await listTasks({ ...query(), assigned_to: SAJAD }, TODAY)).counts).toEqual({ overdue: 1, today: 0, week: 0, upcoming: 0, completed: 0 });
  });

  it("filters by assigned person (ids only, so an odd value is ignored rather than injected)", async () => {
    await seed();
    expect(await titles("view=overdue&assigned_to=none")).toEqual([]);
    expect((await listTasks(query("view=overdue&assigned_to=not-a-uuid"), TODAY)).total).toBe(2);
  });

  it("shows the company, contact, owner and last activity for each", async () => {
    await seed();
    await logActivity({ company_id: CO, type: "Meeting", occurred_at: "2026-10-12T09:00:00.000Z" }, JOANNA);
    const [first] = (await listTasks(query("view=overdue"), TODAY)).tasks;
    expect(first).toMatchObject({ company_name: "Ace Roofing", contact_name: "Mick Doyle", assignee_email: "joanna@example.test", last_activity_type: "Meeting", last_activity_at: "2026-10-12T09:00:00.000Z" });
  });

  it("pages the results", async () => {
    await seed();
    const page = await listTasks({ ...query("view=upcoming"), pageSize: 1, page: 2 }, TODAY);
    expect(page.tasks.map((t) => t.title)).toEqual(["far-away"]);
    expect(page.total).toBe(2);
  });

  it("never lists a follow-up of an archived company", async () => {
    await createTask({ company_id: "co-archived", title: "ghost", due_date: TODAY }, JOANNA).catch(() => undefined);
    (tables.crm_tasks ||= []).push({ id: "ghost", company_id: "co-archived", title: "ghost", due_date: TODAY, status: "open", assigned_to: JOANNA });
    expect(await titles("view=today")).not.toContain("ghost");
  });

  it("shows one company's open and recently done follow-ups", async () => {
    await seed();
    const { open, done } = await companyTasks(CO);
    expect(open.map((t) => t.title)).toEqual(["overdue-old", "overdue-yesterday", "today-a", "this-week", "sunday", "upcoming", "far-away"]);
    expect(done.map((t) => t.title)).toEqual(["finished"]);
  });
});

describe("opportunities", () => {
  async function opp(over: Record<string, any> = {}) {
    const r = await createOpportunity({ company_id: CO, title: "Hotel bedroom doors", estimated_value: 8000, source: "Direct prospecting", ...over }, JOANNA);
    return "id" in r ? r.id : "";
  }
  const stored = () => tables.crm_opportunities[0];

  it("starts as identified, and a company can have several", async () => {
    await opp();
    await opp({ title: "Reception desk" });
    expect(tables.crm_opportunities).toHaveLength(2);
    expect(stored()).toMatchObject({ status: "identified", estimated_value: 8000, source: "Direct prospecting" });
    expect(stored().won_value ?? null).toBeNull();
    expect((await listOpportunities(CO)).map((o) => o.title).sort()).toEqual(["Hotel bedroom doors", "Reception desk"]);
  });

  it("refuses a missing company and an assignee who is not on the team", async () => {
    expect(await createOpportunity({ company_id: "nope", title: "x" }, JOANNA)).toEqual({ notFound: true });
    expect(await createOpportunity({ company_id: CO, title: "x", assigned_to: "user-viewer" }, JOANNA)).toHaveProperty("error");
  });

  it("will not close without confirmation, and records the value only against a win", async () => {
    const id = await opp();
    expect(await setOpportunityStatus(id, { status: "won", confirmed: false, outcome_note: null, won_value: 9000 }, JOANNA)).toMatchObject({ status: 400 });
    expect(stored().status).toBe("identified");

    await setOpportunityStatus(id, { status: "quote_sent", confirmed: false, outcome_note: "ignored", won_value: 5 }, JOANNA);
    expect(stored()).toMatchObject({ status: "quote_sent", won_value: null, outcome_note: null });

    await setOpportunityStatus(id, { status: "won", confirmed: true, outcome_note: "Fitted in November", won_value: 9250 }, JOANNA);
    expect(stored()).toMatchObject({ status: "won", won_value: 9250, estimated_value: 8000, outcome_note: "Fitted in November" });

    await setOpportunityStatus(id, { status: "lost", confirmed: true, outcome_note: "Changed supplier", won_value: 99 }, JOANNA);
    expect(stored()).toMatchObject({ status: "lost", won_value: null, outcome_note: "Changed supplier" });

    await setOpportunityStatus(id, { status: "identified", confirmed: false, outcome_note: null, won_value: null }, JOANNA);
    expect(stored()).toMatchObject({ status: "identified", won_value: null, outcome_note: null });
  });

  it("rejects the same status and an unknown opportunity", async () => {
    const id = await opp();
    expect(await setOpportunityStatus(id, { status: "identified", confirmed: false, outcome_note: null, won_value: null }, JOANNA)).toMatchObject({ status: 400 });
    expect(await setOpportunityStatus("gone", { status: "won", confirmed: true, outcome_note: null, won_value: null }, JOANNA)).toEqual({ notFound: true });
  });

  it("detects a conflicting edit and never moves an opportunity to another company", async () => {
    const id = await opp();
    const stale = stored().updated_at;
    expect(await updateOpportunity(id, { title: "Renamed", company_id: "co2" }, stale, JOANNA)).toEqual({ ok: true });
    expect(stored()).toMatchObject({ title: "Renamed", company_id: CO });
    expect(await updateOpportunity(id, { title: "From an old screen" }, stale, SAJAD)).toEqual({ conflict: true });
    expect(stored().title).toBe("Renamed");
  });

  it("deletes, leaving only a note that it happened", async () => {
    const id = await opp();
    expect(await deleteOpportunity(id, JOANNA)).toBe(true);
    expect(tables.crm_opportunities).toHaveLength(0);
    expect(JSON.stringify(tables.crm_events)).not.toMatch(/Hotel bedroom/);
    expect(await deleteOpportunity("gone", JOANNA)).toBe(false);
  });
});

describe("database trouble", () => {
  it("shows a failure instead of pretending an activity was saved", async () => {
    fake.failTable = "crm_activities";
    await expect(logActivity({ company_id: CO, type: "Meeting" }, JOANNA)).rejects.toThrow(/crm_activities unavailable/);
  });
});
