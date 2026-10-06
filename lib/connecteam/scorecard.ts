import { addDays, dublinDateKey, formatKey, mondayOf, type StaffDetail } from "./time-clock-summary";
import { OPS_RULES, type OpsScheduled, type OpsShift } from "./operations";

const HOUR = 3_600_000;
const DAY = 86_400_000;

// Stated once, shown on the page and given to Eleven, so every figure says what it counted.
export const SCORE_RULES = {
  weeks: 8,
  // A "driver" is anyone who has done at least one vehicle inspection in this many days.
  driverWindowDays: 90,
  ppeFastHours: 48,
  // Thresholds that turn a figure amber or red.
  amber: { latePct: 20, inspectionPct: 75, safetyMissingPct: 15, ppeDonePct: 85 },
  red: { latePct: 35, inspectionPct: 50, safetyMissingPct: 35, ppeDonePct: 60 },
} as const;

export type GroupBy = "branch" | "team" | "department";

export type ScoreInspection = {
  submitter_user_id: number | null;
  submitted_at: string;
  safety_equipment_ok: boolean | null;
  condition_ok: boolean | null;
  defects: string[];
};

export type ScorePpe = {
  submitter_user_id: number | null;
  submitted_at: string;
  status: string | null;
  status_updated_at: string | null;
};

export type WeekMetrics = {
  from: string;
  to: string;
  partial: boolean;
  worked: number;
  hours: number;
  hoursPerPerson: number | null;
  clockIns: number;
  linkedClockIns: number;
  late: number;
  latePct: number | null;
  forgottenClockOuts: number;
  drivers: number;
  inspected: number;
  inspectionPct: number | null;
  reports: number;
  safetyMissing: number;
  safetyMissingPct: number | null;
  defectReports: number;
  ppeRequests: number;
  ppeSettled: number;
  ppeDoneFast: number;
  ppeDonePct: number | null;
  ppeOpen: number;
};

export type GroupScorecard = { name: string; headcount: number; weeks: WeekMetrics[] };

export type ScorecardOverview = {
  generatedAt: string;
  today: string;
  groupBy: GroupBy;
  weeks: { from: string; to: string; partial: boolean }[];
  everyone: GroupScorecard;
  groups: GroupScorecard[];
};

export type Level = "good" | "amber" | "red";

/** Which way a figure is bad: high late rates are bad, low inspection rates are bad. */
export function levelFor(metric: "latePct" | "inspectionPct" | "safetyMissingPct" | "ppeDonePct", value: number | null): Level {
  if (value === null) return "good";
  const { amber, red } = SCORE_RULES;
  if (metric === "latePct" || metric === "safetyMissingPct") return value >= red[metric] ? "red" : value >= amber[metric] ? "amber" : "good";
  return value <= red[metric] ? "red" : value <= amber[metric] ? "amber" : "good";
}

export function splitList(value: string | undefined): string[] {
  return value ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];
}

const NOT_SET = "Not set";
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

type PersonWeek = {
  hours: number;
  clockIns: number;
  linked: number;
  late: number;
  forgotten: number;
  inspections: number;
  reports: number;
  safetyMissing: number;
  defectReports: number;
  ppe: number;
  ppeSettled: number;
  ppeFast: number;
  ppeOpen: number;
};

const blank = (): PersonWeek => ({ hours: 0, clockIns: 0, linked: 0, late: 0, forgotten: 0, inspections: 0, reports: 0, safetyMissing: 0, defectReports: 0, ppe: 0, ppeSettled: 0, ppeFast: 0, ppeOpen: 0 });

export function weekRanges(today: string, full: number = SCORE_RULES.weeks): { from: string; to: string; partial: boolean }[] {
  const thisMonday = mondayOf(today);
  const weeks = [{ from: thisMonday, to: today, partial: true }];
  for (let i = 1; i <= full; i++) {
    const from = addDays(thisMonday, -7 * i);
    weeks.push({ from, to: addDays(from, 6), partial: false });
  }
  return weeks;
}

