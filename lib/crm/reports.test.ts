import { describe, expect, it } from "vitest";
import { resolveRange } from "./report-range";
import { buildReport, DRILL_CAP, MIN_CLOSED, MIN_COHORT, type ReportData, type ReportFilters, type RCompany, type ROpportunity } from "./reports";

const TODAY = "2026-10-21"; // a Wednesday
const range = (() => {
  const r = resolveRange("this_week", TODAY);
  if ("error" in r) throw new Error(r.error);
  return r; // 19 to 25 October, starting 2026-10-18T23:00Z (clocks go back on the 25th)
})();
const ALL: ReportFilters = { category_id: null, staff_id: null };

const U1 = "u1"; // Joanna
const U2 = "u2"; // Sajad
const U3 = "u3"; // Philip

const company = (id: string, name: string, over: Partial<RCompany> = {}): RCompany => ({
  id, name, category_id: "c-build", assigned_to: null, created_by: null, created_at: "2026-09-01T09:00:00.000Z", stage_id: "s-new", stage_changed_at: null,
  last_contacted_at: null, estimated_value: null, won_value: null, ...over,
});
const opp = (id: string, company_id: string, over: Partial<ROpportunity> = {}): ROpportunity => ({
  id, company_id, title: `Job ${id}`, status: "identified", status_changed_at: "2026-10-01T09:00:00.000Z", estimated_value: null, won_value: null, source: null,
  assigned_to: null, created_by: null, created_at: "2026-10-01T09:00:00.000Z", ...over,
});

