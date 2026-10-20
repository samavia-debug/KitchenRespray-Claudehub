import { beforeEach, describe, expect, it, vi } from "vitest";

// The thirteen workflows the Trade Sales CRM brief says must work, run the way a person uses them: through the same
// routes the screens call, as Joanna (Staff) and Philip (Manager), against an in-memory database. The brief's thirteenth
// item also covers empty states, invalid input and database errors. (The layouts were checked separately in a browser.)

const state = vi.hoisted(() => ({ user: null as null | { id: string; email: string }, profile: null as null | { id: string; email: string; role: string } }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: state.profile }) }) }) }),
  }),
}));

import { fake, fakeFrom } from "./fake-db";
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: fakeFrom }) }));
vi.mock("@/lib/ai/anthropic", () => ({ askClaude: async () => ({ error: "no AI in tests" }), CLAUDE_MODEL: "test" }));

import { addDays, dublinToday } from "./followups";
import * as companiesRoute from "../../app/api/crm/companies/route";
import * as companyRoute from "../../app/api/crm/companies/[id]/route";
import * as stageRoute from "../../app/api/crm/companies/[id]/stage/route";
import * as contactsRoute from "../../app/api/crm/contacts/route";
import * as activitiesRoute from "../../app/api/crm/activities/route";
import * as tasksRoute from "../../app/api/crm/tasks/route";
import * as completeRoute from "../../app/api/crm/tasks/[id]/complete/route";
import * as opportunitiesRoute from "../../app/api/crm/opportunities/route";
import * as opportunityStatusRoute from "../../app/api/crm/opportunities/[id]/status/route";
import * as previewRoute from "../../app/api/crm/import/preview/route";
import * as commitRoute from "../../app/api/crm/import/commit/route";
import * as batchesRoute from "../../app/api/crm/import/batches/route";
import * as undoRoute from "../../app/api/crm/import/batches/[id]/undo/route";
import * as exportRoute from "../../app/api/crm/export/route";
import * as reportRoute from "../../app/api/crm/report/route";
import * as pipelineRoute from "../../app/api/crm/pipeline/route";

const tables = fake.tables;
const JOANNA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SAJAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHILIP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const S_NEW = "10000000-0000-4000-8000-000000000001";
const S_CONTACTED = "10000000-0000-4000-8000-000000000002";
const S_WON = "10000000-0000-4000-8000-000000000003";
const S_LOST = "10000000-0000-4000-8000-000000000004";
const CAT_BUILDERS = "20000000-0000-4000-8000-000000000001";
const CAT_HOTELS = "20000000-0000-4000-8000-000000000002";

const as = (who: "joanna" | "sajad" | "philip") => {
  const ids = { joanna: [JOANNA, "Staff"], sajad: [SAJAD, "Staff"], philip: [PHILIP, "Manager"] } as const;
  const [id, role] = ids[who];
  state.user = { id, email: `${who}@example.test` };
  state.profile = { id, email: `${who}@example.test`, role };
};

