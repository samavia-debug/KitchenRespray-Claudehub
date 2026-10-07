import { describe, expect, it } from "vitest";
import { addDays } from "../connecteam/time-clock-summary";
import type { OpsScheduled, OpsShift } from "../connecteam/operations";
import type { StaffDetail } from "../connecteam/time-clock-summary";
import {
  CAPACITY_RULES,
  formatCapacityContext,
  isTechnician,
  summariseCapacity,
  weekList,
  type CapacityLeave,
  type DemandDay,
  type SearchDay,
} from "./summary";

// Wednesday 7 Oct 2026, 13:00 Irish time. This week is Mon 5 – Sun 11 Oct.
const NOW = Date.parse("2026-10-07T12:00:00Z");
const MON = "2026-10-05";
const wk = (n: number) => addDays(MON, 7 * n); // wk(-1) = Mon 28 Sep, wk(1) = Mon 12 Oct

const staff: StaffDetail[] = [
  { userId: 1, name: "Anna Tech", former: false, role: "Technicians", department: "Spray technitian" },
  { userId: 2, name: "Ben Tech", former: false, role: "Technicians" },
  { userId: 3, name: "Gone Tech", former: true, department: "Spray technitian" },
  { userId: 4, name: "Sam Sales", former: false, role: "Sales", department: "Sales" },
];

let n = 0;
/** One clock-in on `date` of `hours` hours, starting 08:00 UTC (09:00 Irish summer time). */
function clock(user: number, date: string, hours: number, over: Partial<OpsShift> = {}): OpsShift {
  const start = Date.parse(`${date}T08:00:00Z`);
  return { shift_id: `c${++n}`, user_id: user, started_at: new Date(start).toISOString(), ended_at: new Date(start + hours * 3_600_000).toISOString(), job_id: null, scheduler_shift_id: null, ...over };
}

function plan(date: string, hours: number, users: number[], over: Partial<OpsScheduled> = {}): OpsScheduled {
  const start = Date.parse(`${date}T08:00:00Z`);
  return {
    shift_id: `p${++n}`,
    start_at: new Date(start).toISOString(),
    end_at: new Date(start + hours * 3_600_000).toISOString(),
    assigned_user_ids: users,
    is_open: false,
    is_published: true,
    job_id: null,
    tasks_total: 0,
    tasks_done: 0,
    ...over,
  };
}

/** Clock-ins of up to 10 hours, spread over the weekdays and two technicians, adding up to `total` hours. */
const weekOfClock = (monday: string, total: number) =>
  Array.from({ length: Math.ceil(total / 10) }, (_, i) => clock((i % 2) + 1, addDays(monday, i % 5), Math.min(10, total - i * 10)));

/** The same website figure on every day of a week. */
function webWeek(monday: string, perDay: number, days = 7): { a: DemandDay[]; s: SearchDay[] } {
  const dates = Array.from({ length: days }, (_, i) => addDays(monday, i));
  return { a: dates.map((date) => ({ date, sessions: perDay, conversions: 1 })), s: dates.map((date) => ({ date, clicks: 10 })) };
}

// Weeks wk(-4)..wk(-2) normal (700 visits, 200h); last week wk(-1) busier online but fewer hours.
function history() {
  const shifts = [...weekOfClock(wk(-4), 200), ...weekOfClock(wk(-3), 200), ...weekOfClock(wk(-2), 200), ...weekOfClock(wk(-1), 160)];
  const web = [wk(-4), wk(-3), wk(-2)].map((m) => webWeek(m, 100));
  web.push(webWeek(wk(-1), 143));
  return {
    shifts,
    analytics: web.flatMap((w) => w.a),
    search: web.flatMap((w) => w.s),
  };
}

