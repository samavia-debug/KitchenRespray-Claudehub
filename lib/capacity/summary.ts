import { addDays, dublinDateKey, formatKey, mondayOf, type StaffDetail } from "../connecteam/time-clock-summary";
import type { OpsLeave, OpsScheduled, OpsShift } from "../connecteam/operations";
import { OPS_RULES } from "../connecteam/operations";

const HOUR = 3_600_000;
const DAY = 86_400_000;

// Stated once, shown on the page and repeated to Eleven, so every figure says what it counted.
export const CAPACITY_RULES = {
  pastWeeks: 8,
  futureWeeks: 6,
  // Role or department names such as "Technicians" and the (misspelt) "Spray technitian".
  technicianPattern: /techn|spray/i,
  baselineWeeks: 4,
  // A rota under half of the usual hours is a week nobody has planned yet, not a week that is short.
  unplannedBelowPct: 50,
  lightRotaBelowPct: 85,
  heavyRotaAbovePct: 115,
  demandMovePct: 25,
  hoursMovePct: 10,
  // Below this a baseline is too thin to say anything about.
  minBaselineHours: 40,
  leavePinchPct: 15,
  workdays: 5,
} as const;

export type DemandDay = { date: string; sessions: number | null; conversions: number | null };
export type SearchDay = { date: string; clicks: number | null };
export type CapacityLeave = OpsLeave & { is_all_day?: boolean };

export type WeekKind = "past" | "current" | "future";

export type WeekDemand = {
  sessions: number;
  conversions: number;
  clicks: number;
  /** Days of the week that have website data, out of days that have happened. */
  analyticsDays: number;
  searchDays: number;
  daysElapsed: number;
  /** True when every elapsed day has website visit data, so sessions are comparable with a full week. */
  complete: boolean;
  /** Search Console runs a few days behind, so clicks are often incomplete for the latest week. */
  searchComplete: boolean;
};

export type CapacityWeek = {
  from: string;
  to: string;
  kind: WeekKind;
  demand: WeekDemand | null;
  /** Hours on completed clock-ins by technicians; null for weeks that have not started. */
  workedHours: number | null;
  techniciansWorked: number;
  /** Hours on published rota shifts assigned to technicians. */
  rotaHours: number;
  techniciansRostered: number;
  /** Rota shifts saved as draft, not yet visible to staff. */
  draftHours: number;
  /** Rota hours nobody has been assigned to. */
  openHours: number;
  leaveDays: number;
  leavePeople: number;
  /** "Hours" the week is judged on: worked for past weeks, rota for the rest. */
  hours: number;
  /** Change against the average of the weeks before it; null when there is not enough to compare with. */
  sessionsVsUsualPct: number | null;
  hoursVsUsualPct: number | null;
  /** Rota hours as a share of usual hours, for current and future weeks. */
  rotaVsUsualPct: number | null;
  status: "unplanned" | "light" | "normal" | "heavy" | null;
};

export type Finding = { level: "attention" | "note"; text: string };

