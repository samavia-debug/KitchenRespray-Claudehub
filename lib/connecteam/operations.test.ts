import { describe, expect, it } from "vitest";
import { formatTodayContext, OPS_RULES, summarisePerson, summariseToday, type OpsLeave, type OpsScheduled, type OpsShift } from "./operations";
import type { StaffDetail } from "./time-clock-summary";

// Wednesday 7 Oct 2026, 10:00 UTC = 11:00 in Ireland (summer time).
const NOW = Date.parse("2026-10-07T10:00:00Z");
const staff: StaffDetail[] = [
  { userId: 1, name: "Anna Painter", former: false, role: "Technicians", team: "Kylemore" },
  { userId: 2, name: "Ben Sprayer", former: false, role: "Technicians", team: "Bray" },
  { userId: 3, name: "Cara Fitter", former: false },
  { userId: 4, name: "Dara Quiet", former: false },
  { userId: 5, name: "Eoin Gone", former: true },
  { userId: 6, name: "Fay Away", former: false },
];
const jobs = [{ job_id: "w", title: "Workshop" }, { job_id: "k", title: "Kylemore/ Collection" }];

const plan = (id: string, user: number, startUtc: string, over: Partial<OpsScheduled> = {}): OpsScheduled => ({
  shift_id: id,
  start_at: `2026-10-07T${startUtc}:00Z`,
  end_at: "2026-10-07T16:00:00Z",
  assigned_user_ids: [user],
  is_open: false,
  is_published: true,
  job_id: "k",
  tasks_total: 6,
  tasks_done: 0,
  ...over,
});
const clock = (id: string, user: number, startIso: string, endIso: string | null, link: string | null, job = "k"): OpsShift => ({
  shift_id: id,
  user_id: user,
  started_at: startIso,
  ended_at: endIso,
  job_id: job,
  scheduler_shift_id: link,
});

const scheduled: OpsScheduled[] = [
  plan("p1", 1, "08:00", { tasks_done: 2 }),
  plan("p2", 2, "08:00"),
  plan("p3", 3, "08:00", { job_id: "w" }),
  plan("p4", 4, "09:30"),
  plan("p5", 1, "12:00", { is_open: true, assigned_user_ids: [] }), // open shift: ignored
  plan("p6", 6, "08:00"), // Fay is on leave
  plan("draft", 3, "08:00", { is_published: false }), // unpublished: ignored
];
const shifts: OpsShift[] = [
  clock("c1", 1, "2026-10-07T07:55:00Z", null, "p1"), // 5 min early, still working
  clock("c2", 2, "2026-10-07T08:25:00Z", null, "p2"), // 25 min late, still working
  clock("c3", 3, "2026-10-07T08:05:00Z", "2026-10-07T09:50:00Z", "p3", "w"), // 5 min after: within the grace
  clock("old", 2, "2026-10-02T07:00:00Z", null, null), // forgotten last week
];
const leave: OpsLeave[] = [{ user_id: 6, leave_type: "Holidays", status: "approved", start_date: "2026-10-06", end_date: "2026-10-08" }];