export function summariseScorecard(
  groupBy: GroupBy,
  shifts: OpsShift[],
  scheduled: OpsScheduled[],
  inspections: ScoreInspection[],
  ppe: ScorePpe[],
  staff: StaffDetail[],
  nowMs: number = Date.now()
): ScorecardOverview {
  const today = dublinDateKey(nowMs);
  const weeks = weekRanges(today);
  const keyOf = (iso: string) => dublinDateKey(new Date(iso).getTime());
  const weekOf = (key: string) => weeks.findIndex((w) => key >= w.from && key <= w.to);

  const scheduledById = new Map(scheduled.map((s) => [s.shift_id, s]));
  const people = new Map<number, PersonWeek[]>();
  const get = (id: number, w: number) => {
    let arr = people.get(id);
    if (!arr) {
      arr = weeks.map(blank);
      people.set(id, arr);
    }
    return arr[w];
  };

  for (const s of shifts) {
    const w = weekOf(keyOf(s.started_at));
    if (w < 0) continue;
    const p = get(s.user_id, w);
    const start = new Date(s.started_at).getTime();
    if (s.ended_at) {
      const hours = (new Date(s.ended_at).getTime() - start) / HOUR;
      if (hours > OPS_RULES.implausibleHours) p.forgotten += 1;
      else if (hours >= 0) {
        p.hours += hours;
        p.clockIns += 1;
      }
    } else if ((nowMs - start) / HOUR > OPS_RULES.implausibleHours) {
      p.forgotten += 1;
    } else {
      p.clockIns += 1; // still on shift
    }

    const plan = s.scheduler_shift_id ? scheduledById.get(s.scheduler_shift_id) : undefined;
    if (plan) {
      p.linked += 1;
      if ((start - new Date(plan.start_at).getTime()) / 60_000 > OPS_RULES.lateGraceMinutes) p.late += 1;
    }
  }

  for (const r of inspections) {
    if (r.submitter_user_id === null) continue;
    const w = weekOf(keyOf(r.submitted_at));
    if (w < 0) continue;
    const p = get(r.submitter_user_id, w);
    p.inspections += 1;
    p.reports += 1;
    if (r.safety_equipment_ok === false) p.safetyMissing += 1;
    if (r.defects.length > 0 || r.condition_ok === false) p.defectReports += 1;
  }

  const fastMs = SCORE_RULES.ppeFastHours * HOUR;
  for (const r of ppe) {
    if (r.submitter_user_id === null) continue;
    const w = weekOf(keyOf(r.submitted_at));
    if (w < 0) continue;
    const p = get(r.submitter_user_id, w);
    const submitted = new Date(r.submitted_at).getTime();
    p.ppe += 1;
    if (r.status !== "Done") p.ppeOpen += 1;
    if (nowMs - submitted >= fastMs) {
      p.ppeSettled += 1;
      if (r.status === "Done" && r.status_updated_at && new Date(r.status_updated_at).getTime() - submitted <= fastMs) p.ppeFast += 1;
    }
  }

  const driverFrom = nowMs - SCORE_RULES.driverWindowDays * DAY;
  const driverIds = new Set(inspections.filter((r) => r.submitter_user_id !== null && new Date(r.submitted_at).getTime() >= driverFrom).map((r) => r.submitter_user_id as number));

  const aggregate = (name: string, memberIds: number[], headcount: number): GroupScorecard => ({
    name,
    headcount,
    weeks: weeks.map((range, w) => {
      const rows = memberIds.map((id) => ({ id, p: people.get(id)?.[w] ?? blank() }));
      const worked = rows.filter((r) => r.p.clockIns > 0);
      const drivers = worked.filter((r) => driverIds.has(r.id));
      const sum = (f: (p: PersonWeek) => number) => rows.reduce((n, r) => n + f(r.p), 0);
      const hours = sum((p) => p.hours);
      const linked = sum((p) => p.linked);
      const late = sum((p) => p.late);
      const reports = sum((p) => p.reports);
      const safetyMissing = sum((p) => p.safetyMissing);
      const settled = sum((p) => p.ppeSettled);
      const fast = sum((p) => p.ppeFast);
      return {
        from: range.from,
        to: range.to,
        partial: range.partial,
        worked: worked.length,
        hours: round1(hours),
        hoursPerPerson: worked.length ? round1(hours / worked.length) : null,
        clockIns: sum((p) => p.clockIns),
        linkedClockIns: linked,
        late,
        latePct: pct(late, linked),
        forgottenClockOuts: sum((p) => p.forgotten),
        drivers: drivers.length,
        inspected: drivers.filter((r) => r.p.inspections > 0).length,
        inspectionPct: pct(drivers.filter((r) => r.p.inspections > 0).length, drivers.length),
        reports,
        safetyMissing,
        safetyMissingPct: pct(safetyMissing, reports),
        defectReports: sum((p) => p.defectReports),
        ppeRequests: sum((p) => p.ppe),
        ppeSettled: settled,
        ppeDoneFast: fast,
        ppeDonePct: pct(fast, settled),
        ppeOpen: sum((p) => p.ppeOpen),
      };
    }),
  });

  // ---- Membership. Someone in two teams counts in both. ----
  const current = staff.filter((s) => !s.former);
  const valuesOf = (s: StaffDetail) => {
    const list = splitList(groupBy === "branch" ? s.branch : groupBy === "team" ? s.team : s.department);
    return list.length ? list : [NOT_SET];
  };
  const members = new Map<string, number[]>();
  for (const s of current) for (const v of valuesOf(s)) members.set(v, [...(members.get(v) ?? []), s.userId]);

  const groups = Array.from(members.entries())
    .map(([name, ids]) => aggregate(name, ids, ids.length))
    .sort((a, b) => (a.name === NOT_SET ? 1 : b.name === NOT_SET ? -1 : b.headcount - a.headcount || a.name.localeCompare(b.name)));

  // Everyone who appears in the data, including people who have left but worked in these weeks.
  const everyoneIds = Array.from(new Set([...current.map((s) => s.userId), ...Array.from(people.keys())]));
  return {
    generatedAt: new Date(nowMs).toISOString(),
    today,
    groupBy,
    weeks,
    everyone: aggregate("Whole company", everyoneIds, current.length),
    groups,
  };
}