function fixture(): ReportData {
  return {
    categories: [{ id: "c-hotel", name: "Hotels", active: true }, { id: "c-build", name: "Builders", active: true }],
    people: [{ id: U1, email: "joanna.byrne@example.test" }, { id: U2, email: "sajad.khan@example.test" }, { id: U3, email: "philip.ryan@example.test" }],
    stages: [
      { id: "s-new", name: "New Prospect", kind: "open", sort_order: 1, active: true },
      { id: "s-int", name: "Interested", kind: "open", sort_order: 5, active: true },
      { id: "s-opp", name: "Opportunity Identified", kind: "open", sort_order: 6, active: true },
      { id: "s-won", name: "Won", kind: "won", sort_order: 9, active: true },
      { id: "s-lost", name: "Lost", kind: "lost", sort_order: 10, active: true },
    ],
    companies: [
      company("A", "Ace Hotel", { category_id: "c-hotel", created_at: "2026-10-19T09:00:00.000Z", created_by: U1, assigned_to: U1, estimated_value: 2000 }),
      company("B", "Beta Builders", { created_at: "2026-10-20T10:00:00.000Z", created_by: U2, assigned_to: U2, stage_id: "s-int", stage_changed_at: "2026-10-20T10:30:00.000Z", last_contacted_at: "2026-10-20T11:00:00.000Z" }),
      company("C", "Cork Joinery", { created_at: "2026-10-05T09:00:00.000Z", created_by: U1, assigned_to: U1, stage_id: "s-won", stage_changed_at: "2026-10-21T09:00:00.000Z", won_value: 5000, last_contacted_at: "2026-10-19T09:00:00.000Z" }),
      company("D", "Dune Resort", { category_id: "c-hotel", created_at: "2026-10-01T09:00:00.000Z", created_by: U1, assigned_to: U1, stage_id: "s-opp", stage_changed_at: "2026-10-05T09:00:00.000Z", last_contacted_at: "2026-10-22T09:00:00.000Z" }),
      company("E", "Eden Fit-Out", { created_at: "2026-10-22T08:00:00.000Z", created_by: U2, assigned_to: U2, stage_id: "s-lost", stage_changed_at: "2026-10-22T08:30:00.000Z" }),
      company("G", "Old Lead", { created_at: "2026-09-01T09:00:00.000Z", created_by: U1, assigned_to: null }),
    ],
    activities: [
      { id: "a1", company_id: "B", type: "Telephone call", occurred_at: "2026-10-20T09:00:00.000Z", user_id: U2 },
      { id: "a2", company_id: "D", type: "Meeting", occurred_at: "2026-10-21T10:00:00.000Z", user_id: U1 },
      { id: "a3", company_id: "D", type: "Initial research", occurred_at: "2026-10-21T08:00:00.000Z", user_id: U1 },
      { id: "a4", company_id: "D", type: "Email sent", occurred_at: "2026-10-22T09:00:00.000Z", user_id: U1 },
      { id: "a5", company_id: "C", type: "Telephone call", occurred_at: "2026-10-19T09:00:00.000Z", user_id: U1 },
    ],
    tasks: [
      { id: "t1", company_id: "D", title: "Send the quote", due_date: "2026-10-21", assigned_to: U1, status: "open", completed_at: null, completed_by: null },
      { id: "t2", company_id: "B", title: "Ring back", due_date: "2026-10-15", assigned_to: U2, status: "open", completed_at: null, completed_by: null },
      { id: "t3", company_id: "A", title: "Intro call", due_date: "2026-10-28", assigned_to: U1, status: "open", completed_at: null, completed_by: null },
      { id: "t4", company_id: "B", title: "First call", due_date: "2026-10-19", assigned_to: U2, status: "done", completed_at: "2026-10-20T09:30:00.000Z", completed_by: U2 },
      { id: "t5", company_id: "D", title: "Old one", due_date: "2026-10-09", assigned_to: U1, status: "done", completed_at: "2026-10-10T09:00:00.000Z", completed_by: U1 },
    ],
    stageHistory: [
      { company_id: "B", to_stage_id: "s-int", created_at: "2026-10-20T10:30:00.000Z" },
      { company_id: "D", to_stage_id: "s-int", created_at: "2026-10-02T09:00:00.000Z" },
      { company_id: "D", to_stage_id: "s-opp", created_at: "2026-10-05T09:00:00.000Z" },
    ],
    opportunities: [
      opp("o1", "D", { status: "won", status_changed_at: "2026-10-21T09:00:00.000Z", won_value: 16500, source: "Direct prospecting", assigned_to: U1, created_by: U1, created_at: "2026-10-02T09:00:00.000Z", estimated_value: 18000 }),
      opp("o2", "D", { status: "identified", estimated_value: 3000, assigned_to: U2, created_by: U1, created_at: "2026-10-21T09:00:00.000Z", status_changed_at: "2026-10-21T09:00:00.000Z" }),
      opp("o3", "B", { status: "quote_sent", estimated_value: 8000, assigned_to: U2, created_by: U2, created_at: "2026-10-20T09:00:00.000Z", status_changed_at: "2026-10-21T09:00:00.000Z" }),
    ],
    oppHistory: [
      { opportunity_id: "o1", to_status: "identified", created_at: "2026-10-02T09:00:00.000Z" },
      { opportunity_id: "o1", to_status: "quote_sent", created_at: "2026-10-10T09:00:00.000Z" },
      { opportunity_id: "o1", to_status: "won", created_at: "2026-10-21T09:00:00.000Z" },
      { opportunity_id: "o2", to_status: "identified", created_at: "2026-10-21T09:00:00.000Z" },
      { opportunity_id: "o3", to_status: "identified", created_at: "2026-10-20T09:00:00.000Z" },
      { opportunity_id: "o3", to_status: "quote_requested", created_at: "2026-10-20T10:00:00.000Z" },
      { opportunity_id: "o3", to_status: "quote_sent", created_at: "2026-10-21T09:00:00.000Z" },
    ],
  };
}

const report = (d = fixture(), filters = ALL) => buildReport(d, range, filters, TODAY);
const names = (r: ReturnType<typeof report>, key: keyof ReturnType<typeof report>["metrics"]) => r.metrics[key].rows.map((x) => x.company).sort();