export type CapacityOverview = {
  today: string;
  technicians: { active: number; matched: number };
  usualWeeklyHours: number | null;
  /** The last day the rota looks planned for, judged against usual hours. */
  rotaPlannedThrough: string | null;
  demandHistoryFrom: string | null;
  weeks: CapacityWeek[];
  findings: Finding[];
  rotaShiftsIgnored: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const pctChange = (now: number, base: number) => (base > 0 ? Math.round(((now - base) / base) * 100) : null);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function isTechnician(s: Pick<StaffDetail, "role" | "department">): boolean {
  return CAPACITY_RULES.technicianPattern.test(`${s.role ?? ""} ${s.department ?? ""}`);
}

/** Monday to Friday days of [from, to] that are inside [rangeFrom, rangeTo]. */
function weekdaysBetween(from: string, to: string, rangeFrom: string, rangeTo: string): number {
  const start = from > rangeFrom ? from : rangeFrom;
  const end = to < rangeTo ? to : rangeTo;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

export function weekList(today: string): { from: string; to: string; kind: WeekKind }[] {
  const thisMonday = mondayOf(today);
  const out: { from: string; to: string; kind: WeekKind }[] = [];
  for (let i = -CAPACITY_RULES.pastWeeks; i <= CAPACITY_RULES.futureWeeks; i++) {
    const from = addDays(thisMonday, 7 * i);
    const to = addDays(from, 6);
    out.push({ from, to, kind: i < 0 ? "past" : i === 0 ? "current" : "future" });
  }
  return out;
}

export function summariseCapacity(
  analytics: DemandDay[],
  search: SearchDay[],
  shifts: OpsShift[],
  scheduled: OpsScheduled[],
  leave: CapacityLeave[],
  staff: StaffDetail[],
  nowMs: number = Date.now()
): CapacityOverview {
  const today = dublinDateKey(nowMs);
  const ranges = weekList(today);
  const keyOf = (iso: string) => dublinDateKey(new Date(iso).getTime());
  const weekIndex = (key: string) => ranges.findIndex((w) => key >= w.from && key <= w.to);

  const techIds = new Set(staff.filter(isTechnician).map((s) => s.userId));
  const activeTechs = staff.filter((s) => isTechnician(s) && !s.former).length;

  // Website demand: the rows are one per site per day, so add them up per date first.
  const aDays = new Map<string, DemandDay>();
  for (const r of analytics) {
    const cur = aDays.get(r.date);
    aDays.set(r.date, { date: r.date, sessions: (cur?.sessions ?? 0) + (r.sessions ?? 0), conversions: (cur?.conversions ?? 0) + (r.conversions ?? 0) });
  }
  const sDays = new Map<string, SearchDay>();
  for (const r of search) {
    const cur = sDays.get(r.date);
    sDays.set(r.date, { date: r.date, clicks: (cur?.clicks ?? 0) + (r.clicks ?? 0) });
  }
  const dates = Array.from(aDays.keys()).sort();

  const weeks: CapacityWeek[] = ranges.map((range) => ({
    from: range.from,
    to: range.to,
    kind: range.kind,
    demand: null,
    workedHours: range.kind === "future" ? null : 0,
    techniciansWorked: 0,
    rotaHours: 0,
    techniciansRostered: 0,
    draftHours: 0,
    openHours: 0,
    leaveDays: 0,
    leavePeople: 0,
    hours: 0,
    sessionsVsUsualPct: null,
    hoursVsUsualPct: null,
    rotaVsUsualPct: null,
    status: null,
  }));

  weeks.forEach((w) => {
    if (w.kind === "future") return;
    const lastDay = w.to < today ? w.to : today;
    const daysElapsed = daysBetween(w.from, lastDay);
    let sessions = 0;
    let conversions = 0;
    let clicks = 0;
    let analyticsDays = 0;
    let searchDays = 0;
    for (let d = w.from; d <= lastDay; d = addDays(d, 1)) {
      const a = aDays.get(d);
      if (a) {
        analyticsDays += 1;
        sessions += a.sessions ?? 0;
        conversions += a.conversions ?? 0;
      }
      const s = sDays.get(d);
      if (s) {
        searchDays += 1;
        clicks += s.clicks ?? 0;
      }
    }
    if (analyticsDays === 0 && searchDays === 0) return;
    w.demand = { sessions, conversions, clicks, analyticsDays, searchDays, daysElapsed, complete: analyticsDays >= daysElapsed, searchComplete: searchDays >= daysElapsed };
  });

  // Hours actually worked: completed clock-ins, with the same forgotten-clock-out rule the scorecard uses.
  const workedBy = weeks.map(() => new Set<number>());
  for (const s of shifts) {
    if (!techIds.has(s.user_id) || !s.ended_at) continue;
    const i = weekIndex(keyOf(s.started_at));
    if (i < 0 || weeks[i].kind === "future") continue;
    const hours = (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / HOUR;
    if (hours < 0 || hours > OPS_RULES.implausibleHours) continue;
    weeks[i].workedHours = (weeks[i].workedHours ?? 0) + hours;
    workedBy[i].add(s.user_id);
  }

  // The rota: hours per technician assigned to each shift.
  const rosteredBy = weeks.map(() => new Set<number>());
  let ignored = 0;
  for (const s of scheduled) {
    const i = weekIndex(keyOf(s.start_at));
    if (i < 0) continue;
    const hours = (new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) / HOUR;
    if (hours <= 0 || hours > OPS_RULES.implausibleHours) {
      ignored += 1;
      continue;
    }
    const techs = s.assigned_user_ids.filter((id) => techIds.has(id));
    if (s.is_open || s.assigned_user_ids.length === 0) {
      weeks[i].openHours += hours;
      continue;
    }
    if (techs.length === 0) continue;
    if (!s.is_published) {
      weeks[i].draftHours += hours * techs.length;
      continue;
    }
    weeks[i].rotaHours += hours * techs.length;
    techs.forEach((id) => rosteredBy[i].add(id));
  }

  // Approved leave by technicians, in working days.
  const leaveBy = weeks.map(() => new Set<number>());
  for (const l of leave) {
    if (l.status !== "approved" || !techIds.has(l.user_id)) continue;
    weeks.forEach((w, i) => {
      const days = weekdaysBetween(l.start_date, l.end_date, w.from, w.to);
      if (days === 0) return;
      w.leaveDays += l.is_all_day === false ? days * 0.5 : days;
      leaveBy[i].add(l.user_id);
    });
  }

  weeks.forEach((w, i) => {
    w.techniciansWorked = workedBy[i].size;
    w.techniciansRostered = rosteredBy[i].size;
    w.leavePeople = leaveBy[i].size;
    w.workedHours = w.workedHours === null ? null : round1(w.workedHours);
    w.rotaHours = round1(w.rotaHours);
    w.draftHours = round1(w.draftHours);
    w.openHours = round1(w.openHours);
    w.leaveDays = round1(w.leaveDays);
    w.hours = w.kind === "past" ? w.workedHours ?? 0 : w.rotaHours;
  });

  // Usual weekly hours: the average of the last few full weeks that have any hours.
  const fullPast = weeks.filter((w) => w.kind === "past" && (w.workedHours ?? 0) > 0);
  const baselineWeeks = fullPast.slice(-CAPACITY_RULES.baselineWeeks);
  const usual = baselineWeeks.length ? sum(baselineWeeks.map((w) => w.workedHours ?? 0)) / baselineWeeks.length : null;
  const usualWeeklyHours = usual !== null && usual >= CAPACITY_RULES.minBaselineHours ? round1(usual) : null;

  // Each full past week against the weeks just before it.
  weeks.forEach((w, i) => {
    if (w.kind !== "past") return;
    const before = weeks.slice(0, i).filter((x) => x.kind === "past");
    const prevHours = before.filter((x) => (x.workedHours ?? 0) > 0).slice(-CAPACITY_RULES.baselineWeeks);
    if (prevHours.length >= 2) {
      const base = sum(prevHours.map((x) => x.workedHours ?? 0)) / prevHours.length;
      if (base >= CAPACITY_RULES.minBaselineHours) w.hoursVsUsualPct = pctChange(w.workedHours ?? 0, base);
    }
    const prevDemand = before.filter((x) => x.demand?.complete).slice(-CAPACITY_RULES.baselineWeeks);
    if (w.demand?.complete && prevDemand.length >= 2) {
      const base = sum(prevDemand.map((x) => x.demand!.sessions)) / prevDemand.length;
      w.sessionsVsUsualPct = pctChange(w.demand.sessions, base);
    }
  });

  // Rota against usual, for this week onwards.
  if (usualWeeklyHours !== null) {
    for (const w of weeks) {
      if (w.kind === "past") continue;
      const pct = Math.round((w.rotaHours / usualWeeklyHours) * 100);
      w.rotaVsUsualPct = pct;
      w.status =
        pct < CAPACITY_RULES.unplannedBelowPct ? "unplanned" : pct < CAPACITY_RULES.lightRotaBelowPct ? "light" : pct > CAPACITY_RULES.heavyRotaAbovePct ? "heavy" : "normal";
    }
  }

  // Planned through the last week in an unbroken run from this week that has a real rota.
  let plannedThrough: string | null = null;
  for (const w of weeks.filter((x) => x.kind !== "past")) {
    if (w.status && w.status !== "unplanned") plannedThrough = w.to;
    else break;
  }

  return {
    today,
    technicians: { active: activeTechs, matched: techIds.size },
    usualWeeklyHours,
    rotaPlannedThrough: plannedThrough,
    demandHistoryFrom: dates[0] ?? null,
    weeks,
    findings: buildFindings(weeks, usualWeeklyHours, plannedThrough),
    rotaShiftsIgnored: ignored,
  };
}

// Counts every day of a range, weekends included, because the website is open every day.
function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1);
}

function leaveNote(w: CapacityWeek): string {
  return w.leaveDays > 0 ? ` ${w.leavePeople} technician${w.leavePeople === 1 ? " is" : "s are"} on approved leave (${w.leaveDays} working days).` : "";
}

export function buildFindings(weeks: CapacityWeek[], usualHours: number | null, plannedThrough: string | null): Finding[] {
  const out: Finding[] = [];
  const R = CAPACITY_RULES;

  // Last full week: did website demand and technician hours move apart?
  const last = [...weeks].reverse().find((w) => w.kind === "past" && w.demand?.complete);
  if (last && last.sessionsVsUsualPct !== null && last.hoursVsUsualPct !== null) {
    const range = `${formatKey(last.from)} – ${formatKey(last.to)}`;
    if (last.sessionsVsUsualPct >= R.demandMovePct && last.hoursVsUsualPct <= -R.hoursMovePct) {
      out.push({
        level: "attention",
        text: `Week of ${range}: website visits were ${last.sessionsVsUsualPct}% above usual but technician hours were ${Math.abs(last.hoursVsUsualPct)}% below.${leaveNote(last)}`,
      });
    } else if (last.sessionsVsUsualPct <= -R.demandMovePct && last.hoursVsUsualPct >= R.hoursMovePct) {
      out.push({
        level: "note",
        text: `Week of ${range}: website visits were ${Math.abs(last.sessionsVsUsualPct)}% below usual while technician hours were ${last.hoursVsUsualPct}% above.`,
      });
    }
  }

  // Rota ahead.
  if (usualHours !== null) {
    for (const w of weeks.filter((x) => x.kind !== "past" && x.status)) {
      const range = `${formatKey(w.from)} – ${formatKey(w.to)}`;
      if (w.status === "light") {
        const withDraft = Math.round(((w.rotaHours + w.draftHours) / usualHours) * 100);
        if (w.draftHours > 0 && withDraft >= R.lightRotaBelowPct) {
          // The shortfall is unpublished rota, not missing cover.
          out.push({
            level: "note",
            text: `Week of ${range}: only ${w.rotaHours}h of the usual ${usualHours}h is published. Another ${w.draftHours}h is saved as draft, so publishing it would bring the rota to ${withDraft}% of usual.${leaveNote(w)}`,
          });
        } else {
          out.push({
            level: "attention",
            text: `Week of ${range}: ${w.rotaHours}h on the rota against about ${usualHours}h usually (${w.rotaVsUsualPct}%).${leaveNote(w)}${w.draftHours > 0 ? ` A further ${w.draftHours}h is saved as draft and not yet published.` : ""}`,
          });
        }
      } else if (w.status === "heavy") {
        out.push({ level: "note", text: `Week of ${range}: ${w.rotaHours}h on the rota, ${w.rotaVsUsualPct}% of the usual ${usualHours}h.` });
      }
      if (w.status !== "unplanned" && w.openHours > 0) {
        out.push({ level: "note", text: `Week of ${range}: ${w.openHours}h of open shifts have nobody assigned yet.` });
      }
    }
  }

  // Leave pinch, unless the week is already flagged as light (that finding names the leave).
  for (const w of weeks.filter((x) => x.kind !== "past")) {
    const people = Math.max(w.techniciansRostered, 1);
    if (w.leaveDays > 0 && w.leaveDays / (people * R.workdays) >= R.leavePinchPct / 100 && w.status !== "unplanned" && w.status !== "light") {
      out.push({
        level: "note",
        text: `Week of ${formatKey(w.from)} – ${formatKey(w.to)}: ${w.leaveDays} technician working days of approved leave, about ${Math.round((w.leaveDays / (people * R.workdays)) * 100)}% of the rostered team.`,
      });
    }
  }

  if (plannedThrough && weeks.some((w) => w.kind === "future" && w.status === "unplanned")) {
    out.push({ level: "note", text: `The rota looks planned up to ${formatKey(plannedThrough)}. Later weeks are mostly empty, so they are not compared with usual hours.` });
  }
  return out;
}

// ---- Text for Eleven ----

export function formatCapacityContext(o: CapacityOverview): string {
  const R = CAPACITY_RULES;
  const lines: string[] = [
    `Source: website visits (Google Analytics) and search clicks (Search Console) summed across all connected sites, set against technician hours from the Connecteam time clock and rota. Today is ${o.today}.`,
    `Definitions: "technicians" are staff whose Connecteam role or department matches technician/spray (${o.technicians.active} active). "Worked hours" are completed clock-ins up to ${OPS_RULES.implausibleHours}h. "Rota hours" are published rota shifts assigned to technicians (drafts are listed separately). "Usual hours" is the average of the last ${R.baselineWeeks} full weeks${o.usualWeeklyHours !== null ? ` (${o.usualWeeklyHours}h)` : " (not enough history yet)"}. A rota under ${R.unplannedBelowPct}% of usual is treated as not planned yet, not as short. Website figures cover ${o.demandHistoryFrom ? `dates since ${o.demandHistoryFrom}` : "no dates yet"}; they measure interest in the websites, not booked jobs, and the number of enquiries is small, so week-to-week swings are noisy. Visits and hours moving together or apart does not prove one caused the other.`,
    o.rotaPlannedThrough ? `The rota looks planned through ${o.rotaPlannedThrough}.` : "The rota could not be judged against usual hours.",
    "Weeks (Mon–Sun): website visits / enquiries / search clicks | worked hours (technicians) | rota hours | technicians on leave:",
  ];
  for (const w of o.weeks) {
    if (w.kind === "future" && w.rotaHours === 0 && w.draftHours === 0 && w.leaveDays === 0) continue;
    const d = w.demand;
    const demand = d ? `${d.sessions} visits / ${d.conversions} enquiries / ${d.clicks} clicks${d.searchComplete ? "" : " (clicks incomplete: Search Console is a few days behind)"}${d.complete ? "" : " (visits incomplete)"}` : "no website data";
    lines.push(
      `- ${w.from} to ${w.to} (${w.kind}): ${demand} | ${w.workedHours === null ? "not started" : `${w.workedHours}h worked`} | ${w.rotaHours}h rota${w.draftHours ? ` (+${w.draftHours}h draft)` : ""}${w.status ? ` [${w.status}]` : ""} | ${w.leaveDays} leave days (${w.leavePeople} ${w.leavePeople === 1 ? "person" : "people"})`
    );
  }
  lines.push(`Findings: ${o.findings.length ? o.findings.map((f) => f.text).join(" ") : "nothing stands out."}`);
  return lines.join("\n");
}
