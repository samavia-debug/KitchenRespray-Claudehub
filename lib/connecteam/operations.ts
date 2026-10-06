import { addDays, dublinDateKey, formatKey, type JobInfo, type StaffDetail } from "./time-clock-summary";
import type { TimeOffRow } from "./time-off";

const MIN = 60_000;
const HOUR = 3_600_000;

// Named once, repeated to Eleven and shown on the page, so every figure says what it counted.
export const OPS_RULES = {
  lateGraceMinutes: 10,
  notClockedInGraceMinutes: 10,
  missingClockOutHours: 12,
  implausibleHours: 16,
  detailDays: 14,
} as const;

export type OpsShift = {
  shift_id: string;
  user_id: number;
  started_at: string;
  ended_at: string | null;
  job_id: string | null;
  scheduler_shift_id: string | null;
};

export type OpsScheduled = {
  shift_id: string;
  start_at: string;
  end_at: string;
  assigned_user_ids: number[];
  is_open: boolean;
  is_published: boolean;
  job_id: string | null;
  tasks_total: number;
  tasks_done: number;
};

export type OpsLeave = Pick<TimeOffRow, "user_id" | "leave_type" | "status" | "start_date" | "end_date">;

export type PersonStatus = "working" | "finished" | "not-clocked-in" | "scheduled" | "on-leave" | "not-scheduled";

export type TodayPerson = {
  userId: number;
  name: string;
  role?: string;
  team?: string;
  status: PersonStatus;
  scheduledStart: string | null;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  lateMinutes: number | null;
  hoursToday: number;
  job: string | null;
  tasksDone: number;
  tasksTotal: number;
  leaveType?: string;
};

export type TodayJob = {
  title: string;
  workingNow: number;
  hours: number;
  scheduledPeople: number;
  tasksDone: number;
  tasksTotal: number;
  people: { userId: number; name: string; since: string; hours: number; open: boolean }[];
};

export type MissingClockOut = { shiftId: string; userId: number; name: string; startedAt: string; openHours: number };