describe("the overview numbers", () => {
  const r = report();

  it("counts companies, new prospects and who is awaiting contact", () => {
    expect(r.metrics.totalCompanies.value).toBe(6);
    expect(names(r, "newProspects")).toEqual(["Ace Hotel", "Beta Builders", "Eden Fit-Out"]);
    // Open prospects with no contact: not Beta (contacted), Cork (won), Dune (contacted) or Eden (lost).
    expect(names(r, "awaitingContact")).toEqual(["Ace Hotel", "Old Lead"]);
  });

  it("counts contact that someone recorded, not research, and the companies reached", () => {
    expect(r.metrics.contactsMade.value).toBe(4);
    expect(r.metrics.contactsMade.rows.map((x) => x.detail).sort()).toEqual(["Email sent", "Meeting", "Telephone call", "Telephone call"]);
    expect(names(r, "companiesContacted")).toEqual(["Beta Builders", "Cork Joinery", "Dune Resort"]);
    expect(r.metrics.companiesContacted.rows.find((x) => x.company === "Dune Resort")?.detail).toBe("2 contacts");
  });

  it("counts follow-ups: completed in the period, due today, and overdue", () => {
    expect(names(r, "followUpsCompleted")).toEqual(["Beta Builders"]);
    expect(names(r, "dueToday")).toEqual(["Dune Resort"]);
    expect(names(r, "overdue")).toEqual(["Beta Builders"]);
  });

  it("counts interested prospects now, and those who became interested in the period", () => {
    expect(names(r, "interested")).toEqual(["Beta Builders"]);
    expect(names(r, "becameInterested")).toEqual(["Beta Builders"]); // Dune's move was in early October
  });

  it("counts opportunities and quotes by when they happened, not by where they are now", () => {
    expect(names(r, "opportunities")).toEqual(["Beta Builders", "Dune Resort"]);
    expect(names(r, "quotesRequested")).toEqual(["Beta Builders"]);
    expect(names(r, "quotesSent")).toEqual(["Beta Builders"]); // Dune's quote went out on 10 October
  });

  it("counts a win once: a won opportunity, or a company marked Won with no opportunity of its own", () => {
    expect(r.metrics.dealsWon.value).toBe(2);
    expect(names(r, "dealsWon")).toEqual(["Cork Joinery", "Dune Resort"]);
    expect(r.metrics.dealsLost.rows.map((x) => x.company)).toEqual(["Eden Fit-Out"]);
  });

  it("adds up only recorded values for confirmed sales, and never an estimate", () => {
    expect(r.metrics.salesValue.money).toBe(21500);
    expect(r.sales).toMatchObject({ confirmedValue: 21500, wonCount: 2, wonWithoutValue: 0, fromOpportunities: { count: 1, value: 16500 }, fromCompanies: { count: 1, value: 5000 } });
    // The estimates (Ace's 2,000, the open opportunities' 11,000, Dune's 18,000 estimate) are nowhere in sales.
    expect(r.sales.openEstimate).toEqual({ count: 2, value: 11000 });
    expect(r.sales.openByStatus).toEqual([
      { status: "identified", count: 1, estimate: 3000 },
      { status: "quote_requested", count: 0, estimate: 0 },
      { status: "quote_sent", count: 1, estimate: 8000 },
    ]);
  });

  it("credits direct prospecting only where the opportunity says so", () => {
    expect(r.sales.bySource).toEqual([
      { source: "Direct prospecting", count: 1, value: 16500 },
      { source: "Not recorded", count: 1, value: 5000 },
    ]);
  });
});

describe("the records behind each number", () => {
  it("lists them most recent first, with who and when", () => {
    const rows = report().metrics.contactsMade.rows;
    expect(rows.map((x) => x.at)).toEqual([...rows.map((x) => x.at)].sort().reverse());
    expect(rows[0]).toMatchObject({ company: "Dune Resort", detail: "Email sent", who: "Joanna Byrne" });
  });

  it("sends at most a limited number of records but still reports the true total", () => {
    const d = fixture();
    d.activities = Array.from({ length: 250 }, (_, i) => ({ id: `x${i}`, company_id: "B", type: "Telephone call" as const, occurred_at: "2026-10-20T09:00:00.000Z", user_id: U2 }));
    const m = report(d).metrics.contactsMade;
    expect(m.value).toBe(250);
    expect(m.total).toBe(250);
    expect(m.rows).toHaveLength(DRILL_CAP);
  });

  it("shows the value, or says none was recorded, on each won deal", () => {
    const d = fixture();
    d.companies.find((c) => c.id === "C")!.won_value = null;
    const details = report(d).metrics.dealsWon.rows.map((x) => x.detail).sort();
    expect(details[0]).toContain("Company marked Won, no value recorded");
    expect(details[1]).toContain("€16,500");
  });
});

