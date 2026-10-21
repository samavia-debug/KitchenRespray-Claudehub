import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Who may do what in the Trade Sales CRM, checked against the real route handlers rather than against a list: every route
// is called as a signed-out visitor, a Viewer, Staff, a Manager and an Admin, and must answer the way the rules say.

const state = vi.hoisted(() => ({ user: null as null | { id: string; email: string }, profile: null as null | { id: string; email: string; role: string } }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: state.profile }) }) }) }),
  }),
}));

import { fake, fakeFrom } from "./fake-db";
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: fakeFrom }) }));
// No test may reach the real AI service.
vi.mock("@/lib/ai/anthropic", () => ({ askClaude: async () => ({ error: "no AI in tests" }), CLAUDE_MODEL: "test" }));

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

// @ts-ignore import.meta.glob is provided by the test runner
const modules = import.meta.glob("../../app/api/crm/**/route.ts", { eager: true }) as Record<string, Record<string, (req: Request, ctx: any) => Promise<Response>>>;
const handlerFor = (route: string, method: string) => {
  const found = modules[`../../app/api/crm/${route}/route.ts`];
  if (!found) throw new Error(`no route file for ${route}`);
  return found[method];
};

type Need = "access" | "overseer" | "admin";
type Case = { route: string; method: string; need: Need; url?: string; body?: unknown; params?: Record<string, string> };

// Staff (Joanna, Sajad) work in the CRM; Manager (Philip) oversees it; Admin manages it; Viewers have no access.
const CASES: Case[] = [
  { route: "meta", method: "GET", need: "access" },
  { route: "companies", method: "GET", need: "access" },
  { route: "companies", method: "POST", need: "access", body: {} },
  { route: "companies/[id]", method: "GET", need: "access", params: { id: ID } },
  { route: "companies/[id]", method: "PATCH", need: "access", params: { id: ID }, body: { notes: "x" } },
  { route: "companies/[id]", method: "DELETE", need: "overseer", params: { id: ID } }, // archive
  { route: "companies/[id]", method: "DELETE", need: "admin", params: { id: ID }, url: `?permanent=true` }, // erase for good
  { route: "companies/[id]/stage", method: "POST", need: "access", params: { id: ID }, body: {} },
  { route: "companies/bulk", method: "POST", need: "access", body: {} },
  { route: "contacts", method: "GET", need: "access" },
  { route: "contacts", method: "POST", need: "access", body: {} },
  { route: "contacts/[id]", method: "PATCH", need: "access", params: { id: ID }, body: { notes: "x" } },
  { route: "contacts/[id]", method: "DELETE", need: "overseer", params: { id: ID } },
  { route: "settings", method: "POST", need: "admin", body: {} },
  { route: "pipeline", method: "GET", need: "access" },
  { route: "activities", method: "GET", need: "access", url: `?company_id=${ID}` },
  { route: "activities", method: "POST", need: "access", body: {} },
  { route: "activities/bulk", method: "POST", need: "access", body: {} },
  { route: "activities/[id]", method: "DELETE", need: "overseer", params: { id: ID } },
  { route: "tasks", method: "GET", need: "access" },
  { route: "tasks", method: "POST", need: "access", body: {} },
  { route: "tasks/[id]", method: "PATCH", need: "access", params: { id: ID }, body: { title: "x" } },
  { route: "tasks/[id]", method: "DELETE", need: "access", params: { id: ID } },
  { route: "tasks/[id]/complete", method: "POST", need: "access", params: { id: ID }, body: {} },
  { route: "opportunities", method: "GET", need: "access", url: `?company_id=${ID}` },
  { route: "opportunities", method: "POST", need: "access", body: {} },
  { route: "opportunities/[id]", method: "PATCH", need: "access", params: { id: ID }, body: { title: "x" } },
  { route: "opportunities/[id]", method: "DELETE", need: "overseer", params: { id: ID } },
  { route: "opportunities/[id]/status", method: "POST", need: "access", params: { id: ID }, body: {} },
  { route: "import/parse", method: "POST", need: "access" },
  { route: "import/preview", method: "POST", need: "access", body: {} },
  { route: "import/commit", method: "POST", need: "access", body: {} },
  { route: "import/batches", method: "GET", need: "access" },
  { route: "import/batches/[id]/undo", method: "POST", need: "overseer", params: { id: ID } },
  { route: "export", method: "POST", need: "overseer", body: { type: "companies", ids: [ID2] } },
  { route: "report", method: "GET", need: "access" },
  { route: "ai/ask", method: "POST", need: "access", body: {} },
  { route: "ai/next-step", method: "POST", need: "access", body: {} },
  { route: "ai/draft", method: "POST", need: "access", body: {} },
  { route: "ai/research", method: "POST", need: "access", body: {} },
  { route: "ai/settings", method: "GET", need: "admin" },
  { route: "ai/settings", method: "PUT", need: "admin", body: {} },
];