export type TodayOverview = {
  generatedAt: string;
  today: string;
  kpis: {
    employees: number;
    scheduledPeople: number;
    onLeave: number;
    workingNow: number;
    hoursToday: number;
    lateArrivals: number;
    notClockedIn: number;
    missingClockOuts: number;
    activeJobs: number;
    tasksDone: number;
    tasksTotal: number;
    checklistRate30d: number | null;
  };
  people: TodayPerson[];
  jobs: TodayJob[];
  lateArrivals: { userId: number; name: string; minutes: number; clockedInAt: string }[];
  notClockedIn: { userId: number; name: string; scheduledStart: string; minutesOver: number; shiftOver: boolean }[];
  missingClockOuts: MissingClockOut[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summariseToday(
  shifts: OpsShift[],
  scheduled: OpsScheduled[],
  jobs: JobInfo[],
  staff: StaffDetail[],
  leave: OpsLeave[],
  nowMs: number = Date.now()
): TodayOverview {
  const today = dublinDateKey(nowMs);
  const staffById = new Map(staff.map((s) => [s.userId, s]));
  const nameOf = (id: number) => staffById.get(id)?.name ?? `Connecteam user ${id}`;
  const jobTitle = new Map(jobs.map((j) => [j.job_id, j.title.trim()]));
  const titleOf = (id: string | null) => (id ? jobTitle.get(id) ?? "Unknown job" : "No job");
  const scheduledById = new Map(scheduled.map((s) => [s.shift_id, s]));
  const keyOf = (iso: string) => dublinDateKey(new Date(iso).getTime());

  const todaysClock = shifts.filter((s) => keyOf(s.started_at) === today);
  const onLeaveToday = new Map<number, string>();
  for (const l of leave) {
    if (l.status === "approved" && l.start_date <= today && l.end_date >= today) onLeaveToday.set(l.user_id, l.leave_type);
  }

  // A shift whose assignees are all on approved leave is a rota that hasn't been tidied up,
  // so it isn't counted as expected work.
  const todaysRota = scheduled.filter(
    (s) => s.is_published && !s.is_open && keyOf(s.start_at) === today && !s.assigned_user_ids.every((id) => onLeaveToday.has(id))
  );

  // Open shifts: still going (<= 16h), or forgotten (older than that, or half-day gone by 12h on today's).
  const missing: MissingClockOut[] = [];
  const workingNowIds = new Set<number>();
  for (const s of shifts) {
    if (s.ended_at) continue;
    const openHours = (nowMs - new Date(s.started_at).getTime()) / HOUR;
    const isToday = keyOf(s.started_at) === today;
    if (openHours > OPS_RULES.implausibleHours || (isToday && openHours > OPS_RULES.missingClockOutHours)) {
      missing.push({ shiftId: s.shift_id, userId: s.user_id, name: nameOf(s.user_id), startedAt: s.started_at, openHours: round1(openHours) });
    } else if (isToday) {
      workingNowIds.add(s.user_id);
    }
  }
  missing.sort((a, b) => b.openHours - a.openHours);


  const hoursOf = (s: OpsShift): number => {
    const start = new Date(s.started_at).getTime();
    const end = s.ended_at ? new Date(s.ended_at).getTime() : nowMs;
    const h = (end - start) / HOUR;
    return h >= 0 && h <= OPS_RULES.implausibleHours ? h : 0;
  };

  const lateList: TodayOverview["lateArrivals"] = [];
  const lateByUser = new Map<number, number>();
  for (const s of todaysClock) {
    const plan = s.scheduler_shift_id ? scheduledById.get(s.scheduler_shift_id) : undefined;
    if (!plan) continue;
    const minutes = Math.round((new Date(s.started_at).getTime() - new Date(plan.start_at).getTime()) / MIN);
    if (minutes > OPS_RULES.lateGraceMinutes && !lateByUser.has(s.user_id)) {
      lateByUser.set(s.user_id, minutes);
      lateList.push({ userId: s.user_id, name: nameOf(s.user_id), minutes, clockedInAt: s.started_at });
    }
  }
  lateList.sort((a, b) => b.minutes - a.minutes);

  // ---- One row per current staff member, plus anyone else who clocked in today ----
  const ids = new Set<number>(staff.filter((s) => !s.former).map((s) => s.userId));
  for (const s of todaysClock) ids.add(s.user_id);

  const people: TodayPerson[] = [];
  const notClockedIn: TodayOverview["notClockedIn"] = [];
  for (const id of Array.from(ids)) {
    const detail = staffById.get(id);
    const mine = todaysClock.filter((s) => s.user_id === id).sort((a, b) => a.started_at.localeCompare(b.started_at));
    const plans = todaysRota.filter((p) => p.assigned_user_ids.includes(id)).sort((a, b) => a.start_at.localeCompare(b.start_at));
    const tasksTotal = plans.reduce((n, p) => n + p.tasks_total, 0);
    const tasksDone = plans.reduce((n, p) => n + p.tasks_done, 0);
    const leaveType = onLeaveToday.get(id);

    let status: PersonStatus;
    if (mine.length > 0) status = mine.some((s) => !s.ended_at && workingNowIds.has(id)) ? "working" : "finished";
    else if (leaveType) status = "on-leave";
    else if (plans.length > 0) {
      const start = new Date(plans[0].start_at).getTime();
      status = nowMs > start + OPS_RULES.notClockedInGraceMinutes * MIN ? "not-clocked-in" : "scheduled";
      if (status === "not-clocked-in") {
        notClockedIn.push({
          userId: id,
          name: nameOf(id),
          scheduledStart: plans[0].start_at,
          minutesOver: Math.round((nowMs - start) / MIN),
          // The shift has already finished, so this is a missed shift, not a late start.
          shiftOver: nowMs > new Date(plans[0].end_at).getTime(),
        });
      }
    } else status = "not-scheduled";

    const last = mine.length ? mine[mine.length - 1] : null;
    people.push({
      userId: id,
      name: nameOf(id),
      role: detail?.role,
      team: detail?.team,
      status,
      scheduledStart: plans[0]?.start_at ?? null,
      clockedInAt: mine[0]?.started_at ?? null,
      clockedOutAt: status === "finished" && last?.ended_at ? last.ended_at : null,
      lateMinutes: lateByUser.get(id) ?? null,
      hoursToday: round1(mine.reduce((n, s) => n + hoursOf(s), 0)),
      job: last ? titleOf(last.job_id) : plans[0] ? titleOf(plans[0].job_id) : null,
      tasksDone,
      tasksTotal,
      leaveType,
    });
  }

  const order: Record<PersonStatus, number> = { "not-clocked-in": 0, working: 1, scheduled: 2, finished: 3, "on-leave": 4, "not-scheduled": 5 };
  people.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  notClockedIn.sort((a, b) => b.minutesOver - a.minutesOver);

  // ---- Job types today ----
  const jobMap = new Map<string, TodayJob>();
  const jobFor = (title: string) => {
    const j = jobMap.get(title) ?? { title, workingNow: 0, hours: 0, scheduledPeople: 0, tasksDone: 0, tasksTotal: 0, people: [] };
    jobMap.set(title, j);
    return j;
  };
  for (const s of todaysClock) {
    const j = jobFor(titleOf(s.job_id));
    const open = !s.ended_at && workingNowIds.has(s.user_id);
    const hours = hoursOf(s);
    j.hours += hours;
    if (open) j.workingNow += 1;
    j.people.push({ userId: s.user_id, name: nameOf(s.user_id), since: s.started_at, hours: round1(hours), open });
  }
  for (const p of todaysRota) {
    const j = jobFor(titleOf(p.job_id));
    j.scheduledPeople += p.assigned_user_ids.length;
    j.tasksDone += p.tasks_done;
    j.tasksTotal += p.tasks_total;
  }
  const jobRows = Array.from(jobMap.values())
    .map((j) => ({ ...j, hours: round1(j.hours) }))
    .sort((a, b) => b.hours - a.hours || b.scheduledPeople - a.scheduledPeople);

  // How often the checklist is ticked at all, over the last 30 days of finished shifts.
  const since30 = nowMs - 30 * 24 * HOUR;
  const finished30 = scheduled.filter((s) => s.is_published && new Date(s.end_at).getTime() < nowMs && new Date(s.start_at).getTime() >= since30);
  const total30 = finished30.reduce((n, s) => n + s.tasks_total, 0);
  const done30 = finished30.reduce((n, s) => n + s.tasks_done, 0);

  const currentStaff = staff.filter((s) => !s.former);
  return {
    generatedAt: new Date(nowMs).toISOString(),
    today,
    kpis: {
      employees: currentStaff.length,
      scheduledPeople: new Set(todaysRota.flatMap((p) => p.assigned_user_ids)).size,
      onLeave: currentStaff.filter((s) => onLeaveToday.has(s.userId)).length,
      workingNow: people.filter((p) => p.status === "working").length,
      // Totalled from the exact shifts, not from the per-person rounded figures, so it can't drift.
      hoursToday: round1(todaysClock.reduce((n, s) => n + hoursOf(s), 0)),
      lateArrivals: lateList.length,
      notClockedIn: notClockedIn.length,
      missingClockOuts: missing.length,
      activeJobs: new Set(todaysClock.map((s) => titleOf(s.job_id))).size,
      tasksDone: todaysRota.reduce((n, p) => n + p.tasks_done, 0),
      tasksTotal: todaysRota.reduce((n, p) => n + p.tasks_total, 0),
      checklistRate30d: total30 > 0 ? Math.round((done30 / total30) * 100) : null,
    },
    people,
    jobs: jobRows,
    lateArrivals: lateList,
    notClockedIn,
    missingClockOuts: missing,
  };
}

// ---- One person, last 14 days ----

export type PersonDay = {
  date: string;
  scheduledStart: string | null;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  hours: number;
  lateMinutes: number | null;
  job: string | null;
  tasksDone: number;
  tasksTotal: number;
  note: string;
};

export type PersonDetail = {
  userId: number;
  name: string;
  role?: string;
  team?: string;
  days: PersonDay[];
  totals: { daysWorked: number; hours: number; avgHoursPerDay: number | null; lateCount: number; avgLateMinutes: number | null; forgottenClockOuts30d: number };
  upcomingLeave: { leaveType: string; startDate: string; endDate: string }[];
  vehicleChecks60d: { count: number; lastDate: string | null };
  ppeOpen: number;
};

export function summarisePerson(
  userId: number,
  shifts: OpsShift[],
  scheduled: OpsScheduled[],
  jobs: JobInfo[],
  staff: StaffDetail[],
  leave: OpsLeave[],
  vehicleChecks: { submitter_user_id: number | null; submitted_at: string }[],
  ppe: { submitter_user_id: number | null; status: string | null }[],
  nowMs: number = Date.now()
): PersonDetail {
  const today = dublinDateKey(nowMs);
  const detail = staff.find((s) => s.userId === userId);
  const jobTitle = new Map(jobs.map((j) => [j.job_id, j.title.trim()]));
  const scheduledById = new Map(scheduled.map((s) => [s.shift_id, s]));
  const keyOf = (iso: string) => dublinDateKey(new Date(iso).getTime());
  const mineShifts = shifts.filter((s) => s.user_id === userId);
  const mineRota = scheduled.filter((s) => s.is_published && s.assigned_user_ids.includes(userId));
  const myLeave = leave.filter((l) => l.user_id === userId && l.status === "approved");

  const days: PersonDay[] = [];
  const lateMinutesAll: number[] = [];
  for (let i = 0; i < OPS_RULES.detailDays; i++) {
    const date = addDays(today, -i);
    const clock = mineShifts.filter((s) => keyOf(s.started_at) === date).sort((a, b) => a.started_at.localeCompare(b.started_at));
    const plans = mineRota.filter((p) => keyOf(p.start_at) === date).sort((a, b) => a.start_at.localeCompare(b.start_at));
    const onLeave = myLeave.find((l) => l.start_date <= date && l.end_date >= date);

    let late: number | null = null;
    for (const s of clock) {
      const plan = s.scheduler_shift_id ? scheduledById.get(s.scheduler_shift_id) : undefined;
      if (plan) {
        late = Math.round((new Date(s.started_at).getTime() - new Date(plan.start_at).getTime()) / MIN);
        break;
      }
    }
    if (late !== null && late > OPS_RULES.lateGraceMinutes) lateMinutesAll.push(late);

    // Same rule as the main table: a shift still open counts up to now, unless it has been
    // open so long it is clearly a forgotten clock-out.
    const hours = clock.reduce((n, s) => {
      const end = s.ended_at ? new Date(s.ended_at).getTime() : nowMs;
      const h = (end - new Date(s.started_at).getTime()) / HOUR;
      return h >= 0 && h <= OPS_RULES.implausibleHours ? n + h : n;
    }, 0);
    const last = clock[clock.length - 1];
    const dow = new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay();

    let note = "";
    if (clock.length && !last.ended_at) note = date === today ? "Clocked in" : "Never clocked out";
    else if (clock.length) note = "";
    else if (onLeave) note = onLeave.leave_type;
    else if (plans.length) note = "Scheduled, no clock-in";
    else if (dow === 0 || dow === 6) note = "Weekend";
    else note = "Not scheduled";

    days.push({
      date,
      scheduledStart: plans[0]?.start_at ?? null,
      clockedInAt: clock[0]?.started_at ?? null,
      clockedOutAt: last?.ended_at ?? null,
      hours: round1(hours),
      lateMinutes: late,
      job: last ? jobTitle.get(last.job_id ?? "") ?? "Unknown job" : plans[0]?.job_id ? jobTitle.get(plans[0].job_id) ?? null : null,
      tasksDone: plans.reduce((n, p) => n + p.tasks_done, 0),
      tasksTotal: plans.reduce((n, p) => n + p.tasks_total, 0),
      note,
    });
  }

  const worked = days.filter((d) => d.hours > 0);
  const since30 = nowMs - 30 * 24 * HOUR;
  const forgotten = mineShifts.filter((s) => {
    if (new Date(s.started_at).getTime() < since30) return false;
    if (!s.ended_at) return (nowMs - new Date(s.started_at).getTime()) / HOUR > OPS_RULES.implausibleHours;
    return (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / HOUR > OPS_RULES.implausibleHours;
  }).length;

  const checks = vehicleChecks.filter((v) => v.submitter_user_id === userId && new Date(v.submitted_at).getTime() >= nowMs - 60 * 24 * HOUR);

  return {
    userId,
    name: detail?.name ?? `Connecteam user ${userId}`,
    role: detail?.role,
    team: detail?.team,
    days,
    totals: {
      daysWorked: worked.length,
      hours: round1(worked.reduce((n, d) => n + d.hours, 0)),
      avgHoursPerDay: worked.length ? round1(worked.reduce((n, d) => n + d.hours, 0) / worked.length) : null,
      lateCount: lateMinutesAll.length,
      avgLateMinutes: lateMinutesAll.length ? Math.round(lateMinutesAll.reduce((n, m) => n + m, 0) / lateMinutesAll.length) : null,
      forgottenClockOuts30d: forgotten,
    },
    upcomingLeave: myLeave
      .filter((l) => l.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .slice(0, 5)
      .map((l) => ({ leaveType: l.leave_type, startDate: l.start_date, endDate: l.end_date })),
    vehicleChecks60d: {
      count: checks.length,
      lastDate: checks.length ? checks.map((c) => c.submitted_at).sort().slice(-1)[0] : null,
    },
    ppeOpen: ppe.filter((p) => p.submitter_user_id === userId && p.status !== "Done").length,
  };
}

const fmtHours = (h: number) => `${h.toFixed(1)}h`;
const fmtTime = (iso: string) => new Date(iso).toISOString().slice(11, 16);

/** Plain-text block for Eleven's prompt. */
export function formatTodayContext(o: TodayOverview): string {
  const k = o.kpis;
  const lines: string[] = [];
  lines.push(
    `Source: Connecteam time clock and rota, data as of ${new Date(o.generatedAt).toISOString().slice(11, 16)} UTC. Today is ${formatKey(o.today)} (Irish time; Irish time is UTC+0 in winter and UTC+1 in summer).`,
    `Definitions: "late" means clocked in more than ${OPS_RULES.lateGraceMinutes} minutes after the scheduled shift start; "not clocked in" means a scheduled start passed more than ${OPS_RULES.notClockedInGraceMinutes} minutes ago with no clock-in and no approved leave; "missing clock-out" means a shift still open after ${OPS_RULES.implausibleHours} hours, or after ${OPS_RULES.missingClockOutHours} hours for one that started today. Hours today include time so far on open shifts. Tasks are the checklist items on today's scheduled shifts; only about ${k.checklistRate30d ?? "an unknown share"}% of checklist items are ever ticked, so a low "done" figure means the checklist isn't being used, not that the work wasn't done. The clock stores no location, so "on a job site" cannot be known: job types show where people clocked in, nothing more.`
  );
  lines.push(
    `Today so far: ${k.employees} current staff; ${k.scheduledPeople} scheduled; ${k.workingNow} working now; ${k.onLeave} on leave; ${fmtHours(k.hoursToday)} worked; ${k.lateArrivals} late arrivals; ${k.notClockedIn} scheduled but not clocked in; ${k.missingClockOuts} missing clock-outs; ${k.activeJobs} job types in use; ${k.tasksDone} of ${k.tasksTotal} checklist items done.`
  );
  lines.push(
    `Late today: ${o.lateArrivals.map((l) => `${l.name} (${l.minutes} min, clocked in ${fmtTime(l.clockedInAt)} UTC)`).join("; ") || "nobody"}.`,
    `Scheduled but not clocked in: ${o.notClockedIn.map((n) => `${n.name} (due ${fmtTime(n.scheduledStart)} UTC, ${n.minutesOver} min ago${n.shiftOver ? ", shift already over, so a missed shift" : ""})`).join("; ") || "nobody"}.`,
    `Missing clock-outs: ${o.missingClockOuts.map((m) => `${m.name} (started ${formatKey(dublinDateKey(new Date(m.startedAt).getTime()))} ${fmtTime(m.startedAt)} UTC, open ${m.openHours}h)`).join("; ") || "none"}.`
  );
  lines.push("Everyone today (status first):");
  for (const p of o.people) {
    const bits = [
      p.status.replace("-", " "),
      p.scheduledStart ? `scheduled ${fmtTime(p.scheduledStart)} UTC` : null,
      p.clockedInAt ? `in ${fmtTime(p.clockedInAt)} UTC` : null,
      p.clockedOutAt ? `out ${fmtTime(p.clockedOutAt)} UTC` : null,
      p.lateMinutes !== null ? `${p.lateMinutes} min late` : null,
      p.hoursToday > 0 ? fmtHours(p.hoursToday) : null,
      p.job ? p.job : null,
      p.tasksTotal ? `checklist ${p.tasksDone}/${p.tasksTotal}` : null,
      p.leaveType ?? null,
    ].filter(Boolean);
    lines.push(`- ${p.name}${p.role || p.team ? ` (${[p.role, p.team].filter(Boolean).join(", ")})` : ""}: ${bits.join("; ")}`);
  }
  lines.push(`Job types today: ${o.jobs.map((j) => `${j.title} ${j.workingNow} working now, ${fmtHours(j.hours)}, ${j.scheduledPeople} scheduled, checklist ${j.tasksDone}/${j.tasksTotal}`).join("; ") || "none"}.`);
  return lines.join("\n");
}