describe("the edges of the date range", () => {
  it("includes the first moment of the Irish day and excludes the last moment of the day before", () => {
    const d = fixture();
    d.activities = [
      { id: "in", company_id: "B", type: "Telephone call", occurred_at: "2026-10-18T23:00:00.000Z", user_id: U2 }, // 00:00 on Monday 19th in Dublin
      { id: "out", company_id: "B", type: "Telephone call", occurred_at: "2026-10-18T22:59:00.000Z", user_id: U2 }, // 23:59 on Sunday 18th
      { id: "end", company_id: "B", type: "Telephone call", occurred_at: "2026-10-25T23:30:00.000Z", user_id: U2 }, // 23:30 on Sunday 25th (clocks went back)
      { id: "after", company_id: "B", type: "Telephone call", occurred_at: "2026-10-26T00:00:00.000Z", user_id: U2 }, // Monday 26th
    ];
    expect(report(d).metrics.contactsMade.value).toBe(2);
  });

  it("does not count a deal that closed outside the range", () => {
    const d = fixture();
    d.opportunities[0].status_changed_at = "2026-10-12T09:00:00.000Z";
    d.companies.find((c) => c.id === "C")!.stage_changed_at = "2026-09-30T09:00:00.000Z";
    expect(report(d).metrics.dealsWon.value).toBe(0);
  });
});

describe("filters", () => {
  it("filtering to a person shows their own work", () => {
    const r = report(fixture(), { category_id: null, staff_id: U2 });
    expect(r.metrics.newProspects.rows.map((x) => x.company).sort()).toEqual(["Beta Builders", "Eden Fit-Out"]); // added by them
    expect(r.metrics.contactsMade.value).toBe(1); // their own call
    expect(r.metrics.followUpsCompleted.value).toBe(1);
    expect(r.metrics.dueToday.value).toBe(0); // Joanna's follow-up
    expect(r.metrics.overdue.value).toBe(1);
    expect(r.metrics.opportunities.value).toBe(2); // handled by them
    expect(r.metrics.dealsWon.value).toBe(0); // Joanna's wins
    expect(r.notes.some((n) => /one person/.test(n))).toBe(true);
  });

  it("filtering to a category limits everything to its companies", () => {
    const r = report(fixture(), { category_id: "c-hotel", staff_id: null });
    expect(r.metrics.totalCompanies.value).toBe(2);
    expect(names(r, "newProspects")).toEqual(["Ace Hotel"]);
    expect(r.metrics.contactsMade.value).toBe(2); // Dune's meeting and email
    expect(names(r, "dealsWon")).toEqual(["Dune Resort"]);
    expect(r.metrics.salesValue.money).toBe(16500);
    expect(r.byCategory.map((x) => x.label)).toEqual(["Hotels"]);
  });

  it("can pick the companies with no category", () => {
    const d = fixture();
    d.companies.push(company("N", "No Category Ltd", { category_id: null, created_at: "2026-10-20T09:00:00.000Z", created_by: U1 }));
    const r = report(d, { category_id: "__none__", staff_id: null });
    expect(names(r, "newProspects")).toEqual(["No Category Ltd"]);
    expect(r.metrics.totalCompanies.value).toBe(1);
  });
});

describe("by category and by person", () => {
  const r = report();
  const cat = (label: string) => r.byCategory.find((x) => x.label === label)!;
  const person = (label: string) => r.byStaff.find((x) => x.label === label)!;

  it("builds a row per category from the same rules as the totals", () => {
    expect(cat("Hotels")).toMatchObject({ added: 1, contacted: 1, contactsMade: 2, opportunities: 1, quotesSent: 0, won: 1, lost: 0, wonValue: 16500 });
    expect(cat("Builders")).toMatchObject({ added: 2, contacted: 2, contactsMade: 2, opportunities: 1, quotesSent: 1, won: 1, lost: 1, wonValue: 5000 });
    expect(cat("No category")).toMatchObject({ added: 0, won: 0 });
  });

  it("builds a row per person, including someone with no activity", () => {
    expect(person("Joanna Byrne")).toMatchObject({ added: 1, contactsMade: 3, contacted: 2, followUpsCompleted: 0, won: 2, wonValue: 21500 });
    expect(person("Sajad Khan")).toMatchObject({ added: 2, contactsMade: 1, contacted: 1, followUpsCompleted: 1, opportunities: 2, quotesSent: 1, won: 0, lost: 1 });
    expect(person("Philip Ryan")).toMatchObject({ added: 0, contactsMade: 0, followUpsCompleted: 0, opportunities: 0, won: 0, wonValue: 0 });
    expect(r.byStaff.map((x) => x.label)).toEqual(["Joanna Byrne", "Philip Ryan", "Sajad Khan"]);
  });

  it("only shows one person's row when filtered to them", () => {
    expect(report(fixture(), { category_id: null, staff_id: U1 }).byStaff.map((x) => x.label)).toEqual(["Joanna Byrne"]);
  });

  it("the rows add up to the totals", () => {
    const sum = (key: "added" | "won" | "wonValue") => r.byCategory.reduce((n, x) => n + x[key], 0);
    expect(sum("added")).toBe(r.metrics.newProspects.value);
    expect(sum("won")).toBe(r.metrics.dealsWon.value);
    expect(sum("wonValue")).toBe(r.metrics.salesValue.money);
  });
});