const ROLES = ["Viewer", "Staff", "Manager", "Admin"] as const;
const MAY: Record<Need, string[]> = { access: ["Staff", "Manager", "Admin"], overseer: ["Manager", "Admin"], admin: ["Admin"] };

function request(c: Case): Request {
  const init: RequestInit = { method: c.method };
  if (c.body !== undefined) {
    init.body = JSON.stringify(c.body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(`http://localhost/api/crm/${c.route}${c.url ?? ""}`, init);
}

async function call(c: Case, as: "none" | (typeof ROLES)[number]) {
  state.user = as === "none" ? null : { id: ID, email: "someone@example.test" };
  state.profile = as === "none" ? null : { id: ID, email: "someone@example.test", role: as };
  const handler = handlerFor(c.route, c.method);
  expect(handler, `${c.method} ${c.route} is not exported`).toBeTypeOf("function");
  return handler(request(c), { params: c.params ?? {} });
}

beforeEach(() => fake.reset());

describe("every CRM route checks who is calling", () => {
  it("has a role check in the source of every route file, so a new route cannot be added without one", () => {
    const missing = Object.keys(modules).filter((file) => {
      const source = readFileSync(new URL(file.replace("../../", "../../"), import.meta.url), "utf8");
      return !/\bcrm(Access|Overseer|Admin)\(/.test(source);
    });
    expect(missing).toEqual([]);
  });

  it("is covered by the matrix below for every route and method it exports", () => {
    const covered = new Set(CASES.map((c) => `${c.route} ${c.method}`));
    const exported: string[] = [];
    for (const [file, mod] of Object.entries(modules)) {
      const route = file.replace("../../app/api/crm/", "").replace("/route.ts", "");
      for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) if (typeof mod[m] === "function") exported.push(`${route} ${m}`);
    }
    expect(exported.filter((e) => !covered.has(e))).toEqual([]);
  });
});

describe("who gets in", () => {
  for (const c of CASES) {
    const label = `${c.method} ${c.route}${c.url?.startsWith("?permanent") ? " (permanent)" : ""}`;

    it(`${label}: a signed-out visitor is turned away with 401`, async () => {
      expect((await call(c, "none")).status).toBe(401);
    });

    for (const role of ROLES) {
      const may = MAY[c.need].includes(role);
      it(`${label}: ${role} is ${may ? "let in" : "refused with 403"}`, async () => {
        const res = await call(c, role);
        if (may) expect([401, 403], `${role} was wrongly turned away (${res.status})`).not.toContain(res.status);
        else expect(res.status).toBe(403);
      });
    }
  }
});

describe("the people who work in the CRM", () => {
  it("Staff can do the daily work but not remove records, export, undo imports, change settings or reach the AI wording", async () => {
    const refused = CASES.filter((c) => !MAY[c.need].includes("Staff")).map((c) => `${c.method} ${c.route}`);
    expect(refused.sort()).toEqual(
      [
        "DELETE activities/[id]", "DELETE companies/[id]", "DELETE companies/[id]", "DELETE contacts/[id]", "DELETE opportunities/[id]", "POST export",
        "POST import/batches/[id]/undo", "POST settings", "GET ai/settings", "PUT ai/settings",
      ].sort()
    );
  });

  it("a Manager can do everything except erase a company for good and change the CRM's settings", () => {
    const refused = CASES.filter((c) => !MAY[c.need].includes("Manager")).map((c) => `${c.method} ${c.route}`);
    expect(refused.sort()).toEqual(["DELETE companies/[id]", "GET ai/settings", "POST settings", "PUT ai/settings"].sort());
  });

  it("the per-person comparison is withheld from Staff by the report route itself", async () => {
    // The route trims the table for Staff. (The numbers themselves come from the report builder, which is tested separately.)
    const source = readFileSync(new URL("../../app/api/crm/report/route.ts", import.meta.url), "utf8");
    expect(source).toMatch(/byStaff: \[\]/);
    expect(source).toMatch(/overseer/);
  });
});