describe("technicians", () => {
  it("matches role or department, including the misspelling in Connecteam", () => {
    expect(isTechnician({ role: "Technicians" })).toBe(true);
    expect(isTechnician({ department: "Spray technitian" })).toBe(true);
    expect(isTechnician({ role: "Sales", department: "Sales" })).toBe(false);
    expect(isTechnician({})).toBe(false);
  });

  it("only counts technicians' hours, keeping those of people who have since left", () => {
    const shifts = [clock(1, wk(-1), 8), clock(3, wk(-1), 6), clock(4, wk(-1), 9)];
    const o = summariseCapacity([], [], shifts, [], [], staff, NOW);
    const w = o.weeks.find((x) => x.from === wk(-1))!;
    expect(w.workedHours).toBe(14);
    expect(w.techniciansWorked).toBe(2);
    expect(o.technicians).toEqual({ active: 2, matched: 3 });
  });
});

describe("weeks", () => {
  it("covers past, this and future weeks starting on Mondays", () => {
    const w = weekList("2026-10-07");
    expect(w).toHaveLength(CAPACITY_RULES.pastWeeks + 1 + CAPACITY_RULES.futureWeeks);
    expect(w[CAPACITY_RULES.pastWeeks]).toEqual({ from: MON, to: "2026-10-11", kind: "current" });
    expect(w[0].kind).toBe("past");
    expect(w.at(-1)!.kind).toBe("future");
  });

  it("puts a clock-in in the Irish week it happened, not the UTC one", () => {
    // 00:30 Irish time on Monday is 23:30 UTC on Sunday.
    const mondayEarly = clock(1, "2026-09-27", 2, { started_at: "2026-09-27T23:30:00Z", ended_at: "2026-09-28T01:30:00Z" });
    // 23:30 Irish time on Sunday is 22:30 UTC on Sunday.
    const sundayLate = clock(1, "2026-09-27", 1, { started_at: "2026-09-27T22:30:00Z", ended_at: "2026-09-27T23:30:00Z" });
    const o = summariseCapacity([], [], [mondayEarly, sundayLate], [], [], staff, NOW);
    expect(o.weeks.find((x) => x.from === wk(-1))!.workedHours).toBe(2);
    expect(o.weeks.find((x) => x.from === wk(-2))!.workedHours).toBe(1);
  });

  it("leaves out forgotten clock-outs and still-open shifts", () => {
    const shifts = [clock(1, wk(-1), 8), clock(1, wk(-1), 20), clock(1, wk(-1), 5, { ended_at: null })];
    expect(summariseCapacity([], [], shifts, [], [], staff, NOW).weeks.find((x) => x.from === wk(-1))!.workedHours).toBe(8);
  });
});

describe("website demand", () => {
  it("sums each week and says when the data is incomplete", () => {
    const last = webWeek(wk(-1), 100);
    // This week: three days of visits, but Search Console has not caught up yet.
    const thisWeek = webWeek(MON, 50, 3);
    const o = summariseCapacity([...last.a, ...thisWeek.a], [...last.s, ...thisWeek.s.slice(0, 1)], [], [], [], staff, NOW);
    const l = o.weeks.find((x) => x.from === wk(-1))!.demand!;
    expect(l).toMatchObject({ sessions: 700, conversions: 7, clicks: 70, analyticsDays: 7, complete: true, searchComplete: true });
    const c = o.weeks.find((x) => x.from === MON)!.demand!;
    expect(c).toMatchObject({ sessions: 150, daysElapsed: 3, complete: true, searchComplete: false });
    expect(o.weeks.find((x) => x.from === wk(-3))!.demand).toBeNull();
    expect(o.weeks.find((x) => x.from === wk(1))!.demand).toBeNull();
    expect(o.demandHistoryFrom).toBe(wk(-1));
  });

  it("does not compare a week that is missing days", () => {
    const h = history();
    const patched = h.analytics.filter((d) => d.date !== addDays(wk(-1), 3));
    const last = summariseCapacity(patched, h.search, h.shifts, [], [], staff, NOW).weeks.find((x) => x.from === wk(-1))!;
    expect(last.demand!.complete).toBe(false);
    expect(last.sessionsVsUsualPct).toBeNull();
  });
});