describe("win rates and conversion are only shown when there is enough behind them", () => {
  it("withholds a win rate until there are enough closed deals, then shows it", () => {
    const few = report().byCategory.find((x) => x.label === "Builders")!;
    expect(few.won + few.lost).toBeLessThan(MIN_CLOSED);
    expect(few.winRate).toBeNull();

    const d = fixture();
    for (let i = 0; i < 8; i++) {
      d.companies.push(company(`w${i}`, `Won ${i}`, { stage_id: "s-won", stage_changed_at: "2026-10-20T09:00:00.000Z", won_value: 1000 }));
    }
    for (let i = 0; i < 2; i++) d.companies.push(company(`l${i}`, `Lost ${i}`, { stage_id: "s-lost", stage_changed_at: "2026-10-20T09:00:00.000Z" }));
    const row = report(d).byCategory.find((x) => x.label === "Builders")!;
    expect(row.won).toBe(9);
    expect(row.lost).toBe(3);
    expect(row.winRate).toBeCloseTo(9 / 12, 5);
  });

  it("shows the funnel's counts but no percentages for a small cohort, and says so", () => {
    const r = report();
    expect(r.funnel.cohort).toBe(3);
    expect(r.funnel.enough).toBe(false);
    expect(r.funnel.steps.map((s) => [s.key, s.count])).toEqual([["added", 3], ["contacted", 1], ["interested", 1], ["opportunity", 1], ["quote", 1], ["won", 0]]);
    expect(r.funnel.steps.every((s) => s.share === null)).toBe(true);
    expect(r.funnelNotes.some((n) => n.includes(`at least ${MIN_COHORT} companies`))).toBe(true);
    expect(r.notes.some((n) => /percentages/.test(n))).toBe(false); // the overview does not need to hear about it
  });

  it("shows each step as a share of the companies added once there are enough", () => {
    const d = fixture();
    for (let i = 0; i < 9; i++) d.companies.push(company(`n${i}`, `New ${i}`, { created_at: "2026-10-21T09:00:00.000Z", last_contacted_at: i < 4 ? "2026-10-21T10:00:00.000Z" : null }));
    const r = report(d);
    expect(r.funnel.cohort).toBe(12);
    expect(r.funnel.enough).toBe(true);
    const share = (key: string) => r.funnel.steps.find((s) => s.key === key)!.share;
    expect(share("added")).toBe(1);
    expect(share("contacted")).toBeCloseTo(5 / 12, 5); // Beta and four new ones
    expect(r.funnel.steps.every((s) => s.share === null || (s.share >= 0 && s.share <= 1))).toBe(true);
  });

  it("counts a company that reached Interested and then went further, but not one that was lost", () => {
    const d = fixture();
    d.companies.push(company("W", "Went Further", { created_at: "2026-10-21T09:00:00.000Z", stage_id: "s-opp" }));
    d.companies.push(company("L", "Lost Early", { created_at: "2026-10-21T09:00:00.000Z", stage_id: "s-lost" }));
    const interested = report(d).funnel.steps.find((s) => s.key === "interested")!;
    expect(interested.count).toBe(2); // Beta and Went Further; Eden and Lost Early were lost
  });

  it("builds the opportunity funnel from what each opportunity ever reached", () => {
    const r = report();
    expect(r.opportunityFunnel.cohort).toBe(2); // o2 and o3 were identified this week
    expect(r.opportunityFunnel.steps.map((s) => [s.key, s.count])).toEqual([["identified", 2], ["quote_requested", 1], ["quote_sent", 1], ["won", 0], ["lost", 0]]);
    expect(r.opportunityFunnel.enough).toBe(false);
    expect(r.opportunityFunnel.steps.every((s) => s.share === null)).toBe(true);
  });
});

