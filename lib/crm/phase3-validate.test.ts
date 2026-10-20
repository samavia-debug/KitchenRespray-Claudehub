import { describe, expect, it } from "vitest";
import { addDays, dublinToday } from "./followups";
import { cleanActivityInput, cleanOpportunityInput, cleanOpportunityStatus, cleanTaskCompletion, cleanTaskInput, cleanTaskQuery } from "./validate";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const today = dublinToday();
const tomorrow = addDays(today, 1);
const yesterday = addDays(today, -1);

const err = (r: any) => ("error" in r ? (r.error as string) : "");

describe("cleanActivityInput", () => {
  it("needs a company and a type, and only accepts the known types", () => {
    expect(err(cleanActivityInput({}))).toMatch(/company/i);
    expect(err(cleanActivityInput({ company_id: ID }))).toMatch(/what you did/i);
    expect(err(cleanActivityInput({ company_id: ID, type: "Telepathy" }))).toMatch(/choices/i);
    const r = cleanActivityInput({ company_id: ID, type: "Telephone call" });
    expect("value" in r && r.value).toEqual({ company_id: ID, type: "Telephone call" });
  });

  it("cleans the optional fields", () => {
    const r = cleanActivityInput({ company_id: ID, type: "Email sent", contact_id: ID2, outcome: "  Sent the brochure ", next_action: "Phone on Thursday", next_follow_up: tomorrow, notes: "" });
    expect("value" in r && r.value).toMatchObject({ contact_id: ID2, outcome: "Sent the brochure", next_action: "Phone on Thursday", next_follow_up: tomorrow, notes: null });
  });

  it("will not record something that has not happened yet", () => {
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    expect(err(cleanActivityInput({ company_id: ID, type: "Meeting", occurred_at: later }))).toMatch(/future/i);
    expect(err(cleanActivityInput({ company_id: ID, type: "Meeting", occurred_at: "not a date" }))).toMatch(/date/i);
    const past = cleanActivityInput({ company_id: ID, type: "Meeting", occurred_at: "2026-01-05T10:00:00Z" });
    expect("value" in past && past.value.occurred_at).toBe("2026-01-05T10:00:00.000Z");
  });

  it("will not set a follow-up for a day that has passed, but allows today", () => {
    expect(err(cleanActivityInput({ company_id: ID, type: "Meeting", next_follow_up: yesterday }))).toMatch(/past/i);
    expect("value" in cleanActivityInput({ company_id: ID, type: "Meeting", next_follow_up: today })).toBe(true);
  });

  it("limits long text", () => {
    expect(err(cleanActivityInput({ company_id: ID, type: "Meeting", outcome: "x".repeat(1001) }))).toMatch(/too long/i);
  });
});

describe("cleanTaskInput", () => {
  it("needs a company, what to do and a due date", () => {
    expect(err(cleanTaskInput({ company_id: ID, due_date: tomorrow }))).toMatch(/what the follow-up is/i);
    expect(err(cleanTaskInput({ company_id: ID, title: "Call" }))).toMatch(/due date/i);
    expect(err(cleanTaskInput({ title: "Call", due_date: tomorrow }))).toMatch(/company/i);
    const r = cleanTaskInput({ company_id: ID, title: " Call Mick ", due_date: tomorrow, assigned_to: ID2 });
    expect("value" in r && r.value).toEqual({ company_id: ID, title: "Call Mick", due_date: tomorrow, assigned_to: ID2 });
  });

  it("rejects a past due date", () => {
    expect(err(cleanTaskInput({ company_id: ID, title: "Call", due_date: yesterday }))).toMatch(/past/i);
  });

  it("lets an update change only what was sent, such as who it is assigned to", () => {
    const r = cleanTaskInput({ assigned_to: ID2 }, true);
    expect("value" in r && r.value).toEqual({ assigned_to: ID2 });
    expect(err(cleanTaskInput({ title: "" }, true))).toMatch(/follow-up/i);
  });
});

describe("cleanTaskCompletion", () => {
  it("accepts a bare completion", () => {
    const r = cleanTaskCompletion({});
    expect("value" in r && r.value).toEqual({ result: null, activity_type: null, next: null });
  });

  it("takes a result, an activity to record, and another follow-up", () => {
    const r = cleanTaskCompletion({ result: " Left a message ", activity_type: "Telephone call", next: { due_date: tomorrow, title: "Try again", assigned_to: ID } });
    expect("value" in r && r.value).toEqual({ result: "Left a message", activity_type: "Telephone call", next: { due_date: tomorrow, title: "Try again", assigned_to: ID } });
  });

  it("ignores a next follow-up with no date, and rejects a bad one", () => {
    const r = cleanTaskCompletion({ next: { title: "Try again", due_date: "" } });
    expect("value" in r && r.value.next).toBeNull();
    expect(err(cleanTaskCompletion({ next: { due_date: yesterday } }))).toMatch(/past/i);
    expect(err(cleanTaskCompletion({ activity_type: "Telepathy" }))).toMatch(/choices/i);
  });
});

describe("cleanOpportunityInput", () => {
  it("needs a company and a name", () => {
    expect(err(cleanOpportunityInput({ company_id: ID }))).toMatch(/name the opportunity/i);
    expect(err(cleanOpportunityInput({ title: "Doors" }))).toMatch(/company/i);
  });

  it("cleans the value and only accepts a known source", () => {
    const r = cleanOpportunityInput({ company_id: ID, title: " Hotel doors ", estimated_value: "€8,500", source: "Direct prospecting" });
    expect("value" in r && r.value).toEqual({ company_id: ID, title: "Hotel doors", estimated_value: 8500, source: "Direct prospecting" });
    expect(err(cleanOpportunityInput({ company_id: ID, title: "x", source: "Psychic" }))).toMatch(/choices/i);
    expect(err(cleanOpportunityInput({ company_id: ID, title: "x", estimated_value: -1 }))).toMatch(/amount/i);
  });

  it("lets an update clear the source, and ignores fields it must not take", () => {
    const r = cleanOpportunityInput({ source: "", status: "won", won_value: 99999 }, true);
    expect("value" in r && r.value).toEqual({ source: null });
  });
});

describe("cleanOpportunityStatus", () => {
  it("needs a known status and keeps the confirmation strict", () => {
    expect(err(cleanOpportunityStatus({}))).toMatch(/status/i);
    expect(err(cleanOpportunityStatus({ status: "done" }))).toMatch(/choices/i);
    const r = cleanOpportunityStatus({ status: "won", confirmed: "yes", won_value: "12,000", outcome_note: " Fitted " });
    expect("value" in r && r.value).toEqual({ status: "won", confirmed: false, won_value: 12000, outcome_note: "Fitted" });
  });
});

describe("cleanTaskQuery", () => {
  it("defaults to today and ignores anything odd", () => {
    expect(cleanTaskQuery(new URLSearchParams(""))).toMatchObject({ view: "today", assigned_to: null, page: 1, pageSize: 25 });
    expect(cleanTaskQuery(new URLSearchParams("view=everything&assigned_to=zzz&page=-1&pageSize=1000"))).toMatchObject({ view: "today", assigned_to: null, page: 1, pageSize: 25 });
  });

  it("reads real values", () => {
    expect(cleanTaskQuery(new URLSearchParams(`view=overdue&assigned_to=${ID}&page=2&pageSize=50`))).toEqual({ view: "overdue", assigned_to: ID, page: 2, pageSize: 50 });
    expect(cleanTaskQuery(new URLSearchParams("view=completed&assigned_to=none")).assigned_to).toBe("none");
  });
});
