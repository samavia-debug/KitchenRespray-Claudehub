import type { ShiftRow } from "./time-clock";
import type { StaffRef } from "./vehicles-summary";

const HOUR = 3_600_000;
const DAY = 86_400_000;

// Stated once here and repeated to Eleven, so every answer says what it counted.
export const CLOCK_RULES = {
  longShiftHours: 12,
  // Nobody works 16+ hours in a shift; these are almost always a forgotten
  // clock-out, so they are flagged and left out of the hour totals.
  implausibleHours: 16,
  veryShortHours: 0.25,
  regularMinDays: 5,
  regularWindowDays: 60,
  flaggedWindowDays: 30,
} as const;

export type StaffDetail = StaffRef & { role?: string; team?: string };
export type JobInfo = { job_id: string; title: string };
export type ClockShiftInput = Pick<ShiftRow, "shift_id" | "user_id" | "started_at" | "ended_at" | "job_id" | "start_source">;

// ---- Irish calendar maths. Weeks and months follow Dublin time, not UTC. ----

export function dublinDateKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

const keyToMs = (key: string) => Date.parse(`${key}T00:00:00Z`);
export const addDays = (key: string, n: number) => new Date(keyToMs(key) + n * DAY).toISOString().slice(0, 10);
const mondayOf = (key: string) => addDays(key, -((new Date(keyToMs(key)).getUTCDay() + 6) % 7));
const monthStart = (key: string) => `${key.slice(0, 7)}-01`;
const prevMonthRange = (key: string) => {
  const lastDay = addDays(monthStart(key), -1);
  return { from: monthStart(lastDay), to: lastDay };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export type PeriodKey = "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "last30";

export function periodRanges(today: string): { key: PeriodKey; label: string; from: string; to: string }[] {
  const monday = mondayOf(today);
  const lastMonth = prevMonthRange(today);
  return [
    { key: "thisWeek", label: "This week", from: monday, to: today },
    { key: "lastWeek", label: "Last week", from: addDays(monday, -7), to: addDays(monday, -1) },
    { key: "thisMonth", label: "This month", from: monthStart(today), to: today },
    { key: "lastMonth", label: "Last month", from: lastMonth.from, to: lastMonth.to },
    { key: "last30", label: "Last 30 days", from: addDays(today, -29), to: today },
  ];
}

// ---- Summary ----

export type PersonHours = {
  userId: number;
  name: string;
  role?: string;
  team?: string;
  former: boolean;
  days: number;
  shifts: number;
  hours: number;
  topJobs: { title: string; hours: number }[];
};

export type PeriodSummary = {
  key: PeriodKey;
  label: string;
  from: string;
  to: string;
  totalHours: number;
  people: PersonHours[];
  jobs: { title: string; hours: number; shifts: number; people: number }[];
};

export type FlaggedShift = { shiftId: string; name: string; startedAt: string; hours: number | null; reason: string };

export type ClockOverview = {
  generatedAt: string;
  today: string;
  periods: PeriodSummary[];
  clockedInNow: { name: string; since: string; job: string | null }[];
  flagged: FlaggedShift[];
  counts: { openTooLong: number; implausible: number; long: number; veryShort: number; adminEntered: number };
  regularStaff: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

type Prepared = ClockShiftInput & { startMs: number; hours: number | null; dateKey: string; counted: boolean };

export function summariseClock(shifts: ClockShiftInput[], jobs: JobInfo[], staff: StaffDetail[], nowMs: number = Date.now()): ClockOverview {
  const today = dublinDateKey(nowMs);
  const staffById = new Map(staff.map((s) => [s.userId, s]));
  const jobTitle = new Map(jobs.map((j) => [j.job_id, j.title]));
  const titleOf = (id: string | null) => (id ? jobTitle.get(id) ?? "Unknown job" : "No job");
  const nameOf = (id: number) => staffById.get(id)?.name ?? `Connecteam user ${id}`;

  const prepared: Prepared[] = shifts.map((s) => {
    const startMs = new Date(s.started_at).getTime();
    const hours = s.ended_at ? (new Date(s.ended_at).getTime() - startMs) / HOUR : null;
    return {
      ...s,
      startMs,
      hours,
      dateKey: dublinDateKey(startMs),
      counted: hours !== null && hours >= 0 && hours <= CLOCK_RULES.implausibleHours,
    };
  });

  // "Regular" staff clock in often enough that a quiet week means something.
  const regularFrom = nowMs - CLOCK_RULES.regularWindowDays * DAY;
  const daysByUser = new Map<number, Set<string>>();
  for (const s of prepared) {
    if (s.startMs < regularFrom || !s.counted) continue;
    const set = daysByUser.get(s.user_id) ?? new Set<string>();
    set.add(s.dateKey);
    daysByUser.set(s.user_id, set);
  }
  const regularIds = new Set(
    Array.from(daysByUser.entries()).filter(([id, days]) => days.size >= CLOCK_RULES.regularMinDays && !staffById.get(id)?.former).map(([id]) => id)
  );

  const periods: PeriodSummary[] = periodRanges(today).map((p) => {
    const inPeriod = prepared.filter((s) => s.counted && s.dateKey >= p.from && s.dateKey <= p.to);

    const people = new Map<number, { shifts: number; hours: number; days: Set<string>; jobs: Map<string, number> }>();
    const jobTotals = new Map<string, { hours: number; shifts: number; people: Set<number> }>();
    for (const s of inPeriod) {
      const hours = s.hours as number;
      const person = people.get(s.user_id) ?? { shifts: 0, hours: 0, days: new Set<string>(), jobs: new Map<string, number>() };
      person.shifts += 1;
      person.hours += hours;
      person.days.add(s.dateKey);
      const title = titleOf(s.job_id);
      person.jobs.set(title, (person.jobs.get(title) ?? 0) + hours);
      people.set(s.user_id, person);

      const job = jobTotals.get(title) ?? { hours: 0, shifts: 0, people: new Set<number>() };
      job.hours += hours;
      job.shifts += 1;
      job.people.add(s.user_id);
      jobTotals.set(title, job);
    }

    // Regular staff appear even with no hours, so "nobody this week" is visible.
    const ids = Array.from(new Set([...Array.from(people.keys()), ...Array.from(regularIds)]));
    const rows: PersonHours[] = ids.map((id) => {
      const person = people.get(id);
      const detail = staffById.get(id);
      return {
        userId: id,
        name: nameOf(id),
        role: detail?.role,
        team: detail?.team,
        former: !!detail?.former,
        days: person?.days.size ?? 0,
        shifts: person?.shifts ?? 0,
        hours: round1(person?.hours ?? 0),
        topJobs: person
          ? Array.from(person.jobs.entries())
              .map(([title, h]) => ({ title, hours: round1(h) }))
              .sort((a, b) => b.hours - a.hours)
              .slice(0, 3)
          : [],
      };
    });
    rows.sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));

    return {
      key: p.key,
      label: p.label,
      from: p.from,
      to: p.to,
      totalHours: round1(inPeriod.reduce((n, s) => n + (s.hours as number), 0)),
      people: rows,
      jobs: Array.from(jobTotals.entries())
        .map(([title, j]) => ({ title, hours: round1(j.hours), shifts: j.shifts, people: j.people.size }))
        .sort((a, b) => b.hours - a.hours),
    };
  });

  // ---- Things that look wrong, over the last 30 days ----
  const flaggedFrom = nowMs - CLOCK_RULES.flaggedWindowDays * DAY;
  const flagged: FlaggedShift[] = [];
  const counts = { openTooLong: 0, implausible: 0, long: 0, veryShort: 0, adminEntered: 0 };
  const clockedInNow: ClockOverview["clockedInNow"] = [];

  const recent = prepared.filter((s) => s.startMs >= flaggedFrom).sort((a, b) => b.startMs - a.startMs);
  for (const s of recent) {
    const name = nameOf(s.user_id);
    if (s.start_source === "admin") counts.adminEntered += 1;

    if (s.hours === null) {
      const openHours = (nowMs - s.startMs) / HOUR;
      if (openHours <= CLOCK_RULES.implausibleHours) {
        clockedInNow.push({ name, since: s.started_at, job: s.job_id ? titleOf(s.job_id) : null });
      } else {
        counts.openTooLong += 1;
        flagged.push({ shiftId: s.shift_id, name, startedAt: s.started_at, hours: null, reason: `never clocked out (open for ${Math.round(openHours)} hours)` });
      }
    } else if (s.hours > CLOCK_RULES.implausibleHours) {
      counts.implausible += 1;
      flagged.push({ shiftId: s.shift_id, name, startedAt: s.started_at, hours: round1(s.hours), reason: `recorded as ${round1(s.hours)} hours, probably a forgotten clock-out (left out of the totals)` });
    } else if (s.hours > CLOCK_RULES.longShiftHours) {
      counts.long += 1;
      flagged.push({ shiftId: s.shift_id, name, startedAt: s.started_at, hours: round1(s.hours), reason: `long shift of ${round1(s.hours)} hours` });
    } else if (s.hours >= 0 && s.hours < CLOCK_RULES.veryShortHours) {
      counts.veryShort += 1;
      flagged.push({ shiftId: s.shift_id, name, startedAt: s.started_at, hours: round1(s.hours), reason: `only ${Math.round(s.hours * 60)} minutes` });
    }
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    today,
    periods,
    clockedInNow,
    flagged: flagged.slice(0, 40),
    counts,
    regularStaff: regularIds.size,
  };
}