describe("notes that explain a gap", () => {
  it("says when won deals have no value, so sales is understated", () => {
    const d = fixture();
    d.opportunities[0].won_value = null;
    d.companies.find((c) => c.id === "C")!.won_value = null;
    const r = report(d);
    expect(r.sales.wonWithoutValue).toBe(2);
    expect(r.metrics.salesValue.money).toBe(0);
    expect(r.notes.some((n) => /2 won deals have no value recorded/.test(n))).toBe(true);
  });

  it("explains that interested prospects cannot be counted when no stage is called Interested", () => {
    const d = fixture();
    d.stages = d.stages.filter((s) => s.id !== "s-int");
    const r = report(d);
    expect(r.metrics.interested.value).toBe(0);
    expect(r.metrics.interested.note).toMatch(/No stage is called/);
    expect(r.funnel.steps.some((s) => s.key === "interested")).toBe(false);
    expect(r.notes.some((n) => /Interested/.test(n))).toBe(true);
  });

  it("has no notes at all when there is nothing to explain", () => {
    const d = fixture();
    for (let i = 0; i < 9; i++) d.companies.push(company(`n${i}`, `New ${i}`, { created_at: "2026-10-21T09:00:00.000Z" }));
    for (let i = 0; i < 10; i++) d.opportunities.push(opp(`p${i}`, "B", { created_at: "2026-10-21T09:00:00.000Z" }));
    const r = report(d);
    expect(r.notes).toEqual([]);
    expect(r.funnelNotes).toEqual([]);
  });
});

