import { describe, expect, it } from "vitest";
import { dateWindows, parseShifts } from "./time-clock";
import { addDays, dublinDateKey, formatClockContext, periodRanges, summariseClock, type ClockShiftInput, type StaffDetail } from "./time-clock-summary";
import { parseTimeOffRequest, type TimeOffRow } from "./time-off";
import { formatTimeOffContext, summariseTimeOff } from "./time-off-summary";
import type { TimeActivityUser, TimeOffRequest } from "./client";

describe("parseShifts", () => {
  const users: TimeActivityUser[] = [
    {
      userId: 7,
      shifts: [
        { id: "a", start: { timestamp: 1_791_000_000, source: { type: "mobile" } }, end: { timestamp: 1_791_028_800, source: { type: "mobile" } }, jobId: "j1", schedulerShiftId: "s1" },
        { id: "b", start: { timestamp: 1_791_100_000, source: { type: "admin" } }, end: { timestamp: null }, jobId: "" },
        { id: "c", start: { timestamp: null } },
      ],
    },
  ];

  it("keeps closed and still-open shifts and drops ones with no start", () => {
    const rows = parseShifts(1, users);
    expect(rows.map((r) => r.shift_id)).toEqual(["a", "b"]);
    expect(rows[0].ended_at).toBe(new Date(1_791_028_800 * 1000).toISOString());
    expect(rows[1].ended_at).toBeNull();
    expect(rows[1].job_id).toBeNull();
  });

  it("records who entered it, and nothing about attachments or location", () => {
    const rows = parseShifts(1, users);
    expect(rows[0].start_source).toBe("mobile");
    expect(rows[1].start_source).toBe("admin");
    expect(Object.keys(rows[0])).not.toContain("attachments");
    expect(Object.keys(rows[0])).not.toContain("location");
  });
});

describe("dateWindows", () => {
  const D = 86_400_000;
  const start = Date.parse("2025-09-01T00:00:00Z");

  it("covers the whole range in windows no wider than the limit, with no gaps", () => {
    const end = start + 419 * D;
    const windows = dateWindows(start, end, 60);
    expect(windows[0].startDate).toBe("2025-09-01");
    expect(windows[windows.length - 1].endDate).toBe(new Date(end).toISOString().slice(0, 10));
    for (const w of windows) {
      const span = (Date.parse(w.endDate) - Date.parse(w.startDate)) / D + 1;
      expect(span).toBeLessThanOrEqual(60);
    }
    for (let i = 1; i < windows.length; i++) expect(windows[i].startDate).toBe(windows[i - 1].endDate);
  });

  it("returns a single window for a short range", () => {
    expect(dateWindows(start, start + 10 * D, 60)).toEqual([{ startDate: "2025-09-01", endDate: "2025-09-11" }]);
  });
});