// ---- Text for Eleven ----

const show = (v: number | null, unit = "%") => (v === null ? "n/a" : `${v}${unit}`);

export function formatScorecardContext(sections: ScorecardOverview[]): string {
  if (sections.length === 0) return "";
  const first = sections[0];
  const last = first.weeks[1]; // the latest full week
  const prev = first.weeks[2];
  const lines: string[] = [
    `Source: Connecteam time clock, rota, vehicle inspections and PPE requests, grouped by each person's Connecteam branch, team or department. Weeks run Monday to Sunday in Irish time. The latest full week is ${formatKey(last.from)} to ${formatKey(last.to)}; the week before is ${formatKey(prev.from)} to ${formatKey(prev.to)}. Someone in two teams counts in both.`,
    `Definitions: late % = clock-ins more than ${OPS_RULES.lateGraceMinutes} minutes after the scheduled start, as a share of clock-ins that were scheduled. Vehicle check rate = of the people who worked that week and have done a vehicle inspection in the last ${SCORE_RULES.driverWindowDays} days (the "drivers"), the share who did one that week. Safety equipment missing % = of vehicle inspection reports, the share saying the extinguisher or first aid kit was missing. PPE closed fast % = of PPE requests at least ${SCORE_RULES.ppeFastHours} hours old, the share a manager marked Done within ${SCORE_RULES.ppeFastHours} hours. Forgotten clock-outs = shifts open or recorded over ${OPS_RULES.implausibleHours} hours. Amber or red marks a figure that needs attention (late 20%/35%, vehicle check below 75%/50%, safety equipment missing 15%/35%, PPE closed fast below 85%/60%).`,
  ];
  for (const sec of sections) {
    lines.push(`By ${sec.groupBy}, latest full week (previous week in brackets):`);
    for (const g of [sec.everyone, ...sec.groups]) {
      const a = g.weeks[1];
      const b = g.weeks[2];
      lines.push(
        `- ${g.name} (${g.headcount} staff): ${a.worked} worked, ${a.hours}h (${show(a.hoursPerPerson, "h")} each) [${b.hours}h]; late ${show(a.latePct)} of ${a.linkedClockIns} scheduled clock-ins [${show(b.latePct)}]; forgotten clock-outs ${a.forgottenClockOuts} [${b.forgottenClockOuts}]; vehicle check ${a.inspected} of ${a.drivers} drivers = ${show(a.inspectionPct)} [${show(b.inspectionPct)}]; safety equipment missing ${show(a.safetyMissingPct)} of ${a.reports} reports [${show(b.safetyMissingPct)}]; PPE closed fast ${show(a.ppeDonePct)} of ${a.ppeSettled} [${show(b.ppeDonePct)}], ${a.ppeOpen} still open`
      );
    }
  }
  return lines.join("\n");
}