const req = (path: string, method = "GET", body?: unknown) =>
  new Request(`http://localhost/api/crm/${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });
const json = async (res: Response) => (await res.json()) as any;
const ctx = (id: string) => ({ params: { id } });

async function newCompany(body: Record<string, unknown>): Promise<string> {
  const res = await companiesRoute.POST(req("companies", "POST", body));
  const out = await json(res);
  expect(res.status, JSON.stringify(out)).toBe(200);
  return out.id;
}

const today = () => dublinToday();

beforeEach(() => {
  fake.reset();
  fake.uuidIds = true;
  as("joanna");
  tables.profiles = [
    { id: JOANNA, email: "joanna@example.test", role: "Staff" },
    { id: SAJAD, email: "sajad@example.test", role: "Staff" },
    { id: PHILIP, email: "philip@example.test", role: "Manager" },
  ];
  tables.crm_stages = [
    { id: S_NEW, name: "New Prospect", kind: "open", sort_order: "1.00", active: true },
    { id: S_CONTACTED, name: "Contacted", kind: "open", sort_order: "2.00", active: true },
    { id: S_WON, name: "Won", kind: "won", sort_order: "8.00", active: true },
    { id: S_LOST, name: "Lost", kind: "lost", sort_order: "9.00", active: true },
  ];
  tables.crm_categories = [
    { id: CAT_BUILDERS, name: "Builders", sort_order: 1, active: true },
    { id: CAT_HOTELS, name: "Hotels", sort_order: 2, active: true },
  ];
});

describe("1. Create a company and add multiple contacts", () => {
  it("saves the company and keeps every contact against it", async () => {
    const id = await newCompany({ name: "Ace Roofing Ltd", city: "Carlow", phone: "01 555 0100", email: "info@aceroofing.ie", category_id: CAT_BUILDERS });
    for (const [name, email] of [["Joe Byrne", "joe@aceroofing.ie"], ["Mary Kelly", "mary@aceroofing.ie"]]) {
      const res = await contactsRoute.POST(req("contacts", "POST", { company_id: id, full_name: name, email }));
      expect(res.status).toBe(200);
    }
    const detail = await json(await companyRoute.GET(req(`companies/${id}`), ctx(id)));
    expect(detail.company.name).toBe("Ace Roofing Ltd");
    expect(detail.contacts.map((c: any) => c.full_name).sort()).toEqual(["Joe Byrne", "Mary Kelly"]);
  });

  it("refuses to save a company with no name, and says why", async () => {
    const res = await companiesRoute.POST(req("companies", "POST", { city: "Carlow" }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/name/i);
    expect(tables.crm_companies ?? []).toHaveLength(0);
  });
});

describe("2. Search and filter companies", () => {
  beforeEach(async () => {
    await newCompany({ name: "Ace Roofing Ltd", city: "Carlow", category_id: CAT_BUILDERS, priority: "High" });
    await newCompany({ name: "Riverside Hotel", city: "Kilkenny", category_id: CAT_HOTELS });
    await newCompany({ name: "Murphy Builders", city: "Carlow", category_id: CAT_BUILDERS });
  });
  const list = async (qs: string) => json(await companiesRoute.GET(req(`companies?${qs}`)));

  it("finds by name, by town, by category and by priority, alone and together", async () => {
    expect((await list("q=riverside")).companies.map((c: any) => c.name)).toEqual(["Riverside Hotel"]);
    expect((await list("location=carlow")).total).toBe(2);
    expect((await list(`category_id=${CAT_HOTELS}`)).total).toBe(1);
    expect((await list("priority=High")).companies.map((c: any) => c.name)).toEqual(["Ace Roofing Ltd"]);
    expect((await list(`location=carlow&category_id=${CAT_BUILDERS}&q=murphy`)).companies.map((c: any) => c.name)).toEqual(["Murphy Builders"]);
  });

  it("shows an empty list, not an error, when nothing matches", async () => {
    const out = await list("q=nothing-like-this");
    expect(out.companies).toEqual([]);
    expect(out.total).toBe(0);
  });
});

describe("3. Assign a prospect to Joanna or Sajad", () => {
  it("records the owner, can hand it to the other person, and can list what each owns", async () => {
    const id = await newCompany({ name: "Ace Roofing Ltd" });
    const first = await companyRoute.PATCH(req(`companies/${id}`, "PATCH", { assigned_to: JOANNA }), ctx(id));
    expect(first.status).toBe(200);
    const stamp = (await json(first)).company.updated_at;
    const second = await companyRoute.PATCH(req(`companies/${id}`, "PATCH", { assigned_to: SAJAD, expectedUpdatedAt: stamp }), ctx(id));
    expect(second.status).toBe(200);

    expect((await json(await companiesRoute.GET(req(`companies?assigned_to=${SAJAD}`)))).total).toBe(1);
    expect((await json(await companiesRoute.GET(req(`companies?assigned_to=${JOANNA}`)))).total).toBe(0);
    expect((await json(await companiesRoute.GET(req("companies?assigned_to=none")))).total).toBe(0);
  });
});

describe("4. Log a call or an email", () => {
  it("adds it to the company's history and moves 'last contacted'", async () => {
    const id = await newCompany({ name: "Ace Roofing Ltd" });
    const res = await activitiesRoute.POST(req("activities", "POST", { company_id: id, type: "Telephone call", outcome: "Spoke to the owner", notes: "Wants a price for the yard doors" }));
    expect(res.status).toBe(200);
    const history = (await json(await activitiesRoute.GET(req(`activities?company_id=${id}`)))).activities;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ type: "Telephone call", outcome: "Spoke to the owner" });
    expect((await json(await companyRoute.GET(req(`companies/${id}`), ctx(id)))).company.last_contacted_at).toBeTruthy();
  });

  it("refuses an activity without a type or for a company that does not exist", async () => {
    const id = await newCompany({ name: "Ace Roofing Ltd" });
    expect((await activitiesRoute.POST(req("activities", "POST", { company_id: id }))).status).toBe(400);
    expect((await activitiesRoute.POST(req("activities", "POST", { company_id: "99999999-9999-4999-8999-999999999999", type: "Meeting" }))).status).toBe(404);
  });
});

describe("5. Schedule and complete a follow-up", () => {
  it("shows it as due, completes it, records what happened and books the next one", async () => {
    const id = await newCompany({ name: "Ace Roofing Ltd" });
    const due = addDays(today(), 3);
    const made = await json(await tasksRoute.POST(req("tasks", "POST", { company_id: id, title: "Ring about the quote", due_date: due, assigned_to: JOANNA })));
    expect(made.id).toBeTruthy();
    expect((await json(await tasksRoute.GET(req(`tasks?company_id=${id}`)))).open).toHaveLength(1);
    expect((await json(await companyRoute.GET(req(`companies/${id}`), ctx(id)))).company.next_follow_up).toBe(due);

    const next = addDays(today(), 10);
    const done = await completeRoute.POST(req(`tasks/${made.id}/complete`, "POST", { result: "Left a message", activity_type: "Telephone call", next: { due_date: next, title: "Try again" } }), ctx(made.id));
    expect(done.status).toBe(200);
    const after = await json(await tasksRoute.GET(req(`tasks?company_id=${id}`)));
    expect(after.open.map((t: any) => t.due_date)).toEqual([next]);
    expect(after.done).toHaveLength(1);
    expect((await json(await companyRoute.GET(req(`companies/${id}`), ctx(id)))).company.next_follow_up).toBe(next);
    expect((await json(await activitiesRoute.GET(req(`activities?company_id=${id}`)))).activities).toHaveLength(1);

    // Completing it twice does not record it twice.
    expect((await completeRoute.POST(req(`tasks/${made.id}/complete`, "POST", {}), ctx(made.id))).status).toBe(404);
  });

  it("will not set a follow-up for a day that has already gone", async () => {
    const id = await newCompany({ name: "Ace Roofing Ltd" });
    const res = await tasksRoute.POST(req("tasks", "POST", { company_id: id, title: "Ring", due_date: addDays(today(), -3) }));
    expect(res.status).toBe(400);
  });
});

describe("6. Move a prospect through the sales pipeline", () => {
  it("moves it between stages, keeps the history, and the board counts follow", async () => {
    const id = await newCompany({ name: "Ace Roofing Ltd", category_id: CAT_BUILDERS });
    const moved = await stageRoute.POST(req(`companies/${id}/stage`, "POST", { stage_id: S_CONTACTED }), ctx(id));
    expect(moved.status).toBe(200);
    const detail = await json(await companyRoute.GET(req(`companies/${id}`), ctx(id)));
    expect(detail.company.stage_id).toBe(S_CONTACTED);
    expect(detail.history.length).toBeGreaterThanOrEqual(1);

    const board = await json(await pipelineRoute.GET(req("pipeline")));
    const counts = Object.fromEntries(board.stages.map((s: any) => [s.stage_id, s.count]));
    expect(counts[S_CONTACTED]).toBe(1);
    expect(counts[S_NEW] ?? 0).toBe(0);
  });

  it("makes a person confirm Won or Lost before it is recorded", async () => {
    const id = await newCompany({ name: "Ace Roofing Ltd" });
    const unconfirmed = await stageRoute.POST(req(`companies/${id}/stage`, "POST", { stage_id: S_LOST }), ctx(id));
    expect(unconfirmed.status).toBeGreaterThanOrEqual(400);
    expect((await json(await companyRoute.GET(req(`companies/${id}`), ctx(id)))).company.stage_id).not.toBe(S_LOST);
    const confirmed = await stageRoute.POST(req(`companies/${id}/stage`, "POST", { stage_id: S_LOST, confirmed: true, outcome_note: "Went with another firm" }), ctx(id));
    expect(confirmed.status).toBe(200);
  });
});

describe("7. Create and close a sales opportunity", () => {
  it("opens an opportunity, moves it along, and counts a win once, at the value recorded", async () => {
    const id = await newCompany({ name: "Ace Roofing Ltd", category_id: CAT_BUILDERS });
    const made = await json(await opportunitiesRoute.POST(req("opportunities", "POST", { company_id: id, title: "Yard doors", estimated_value: 4000, source: "Direct prospecting", assigned_to: JOANNA })));
    expect(made.id).toBeTruthy();
    expect((await opportunityStatusRoute.POST(req(`opportunities/${made.id}/status`, "POST", { status: "quote_sent" }), ctx(made.id))).status).toBe(200);

    const unconfirmed = await opportunityStatusRoute.POST(req(`opportunities/${made.id}/status`, "POST", { status: "won", won_value: 3800 }), ctx(made.id));
    expect(unconfirmed.status).toBeGreaterThanOrEqual(400);
    const won = await opportunityStatusRoute.POST(req(`opportunities/${made.id}/status`, "POST", { status: "won", confirmed: true, won_value: 3800 }), ctx(made.id));
    expect(won.status).toBe(200);

    const list = (await json(await opportunitiesRoute.GET(req(`opportunities?company_id=${id}`)))).opportunities;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "won" });

    as("philip");
    const report = await json(await reportRoute.GET(req("report?range=this_month")));
    expect(report.sales.confirmedValue).toBe(3800);
    expect(report.sales.wonCount).toBe(1);
  });
});

describe("8. Import the existing spreadsheet and review duplicates", () => {
  const HEADERS = ["Company", "Website", "Email", "Phone", "City"];
  const TARGETS = ["name", "website", "email", "phone", "city"];
  const body = (rows: string[][], over: Record<string, unknown> = {}) => ({
    filename: "carpentry.xlsx", headers: HEADERS, rows, targets: TARGETS,
    defaults: { category_id: CAT_BUILDERS, source: "Carpentry list", assigned_to: null, priority: null }, decisions: {}, confirmed: true, ...over,
  });

  it("shows what would happen without saving, flags the duplicate, and then imports only what was approved", async () => {
    await newCompany({ name: "Ace Roofing Ltd", website: "https://aceroofing.ie" });
    const rows = [
      ["Ace Roofing Limited", "aceroofing.ie", "", "", "Carlow"], // already there
      ["Murphy Joinery", "murphyjoinery.ie", "info@murphyjoinery.ie", "087 123 4567", "Kilkenny"],
      ["Walsh Timber Frames", "", "", "", "Athy"],
    ];
    const preview = await json(await previewRoute.POST(req("import/preview", "POST", body(rows, { confirmed: false }))));
    expect(preview.counts).toBeTruthy();
    expect(tables.crm_companies).toHaveLength(1); // nothing saved by a preview
    expect(JSON.stringify(preview.plan)).toMatch(/duplicate|already/i);

    const res = await commitRoute.POST(req("import/commit", "POST", body(rows)));
    const out = await json(res);
    expect(res.status, JSON.stringify(out)).toBe(200);
    expect(out.imported).toBe(2);
    expect(out.skippedCount).toBe(1);
    expect(tables.crm_companies.map((c: any) => c.name).sort()).toEqual(["Ace Roofing Ltd", "Murphy Joinery", "Walsh Timber Frames"]);
    expect(tables.crm_companies.find((c: any) => c.name === "Murphy Joinery")).toMatchObject({ category_id: CAT_BUILDERS, source: "Carpentry list" });

    // Importing the same file again adds nothing.
    const again = await json(await commitRoute.POST(req("import/commit", "POST", body(rows))));
    expect(again.imported).toBe(0);
    expect(tables.crm_companies).toHaveLength(3);
  });

  it("does nothing at all unless the person confirmed", async () => {
    const res = await commitRoute.POST(req("import/commit", "POST", body([["Murphy Joinery", "", "", "", ""]], { confirmed: false })));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(tables.crm_companies ?? []).toHaveLength(0);
  });

  it("can take back an import nobody has worked on yet", async () => {
    const out = await json(await commitRoute.POST(req("import/commit", "POST", body([["Murphy Joinery", "", "", "", ""]]))));
    expect(out.imported).toBe(1);
    expect((await json(await batchesRoute.GET())).batches ?? []).not.toHaveLength(0);
    as("philip");
    const undone = await undoRoute.POST(req(`import/batches/${out.batchId}/undo`, "POST", {}), ctx(out.batchId));
    expect(undone.status).toBe(200);
    expect(tables.crm_companies).toHaveLength(0);
  });

  it("rejects a file whose rows do not match its columns", async () => {
    const res = await previewRoute.POST(req("import/preview", "POST", body([["only one cell"]])));
    expect(res.status).toBe(400);
  });
});

describe("9. Export filtered records", () => {
  beforeEach(async () => {
    await newCompany({ name: "Ace Roofing Ltd", city: "Carlow", category_id: CAT_BUILDERS });
    await newCompany({ name: "Riverside Hotel", city: "Kilkenny", category_id: CAT_HOTELS });
  });

  it("exports exactly the filtered companies for a Manager, and records that it happened", async () => {
    as("philip");
    const res = await exportRoute.POST(req("export", "POST", { type: "companies", format: "csv", qs: `category_id=${CAT_HOTELS}` }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Riverside Hotel");
    expect(text).not.toContain("Ace Roofing Ltd");
    expect(res.headers.get("X-Row-Count")).toBe("1");
    expect(tables.crm_events.some((e: any) => /export/i.test(e.action))).toBe(true);
  });

  it("is not available to Staff", async () => {
    expect((await exportRoute.POST(req("export", "POST", { type: "companies", format: "csv" }))).status).toBe(403);
  });
});

describe("10. Activity and sales reports are accurate", () => {
  it("counts what was actually recorded, and nothing else", async () => {
    const a = await newCompany({ name: "Ace Roofing Ltd", category_id: CAT_BUILDERS, assigned_to: JOANNA });
    const b = await newCompany({ name: "Murphy Builders", category_id: CAT_BUILDERS, assigned_to: SAJAD });
    await activitiesRoute.POST(req("activities", "POST", { company_id: a, type: "Telephone call", user_id: JOANNA }));
    await activitiesRoute.POST(req("activities", "POST", { company_id: a, type: "Email sent", user_id: JOANNA }));
    await activitiesRoute.POST(req("activities", "POST", { company_id: b, type: "Telephone call", user_id: SAJAD }));
    const opp = await json(await opportunitiesRoute.POST(req("opportunities", "POST", { company_id: b, title: "Kitchen units", estimated_value: 9000, source: "Referral" })));
    await opportunityStatusRoute.POST(req(`opportunities/${opp.id}/status`, "POST", { status: "won", confirmed: true, won_value: 8200 }), ctx(opp.id));

    as("philip");
    const report = await json(await reportRoute.GET(req("report?range=this_month")));
    const calls = report.activityByType.find((t: any) => t.type === "Telephone call")?.count;
    expect(calls).toBe(2);
    expect(report.activityByType.find((t: any) => t.type === "Email sent")?.count).toBe(1);
    expect(report.sales.confirmedValue).toBe(8200);
    expect(report.sales.openEstimate.value).toBe(0); // the only opportunity is won, so no open estimate remains
    expect(report.byStaff.length).toBeGreaterThan(0);

    // Staff see the same figures, but not the comparison between people.
    as("joanna");
    const staffView = await json(await reportRoute.GET(req("report?range=this_month")));
    expect(staffView.sales.confirmedValue).toBe(8200);
    expect(staffView.byStaff).toEqual([]);
  });

  it("is clear, not broken, when there is no data yet", async () => {
    as("philip");
    const res = await reportRoute.GET(req("report?range=this_week"));
    expect(res.status).toBe(200);
    const report = await json(res);
    expect(report.sales.confirmedValue).toBe(0);
    expect(report.sales.wonCount).toBe(0);
  });
});

describe("11. User permissions work", () => {
  it("is proven route by route in permissions.test.ts; here, the one that matters most day to day", async () => {
    const id = await newCompany({ name: "Ace Roofing Ltd" });
    as("sajad");
    expect((await companyRoute.DELETE(req(`companies/${id}`, "DELETE"), ctx(id))).status).toBe(403);
    expect((await exportRoute.POST(req("export", "POST", { type: "companies" }))).status).toBe(403);
    state.user = { id: SAJAD, email: "sajad@example.test" };
    state.profile = { id: SAJAD, email: "sajad@example.test", role: "Viewer" };
    expect((await companiesRoute.GET(req("companies"))).status).toBe(403);
    state.user = null;
    expect((await companiesRoute.GET(req("companies"))).status).toBe(401);
  });
});

describe("12. The rest of the dashboard is untouched", () => {
  it("changed nothing outside the CRM except the sidebar link, shared styles and one exported helper", async () => {
    const { execFileSync } = await import("child_process");
    let out: string[];
    try {
      out = execFileSync("git", ["diff", "--name-only", "e6716cf", "--", ".", ":!lib/crm", ":!app/api/crm", ":!app/dashboard/crm", ":!supabase/migrations", ":!README.md"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
        .split("\n").filter(Boolean).sort();
    } catch {
      return; // no git history here (for example a shallow copy), so there is nothing to compare against
    }
    // Anything else changed since the CRM began is a change to a module the brief said not to touch (later, deliberate work adds to the list).
    expect(out.filter((f) => ![".gitignore", "app/dashboard/sidebar-nav.tsx", "app/globals.css", "lib/letters/prompt.ts"].includes(f))).toEqual([]);
  });
});

describe("13. Empty states, invalid input and database errors", () => {
  it("answers an empty CRM with empty lists", async () => {
    expect((await json(await companiesRoute.GET(req("companies")))).companies).toEqual([]);
    expect((await json(await contactsRoute.GET(req("contacts")))).contacts).toEqual([]);
    expect((await json(await tasksRoute.GET(req("tasks?view=overdue")))).tasks).toEqual([]);
  });

  it("rejects malformed input with a message and saves nothing", async () => {
    for (const body of [null, [], "text", { name: 42 }, { name: "x".repeat(500) }]) {
      const res = await companiesRoute.POST(new Request("http://localhost/api/crm/companies", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
      expect(res.status).toBe(400);
    }
    const res = await companiesRoute.POST(new Request("http://localhost/api/crm/companies", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
    expect(tables.crm_companies ?? []).toHaveLength(0);
  });

  it("treats a bad id as not found", async () => {
    expect((await companyRoute.GET(req("companies/not-a-uuid"), ctx("not-a-uuid"))).status).toBe(404);
  });

  it("turns a database failure into a plain message, without the database's own wording", async () => {
    fake.failTable = "crm_companies";
    const res = await companiesRoute.GET(req("companies"));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await json(res));
    expect(text).not.toMatch(/crm_companies|unavailable/);
    expect(text).toMatch(/could not/i);
  });
});