describe("summariseToday", () => {
  const o = summariseToday(shifts, scheduled, jobs, staff, leave, NOW);
  const byName = Object.fromEntries(o.people.map((p) => [p.name, p]));

  it("works out each person's status for the day", () => {
    expect(byName["Anna Painter"].status).toBe("working");
    expect(byName["Ben Sprayer"].status).toBe("working");
    expect(byName["Cara Fitter"].status).toBe("finished");
    expect(byName["Dara Quiet"].status).toBe("not-clocked-in");
    expect(byName["Fay Away"].status).toBe("on-leave");
    expect(byName["Fay Away"].leaveType).toBe("Holidays");
    expect(byName["Eoin Gone"]).toBeUndefined(); // former staff who didn't clock in aren't listed
  });

  it("counts a late arrival only past the grace period", () => {
    expect(o.lateArrivals.map((l) => [l.name, l.minutes])).toEqual([["Ben Sprayer", 25]]);
    expect(byName["Cara Fitter"].lateMinutes).toBeNull();
    expect(byName["Anna Painter"].lateMinutes).toBeNull(); // early is never late
  });

  it("finds someone who was due in and hasn't arrived, with how long ago", () => {
    expect(o.notClockedIn).toHaveLength(1);
    expect(o.notClockedIn[0]).toMatchObject({ name: "Dara Quiet", minutesOver: 30, shiftOver: false });
  });

  it("calls it a missed shift once the scheduled shift has finished", () => {
    const late = summariseToday([], [plan("p9", 4, "01:00", { end_at: "2026-10-07T05:00:00Z" })], jobs, staff, [], NOW);
    expect(late.notClockedIn[0]).toMatchObject({ name: "Dara Quiet", shiftOver: true });
    expect(formatTodayContext(late)).toContain("a missed shift");
  });

  it("flags a shift left open from a previous day as a missing clock-out", () => {
    expect(o.missingClockOuts).toHaveLength(1);
    expect(o.missingClockOuts[0]).toMatchObject({ name: "Ben Sprayer", shiftId: "old" });
    expect(o.missingClockOuts[0].openHours).toBeGreaterThan(100);
  });

  it("totals the headline numbers", () => {
    expect(o.kpis).toMatchObject({ employees: 5, scheduledPeople: 4, onLeave: 1, workingNow: 2, lateArrivals: 1, notClockedIn: 1, missingClockOuts: 1, activeJobs: 2 });
    // Anna 2.08h + Ben 1.58h + Cara 1.75h, with open shifts counted up to now
    expect(o.kpis.hoursToday).toBeCloseTo(5.4, 1);
  });

  it("counts checklist items on today's published shifts only", () => {
    expect(o.kpis.tasksTotal).toBe(24); // p1, p2, p3 and p4. Fay's shift is left out because she is on leave
    expect(o.kpis.tasksDone).toBe(2);
  });

  it("groups people by job type, with who is there now", () => {
    const k = o.jobs.find((j) => j.title === "Kylemore/ Collection")!;
    expect(k.workingNow).toBe(2);
    expect(k.people.map((p) => p.name).sort()).toEqual(["Anna Painter", "Ben Sprayer"]);
  });

  it("produces text for Eleven that states the rules and the lists", () => {
    const text = formatTodayContext(o);
    expect(text).toContain(`more than ${OPS_RULES.lateGraceMinutes} minutes after the scheduled shift start`);
    expect(text).toContain("Ben Sprayer (25 min");
    expect(text).toContain("cannot be known");
  });
});

describe("summarisePerson", () => {
  const detail = summarisePerson(
    2,
    shifts,
    scheduled,
    jobs,
    staff,
    leave,
    [{ submitter_user_id: 2, submitted_at: "2026-09-20T09:00:00Z" }, { submitter_user_id: 1, submitted_at: "2026-09-21T09:00:00Z" }],
    [{ submitter_user_id: 2, status: null }, { submitter_user_id: 2, status: "Done" }],
    NOW
  );

  it("builds a 14 day view with late arrivals and the forgotten clock-out", () => {
    expect(detail.days).toHaveLength(OPS_RULES.detailDays);
    expect(detail.days[0]).toMatchObject({ date: "2026-10-07", lateMinutes: 25, note: "Clocked in" });
    expect(detail.days[0].hours).toBeCloseTo(1.6, 1); // still on shift: counted up to now, like the main table
    const old = detail.days.find((d) => d.date === "2026-10-02")!;
    expect(old.note).toBe("Never clocked out");
    expect(detail.totals.lateCount).toBe(1);
    expect(detail.totals.avgLateMinutes).toBe(25);
    expect(detail.totals.forgottenClockOuts30d).toBe(1);
  });

  it("includes this person's vehicle checks and open PPE requests only", () => {
    expect(detail.vehicleChecks60d.count).toBe(1);
    expect(detail.ppeOpen).toBe(1);
  });

  it("shows leave for someone who is off", () => {
    const fay = summarisePerson(6, shifts, scheduled, jobs, staff, leave, [], [], NOW);
    expect(fay.days[0].note).toBe("Holidays");
    expect(fay.upcomingLeave[0]).toMatchObject({ leaveType: "Holidays", endDate: "2026-10-08" });
  });
});