const fmtHours = (h: number) => `${h.toFixed(1)}h`;

/** Plain-text block for Eleven's prompt, with every figure already worked out. */
export function formatClockContext(o: ClockOverview, lastSyncedAt: string | null): string {
  const lines: string[] = [];
  lines.push(
    `Source: Connecteam time clock${lastSyncedAt ? `, last synced ${formatKey(dublinDateKey(new Date(lastSyncedAt).getTime()))}` : ""}. Today is ${formatKey(o.today)} (Irish time).`,
    `Definitions: hours are clock-in to clock-out and cover single closed shifts only. Weeks run Monday to Sunday and months are calendar months, in Irish time; a shift counts on the day it started. A shift longer than ${CLOCK_RULES.implausibleHours} hours is treated as a forgotten clock-out and left out of the totals (it is listed under "Looks wrong"). Regular staff are people who clocked in on ${CLOCK_RULES.regularMinDays}+ different days in the last ${CLOCK_RULES.regularWindowDays} days; they are listed even when they have no hours. A job here is a Connecteam time clock job type, not a customer job, so these figures show where time was spent, not which jobs were completed. There is no pay or overtime data.`
  );

  const labels = Object.fromEntries(o.periods.map((p) => [p.key, p]));
  lines.push(
    `Totals: ${o.periods.map((p) => `${p.label.toLowerCase()} (${formatKey(p.from)} to ${formatKey(p.to)}) ${fmtHours(p.totalHours)}`).join("; ")}.`
  );

  lines.push(`Hours per person (${o.regularStaff} regular staff plus anyone else who clocked in):`);
  // Anyone who appears in any period, so someone who only worked last month still shows.
  const everyone = new Map<number, PersonHours>();
  for (const p of o.periods) for (const person of p.people) if (!everyone.has(person.userId)) everyone.set(person.userId, person);
  for (const base of Array.from(everyone.values()).sort((a, b) => a.name.localeCompare(b.name))) {
    const cell = (key: PeriodKey) => {
      const r = labels[key].people.find((p) => p.userId === base.userId);
      return r && r.shifts > 0 ? `${fmtHours(r.hours)} over ${r.days}d` : "0.0h";
    };
    lines.push(
      `- ${base.name}${base.former ? " [former staff]" : ""}${base.role || base.team ? ` (${[base.role, base.team].filter(Boolean).join(", ")})` : ""}: this week ${cell("thisWeek")}; last week ${cell("lastWeek")}; this month ${cell("thisMonth")}; last month ${cell("lastMonth")}`
    );
  }

  const jobsLast30 = labels.last30.jobs;
  lines.push(
    `Hours by job type, last 30 days: ${jobsLast30.slice(0, 12).map((j) => `${j.title} ${fmtHours(j.hours)} (${j.shifts} shifts, ${j.people} people)`).join("; ") || "none"}.`
  );

  lines.push(
    `Clocked in right now: ${o.clockedInNow.length ? o.clockedInNow.map((c) => `${c.name}${c.job ? ` (${c.job})` : ""} since ${new Date(c.since).toISOString().slice(11, 16)} UTC`).join(", ") : "nobody"}.`
  );

  lines.push(
    `Looks wrong, last ${CLOCK_RULES.flaggedWindowDays} days: ${o.counts.openTooLong} never clocked out, ${o.counts.implausible} over ${CLOCK_RULES.implausibleHours} hours, ${o.counts.long} over ${CLOCK_RULES.longShiftHours} hours, ${o.counts.veryShort} under 15 minutes; ${o.counts.adminEntered} shifts were added by an admin rather than clocked on a phone. Details (newest first):`
  );
  lines.push(...(o.flagged.length ? o.flagged.map((f) => `- ${formatKey(dublinDateKey(new Date(f.startedAt).getTime()))} ${f.name}: ${f.reason}`) : ["- none"]));

  return lines.join("\n");
}