describe("several sites", () => {
  it("adds the sites together for each day", () => {
    const day = (site: number): DemandDay[] => [{ date: addDays(wk(-1), 0), sessions: 10 * site, conversions: site }];
    const search: SearchDay[] = [{ date: addDays(wk(-1), 0), clicks: 4 }, { date: addDays(wk(-1), 0), clicks: 6 }];
    const o = summariseCapacity([...day(1), ...day(2), ...day(3)], search, [], [], [], staff, NOW);
    expect(o.weeks.find((x) => x.from === wk(-1))!.demand).toMatchObject({ sessions: 60, conversions: 6, clicks: 10, analyticsDays: 1, searchDays: 1 });
  });
});

describe("last week against usual", () => {
  const h = history();
  const o = summariseCapacity(h.analytics, h.search, h.shifts, [], [], staff, NOW);
  const last = o.weeks.find((x) => x.from === wk(-1))!;

  it("compares visits and hours with the weeks before", () => {
    expect(last.sessionsVsUsualPct).toBe(43);
    expect(last.hoursVsUsualPct).toBe(-20);
  });

  it("flags visits up while hours are down", () => {
    const f = o.findings.find((x) => x.text.includes("website visits were 43% above usual"));
    expect(f?.level).toBe("attention");
    expect(f?.text).toContain("technician hours were 20% below");
  });

  it("notes the opposite pattern without alarm", () => {
    const quiet = [wk(-4), wk(-3), wk(-2), wk(-1)].map((m, i) => webWeek(m, i === 3 ? 60 : 100));
    const shifts = [...weekOfClock(wk(-4), 160), ...weekOfClock(wk(-3), 160), ...weekOfClock(wk(-2), 160), ...weekOfClock(wk(-1), 200)];
    const r = summariseCapacity(quiet.flatMap((w) => w.a), quiet.flatMap((w) => w.s), shifts, [], [], staff, NOW);
    const f = r.findings.find((x) => x.text.includes("below usual while technician hours"));
    expect(f?.level).toBe("note");
  });

  it("says nothing when both move together", () => {
    const flat = [wk(-4), wk(-3), wk(-2), wk(-1)].map((m) => webWeek(m, 100));
    const shifts = [wk(-4), wk(-3), wk(-2), wk(-1)].flatMap((m) => weekOfClock(m, 200));
    const r = summariseCapacity(flat.flatMap((w) => w.a), flat.flatMap((w) => w.s), shifts, [], [], staff, NOW);
    expect(r.findings).toEqual([]);
  });
});