describe("Irish dates", () => {
  it("uses Irish local time, so a late-evening UTC shift in summer belongs to the next day", () => {
    expect(dublinDateKey(Date.parse("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(dublinDateKey(Date.parse("2026-01-15T23:30:00Z"))).toBe("2026-01-15");
  });

  it("works out the week and month boundaries for a Wednesday", () => {
    const p = Object.fromEntries(periodRanges("2026-10-07").map((r) => [r.key, r]));
    expect(p.thisWeek).toMatchObject({ from: "2026-10-05", to: "2026-10-07" });
    expect(p.lastWeek).toMatchObject({ from: "2026-09-28", to: "2026-10-04" });
    expect(p.thisMonth).toMatchObject({ from: "2026-10-01", to: "2026-10-07" });
    expect(p.lastMonth).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(p.last30).toMatchObject({ from: "2026-09-08", to: "2026-10-07" });
  });

  it("treats Monday as the start of the week even on a Sunday and across a year end", () => {
    expect(periodRanges("2026-10-11").find((r) => r.key === "thisWeek")!.from).toBe("2026-10-05");
    expect(periodRanges("2026-01-03").find((r) => r.key === "lastMonth")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

const NOW = Date.parse("2026-10-07T12:00:00Z"); // Wednesday
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const shift = (id: string, user: number, startIso: string, hours: number | null, over: Partial<ClockShiftInput> = {}): ClockShiftInput => ({
  shift_id: id,
  user_id: user,
  started_at: startIso,
  ended_at: hours === null ? null : new Date(Date.parse(startIso) + hours * 3_600_000).toISOString(),
  job_id: "workshop",
  start_source: "mobile",
  ...over,
});
const staff: StaffDetail[] = [
  { userId: 1, name: "Anna Painter", former: false, role: "Technician", team: "Dublin" },
  { userId: 2, name: "Ben Sprayer", former: false },
  { userId: 3, name: "Cara Gone", former: true },
  { userId: 4, name: "Dara Quiet", former: false },
];
const jobs = [{ job_id: "workshop", title: "Workshop" }, { job_id: "site", title: "On site" }];

describe("summariseClock", () => {
  // Anna: 8h on Mon 5 Oct and 8h on Tue 6 Oct. Plus a history of 6 earlier days so she counts as regular.
  const history = [30, 31, 32, 33, 34, 35].map((d, i) => shift(`h${i}`, 1, `2026-09-${String(40 - d).padStart(2, "0")}T08:00:00Z`, 8));
  // Dara worked six days in mid-September and nothing since.
  const daraHistory = [14, 15, 16, 17, 18, 19].map((d, i) => shift(`d${i}`, 4, `2026-09-${d}T08:00:00Z`, 8));
  const shifts = [
    ...history,
    ...daraHistory,
    shift("a1", 1, "2026-10-05T08:00:00Z", 8),
    shift("a2", 1, "2026-10-06T08:00:00Z", 8, { job_id: "site" }),
    shift("b-long", 2, "2026-10-05T07:00:00Z", 13),
    shift("b-bad", 2, "2026-10-02T07:00:00Z", 20),
    shift("b-open-now", 2, hoursAgo(3), null),
    shift("c-open-old", 3, hoursAgo(30), null, { start_source: "admin" }),
    shift("a-short", 1, "2026-10-01T09:00:00Z", 0.1),
  ];
  const o = summariseClock(shifts, jobs, staff, NOW);
  const week = o.periods.find((p) => p.key === "thisWeek")!;

  it("totals hours per person for the week and leaves out forgotten clock-outs", () => {
    const anna = week.people.find((p) => p.userId === 1)!;
    expect(anna.hours).toBe(16);
    expect(anna.days).toBe(2);
    expect(anna.role).toBe("Technician");
    const ben = week.people.find((p) => p.userId === 2)!;
    expect(ben.hours).toBe(13); // the 13h shift counts; the 20h one (2 Oct) is outside this week and excluded anyway
    expect(week.totalHours).toBe(29);
  });

  it("splits hours by job type", () => {
    expect(week.jobs.find((j) => j.title === "Workshop")!.hours).toBe(21);
    expect(week.jobs.find((j) => j.title === "On site")!.hours).toBe(8);
  });

  it("flags forgotten clock-outs and unusual shifts, with plain reasons", () => {
    expect(o.counts).toMatchObject({ openTooLong: 1, implausible: 1, long: 1, veryShort: 1, adminEntered: 1 });
    expect(o.flagged.some((f) => /never clocked out/.test(f.reason))).toBe(true);
    expect(o.flagged.some((f) => /left out of the totals/.test(f.reason))).toBe(true);
  });

  it("shows who is clocked in right now, not shifts that were just forgotten", () => {
    expect(o.clockedInNow.map((c) => c.name)).toEqual(["Ben Sprayer"]);
  });

  it("lists regular staff even with no hours this week, and not former staff", () => {
    const dara = week.people.find((p) => p.userId === 4)!;
    expect(dara).toBeDefined();
    expect(dara.hours).toBe(0);
    expect(dara.shifts).toBe(0);
    expect(week.people.find((p) => p.userId === 3)).toBeUndefined();
    expect(o.regularStaff).toBe(2); // Anna and Dara; Ben has too few clean days, Cara has left
  });

  it("produces text for Eleven that states the rules", () => {
    const text = formatClockContext(o, hoursAgo(1));
    expect(text).toContain("forgotten clock-out");
    expect(text).toContain("not which jobs were completed");
    expect(text).toContain("Anna Painter (Technician, Dublin)");
    expect(text).toContain("Looks wrong");
  });
});

const type = new Map([["t-hol", "Holidays"], ["t-sick", "Sick leave"]]);
const req = (over: Partial<TimeOffRequest>): TimeOffRequest => ({
  id: "r",
  userId: 1,
  policyTypeId: "t-hol",
  isAllDay: true,
  duration: { units: "days", amount: 1 },
  startDate: "2026-10-07",
  endDate: "2026-10-07",
  status: "approved",
  ...over,
});

describe("time off", () => {
  it("names the leave type and keeps no employee note", () => {
    const row = parseTimeOffRequest({ ...req({}), employeeNote: "private health detail" } as TimeOffRequest, type);
    expect(row.leave_type).toBe("Holidays");
    expect(Object.keys(row)).not.toContain("employee_note");
    expect(JSON.stringify(row)).not.toContain("private health detail");
    expect(parseTimeOffRequest(req({ policyTypeId: "unknown" }), type).leave_type).toBe("Other leave");
  });

  const rows: TimeOffRow[] = [
    parseTimeOffRequest(req({ id: "today", userId: 1, startDate: "2026-10-06", endDate: "2026-10-08", duration: { units: "days", amount: 3 } }), type),
    parseTimeOffRequest(req({ id: "soon", userId: 2, startDate: "2026-10-12", endDate: "2026-10-16", duration: { units: "days", amount: 5 } }), type),
    parseTimeOffRequest(req({ id: "later", userId: 1, startDate: "2026-12-21", endDate: "2026-12-24", duration: { units: "days", amount: 4 } }), type),
    parseTimeOffRequest(req({ id: "sick", userId: 2, policyTypeId: "t-sick", startDate: "2026-03-02", endDate: "2026-03-03", duration: { units: "days", amount: 2 } }), type),
    parseTimeOffRequest(req({ id: "half", userId: 2, isAllDay: false, startTime: "13:00:00", endTime: "17:00:00", startDate: "2026-04-10", endDate: "2026-04-10", duration: { units: "days", amount: 0.5 } }), type),
    parseTimeOffRequest(req({ id: "last-year", userId: 2, startDate: "2025-12-20", endDate: "2025-12-31", duration: { units: "days", amount: 8 } }), type),
    parseTimeOffRequest(req({ id: "pending", userId: 1, status: "pending", startDate: "2026-10-20", endDate: "2026-10-20" }), type),
  ];
  const o = summariseTimeOff(rows, [{ userId: 1, name: "Anna Painter", former: false }, { userId: 2, name: "Ben Sprayer", former: false }], Date.parse("2026-10-07T12:00:00Z"));

  it("finds who is off today, starting soon and further ahead, approved only", () => {
    expect(o.offToday.map((e) => e.requestId)).toEqual(["today"]);
    expect(o.startingSoon.map((e) => e.requestId)).toEqual(["soon"]);
    expect(o.upcoming.map((e) => e.requestId)).toEqual(["later"]);
    expect(o.notApproved.map((e) => e.requestId)).toEqual(["pending"]);
  });

  it("totals this year's days by person and type, counting by start year", () => {
    const ben = o.yearPeople.find((p) => p.userId === 2)!;
    expect(ben.byType["Holidays"]).toBe(5.5); // 5 days + a half day, not last year's 8
    expect(ben.byType["Sick leave"]).toBe(2);
    expect(ben.total).toBe(7.5);
    expect(o.yearTypes).toEqual(["Holidays", "Sick leave"]);
  });

  it("describes a part-day request with its times", () => {
    const text = formatTimeOffContext(o, null);
    expect(text).toContain("Off today (1): Anna Painter: Holidays");
    expect(text).toContain("employee notes are deliberately not held".replace("employee", "Employee"));
  });
});