describe("the trend and the activity mix", () => {
  it("has a point for every day, counting prospects added and contacts made on the day they happened", () => {
    const t = report().trend;
    expect(t.bucket).toBe("day");
    expect(t.points.map((p) => p.date)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(t.points.map((p) => p.added)).toEqual([1, 1, 0, 1, 0, 0, 0]);
    expect(t.points.map((p) => p.contacts)).toEqual([1, 1, 1, 1, 0, 0, 0]);
  });

  it("groups by week for a long range", () => {
    const long = resolveRange("custom", TODAY, "2026-08-03", "2026-10-25");
    if ("error" in long) throw new Error(long.error);
    const t = buildReport(fixture(), long, ALL, TODAY).trend;
    expect(t.bucket).toBe("week");
    expect(t.points[0].date).toBe("2026-08-03");
    expect(t.points).toHaveLength(12);
    expect(t.points.reduce((n, p) => n + p.added, 0)).toBe(buildReport(fixture(), long, ALL, TODAY).metrics.newProspects.value);
  });

  it("counts every type of recorded activity, most common first", () => {
    expect(report().activityByType).toEqual([
      { type: "Telephone call", count: 2 },
      { type: "Initial research", count: 1 },
      { type: "Email sent", count: 1 },
      { type: "Meeting", count: 1 },
    ]);
  });
});

describe("the pipeline today and the next follow-ups", () => {
  it("counts companies at each stage, with the estimate of open ones (a guess, never sales)", () => {
    const p = report().pipeline;
    expect(p.map((s) => [s.name, s.count])).toEqual([["New Prospect", 2], ["Interested", 1], ["Opportunity Identified", 1], ["Won", 1], ["Lost", 1]]);
    expect(p[0]).toMatchObject({ estimate: 2000 });
    expect(p[3]).toMatchObject({ estimate: 0 }); // a won company shows no estimate, and sales are reported only as confirmed sales
  });

  it("lists the next follow-ups soonest first, overdue marked, with who has each", () => {
    const f = report().nextFollowUps;
    expect(f.map((x) => [x.company, x.due, x.overdue, x.assignee])).toEqual([
      ["Beta Builders", "2026-10-15", true, "Sajad Khan"],
      ["Dune Resort", "2026-10-21", false, "Joanna Byrne"],
      ["Ace Hotel", "2026-10-28", false, "Joanna Byrne"],
    ]);
  });

  it("limits the follow-ups listed to ten", () => {
    const d = fixture();
    for (let i = 0; i < 20; i++) d.tasks.push({ id: `m${i}`, company_id: "A", title: `Task ${i}`, due_date: "2026-11-01", assigned_to: U1, status: "open", completed_at: null, completed_by: null });
    expect(report(d).nextFollowUps).toHaveLength(10);
  });
});

describe("an empty CRM", () => {
  it("reports zeros without failing or inventing percentages", () => {
    const empty: ReportData = { companies: [], stages: [], categories: [], people: [], activities: [], tasks: [], stageHistory: [], opportunities: [], oppHistory: [] };
    const r = report(empty);
    expect(Object.values(r.metrics).every((m) => m.value === 0 && m.rows.length === 0)).toBe(true);
    expect(r.funnel.steps.every((s) => s.share === null)).toBe(true);
    expect(r.byCategory.every((x) => x.winRate === null)).toBe(true);
    expect(r.sales.confirmedValue).toBe(0);
  });
});

describe("by county", () => {
  // Ace Hotel (Carlow), Beta Builders (Kilkenny), Cork Joinery (Carlow), Dune Resort (Dublin), Eden Fit-Out (outside Leinster), Old Lead (no county).
  const withCounties = () => {
    const d = fixture();
    const set = (id: string, county: string | null) => (d.companies.find((c) => c.id === id)!.county = county);
    set("A", "Carlow"); set("B", "Kilkenny"); set("C", "Carlow"); set("D", "Dublin"); set("E", "Outside Leinster"); set("G", null);
    return d;
  };
  const r = report(withCounties());
  const county = (label: string) => r.byCounty.find((x) => x.label === label)!;

  it("always lists all twelve Leinster counties in order, then the others that have companies", () => {
    expect(r.byCounty.map((x) => x.label)).toEqual([
      "Carlow", "Dublin", "Kildare", "Kilkenny", "Laois", "Longford", "Louth", "Meath", "Offaly", "Westmeath", "Wexford", "Wicklow", "Outside Leinster", "No county set",
    ]);
    expect(county("Laois")).toMatchObject({ companies: 0, added: 0, won: 0, wonValue: 0, openOpportunities: 0 });
  });

  it("leaves out Outside Leinster and No county set when nothing is there", () => {
    const d = withCounties();
    d.companies = d.companies.filter((c) => c.id !== "E" && c.id !== "G");
    expect(report(d).byCounty.map((x) => x.label)).toHaveLength(12);
  });

  it("builds each county's row from the same rules as the totals", () => {
    expect(county("Carlow")).toMatchObject({ companies: 2, added: 1, won: 1, wonValue: 5000 });
    expect(county("Dublin")).toMatchObject({ companies: 1, contactsMade: 2, opportunities: 1, won: 1, wonValue: 16500 });
    expect(county("Kilkenny")).toMatchObject({ companies: 1, added: 1, contactsMade: 1, quotesSent: 1, followUpsCompleted: 1 });
    expect(county("Outside Leinster")).toMatchObject({ companies: 1, lost: 1 });
    expect(county("No county set")).toMatchObject({ companies: 1, awaitingContact: 1 });
  });

  it("shows how things stand now: follow-ups due and opportunities still open", () => {
    expect(county("Dublin")).toMatchObject({ dueToday: 1, overdue: 0, openOpportunities: 1, openEstimate: 3000 });
    expect(county("Kilkenny")).toMatchObject({ overdue: 1, openOpportunities: 1, openEstimate: 8000 });
    expect(county("Carlow")).toMatchObject({ openOpportunities: 0, openEstimate: 0 });
  });

  it("adds up to the overall figures, so nothing is lost or counted twice", () => {
    const sum = (f: (x: (typeof r.byCounty)[number]) => number) => r.byCounty.reduce((n, x) => n + f(x), 0);
    expect(sum((x) => x.companies)).toBe(r.metrics.totalCompanies.value);
    expect(sum((x) => x.wonValue)).toBe(r.metrics.salesValue.money);
    expect(sum((x) => x.won)).toBe(r.metrics.dealsWon.value);
    expect(sum((x) => x.contactsMade)).toBe(r.metrics.contactsMade.value);
    expect(sum((x) => x.openOpportunities)).toBe(r.sales.openEstimate.count);
    expect(sum((x) => x.openEstimate)).toBe(r.sales.openEstimate.value);
  });

  it("follows the category and person filters", () => {
    const hotels = report(withCounties(), { category_id: "c-hotel", staff_id: null });
    expect(hotels.byCounty.find((x) => x.label === "Carlow")).toMatchObject({ companies: 1 }); // only Ace Hotel
    expect(hotels.byCounty.find((x) => x.label === "Kilkenny")).toMatchObject({ companies: 0 });
  });

  it("treats companies that carry no county field (older data) as having no county", () => {
    const d = fixture();
    expect(report(d).byCounty.find((x) => x.label === "No county set")!.companies).toBe(6);
  });
});