describe("the rota ahead", () => {
  const h = history();
  // Usual hours = (200 + 200 + 200 + 160) / 4 = 190.
  const scheduled: OpsScheduled[] = [
    // This week: 10 shifts of 9h for two technicians = 180 hours, 95% of usual.
    ...[0, 1, 2, 3, 4].flatMap((d) => [0, 1].map((k) => ({ ...plan(addDays(MON, d), 9, [1, 2]), shift_id: `w0-${d}-${k}` }))),
    // Next week: 5 shifts of 12h for two technicians = 120 hours, 63%: light.
    ...[0, 1, 2, 3, 4].map((d) => ({ ...plan(addDays(wk(1), d), 12, [1, 2]), shift_id: `w1-${d}` })),
    // Two weeks out: 18 hours, nearly empty.
    { ...plan(addDays(wk(2), 1), 9, [1, 2]), shift_id: "w2" },
  ];
  const leave: CapacityLeave[] = [
    { user_id: 1, leave_type: "Holidays", status: "approved", start_date: "2026-10-09", end_date: "2026-10-14" },
    { user_id: 2, leave_type: "Holidays", status: "pending", start_date: "2026-10-12", end_date: "2026-10-16" },
    { user_id: 4, leave_type: "Holidays", status: "approved", start_date: "2026-10-12", end_date: "2026-10-16" },
    { user_id: 2, leave_type: "Holidays", status: "approved", start_date: "2026-10-15", end_date: "2026-10-15", is_all_day: false },
  ];
  const o = summariseCapacity(h.analytics, h.search, h.shifts, scheduled, leave, staff, NOW);
  const week = (m: string) => o.weeks.find((x) => x.from === m)!;

  it("works out usual weekly hours from recent full weeks", () => {
    expect(o.usualWeeklyHours).toBe(190);
  });

  it("sorts weeks into normal, light and not planned yet", () => {
    expect(week(MON)).toMatchObject({ rotaHours: 180, rotaVsUsualPct: 95, status: "normal", techniciansRostered: 2 });
    expect(week(wk(1))).toMatchObject({ rotaHours: 120, rotaVsUsualPct: 63, status: "light" });
    expect(week(wk(2))).toMatchObject({ rotaHours: 18, status: "unplanned" });
  });

  it("only treats the rota as planned until the first mostly-empty week", () => {
    expect(o.rotaPlannedThrough).toBe(addDays(wk(1), 6));
    expect(o.findings.some((f) => f.text.includes("looks planned up to"))).toBe(true);
    expect(o.findings.some((f) => f.text.includes("18h on the rota"))).toBe(false);
  });

  it("counts working days of approved technician leave only, weekends excluded", () => {
    expect(week(MON)).toMatchObject({ leaveDays: 1, leavePeople: 1 }); // Fri 9 Oct
    expect(week(wk(1))).toMatchObject({ leaveDays: 3.5, leavePeople: 2 }); // Mon–Wed, plus a half day
  });

  it("explains a light week with the leave behind it", () => {
    const f = o.findings.find((x) => x.text.includes("120h on the rota against about 190h"));
    expect(f?.level).toBe("attention");
    expect(f?.text).toContain("2 technicians are on approved leave (3.5 working days)");
  });

  it("says when the gap is only unpublished rota", () => {
    const withDraft: OpsScheduled[] = [
      ...scheduled,
      // 70 hours saved as draft next week brings 120 + 70 = 190 hours, 100% of usual.
      ...[0, 1, 2, 3, 4].map((d) => ({ ...plan(addDays(wk(1), d), 7, [1, 2], { is_published: false }), shift_id: `d${d}` })),
    ];
    const r = summariseCapacity(h.analytics, h.search, h.shifts, withDraft, leave, staff, NOW);
    const f = r.findings.find((x) => x.text.includes("only 120h of the usual 190h is published"));
    expect(f?.level).toBe("note");
    expect(f?.text).toContain("Another 70h is saved as draft");
    expect(f?.text).toContain("100% of usual");
    expect(r.findings.some((x) => x.level === "attention" && x.text.includes("on the rota against"))).toBe(false);
  });

  it("separates drafts and open shifts from the published rota", () => {
    const more: OpsScheduled[] = [
      plan(addDays(MON, 1), 8, [1], { is_published: false }),
      plan(addDays(MON, 2), 6, [], { is_open: true }),
      plan(addDays(MON, 3), 7, [4]), // a sales shift: not capacity
      plan(addDays(MON, 3), 30, [1]), // implausible length
    ];
    const r = summariseCapacity([], [], [], more, [], staff, NOW).weeks.find((x) => x.from === MON)!;
    expect(r).toMatchObject({ rotaHours: 0, draftHours: 8, openHours: 6 });
    expect(summariseCapacity([], [], [], more, [], staff, NOW).rotaShiftsIgnored).toBe(1);
  });
});

describe("thin history", () => {
  it("makes no judgement without a baseline", () => {
    const o = summariseCapacity([], [], weekOfClock(wk(-1), 20), [plan(MON, 8, [1])], [], staff, NOW);
    expect(o.usualWeeklyHours).toBeNull();
    expect(o.weeks.every((w) => w.status === null)).toBe(true);
    expect(o.findings).toEqual([]);
    expect(o.rotaPlannedThrough).toBeNull();
  });
});

describe("formatCapacityContext", () => {
  it("states the rules and the weeks, without names", () => {
    const h = history();
    const o = summariseCapacity(h.analytics, h.search, h.shifts, [plan(MON, 8, [1, 2])], [], staff, NOW);
    const text = formatCapacityContext(o);
    expect(text).toContain("does not prove one caused the other");
    expect(text).toContain("not booked jobs");
    expect(text).toContain(`${wk(-1)} to ${addDays(wk(-1), 6)} (past): 1001 visits`);
    expect(text).toContain("160h worked");
    expect(text).toContain("Findings:");
    expect(text).not.toContain("Anna");
  });
});
