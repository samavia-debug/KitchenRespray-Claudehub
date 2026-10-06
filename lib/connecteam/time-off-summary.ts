import type { TimeOffRow } from "./time-off";
import { addDays, dublinDateKey, formatKey, type StaffDetail } from "./time-clock-summary";

export const LEAVE_RULES = { soonDays: 14, upcomingDays: 90, pastNotApprovedDays: 30 } as const;

export type LeaveEntry = {
  requestId: string;
  userId: number;
  name: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number | null;
  partDay: boolean;
  times: string | null;
  status: string;
};

export type TimeOffOverview = {
  generatedAt: string;
  today: string;
  offToday: LeaveEntry[];
  startingSoon: LeaveEntry[];
  upcoming: LeaveEntry[];
  notApproved: LeaveEntry[];
  year: number;
  yearTypes: string[];
  yearPeople: { userId: number; name: string; former: boolean; byType: Record<string, number>; total: number }[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

// A request's length: Connecteam's own day count when it has one, otherwise
// the calendar days it spans.
function daysOf(r: TimeOffRow): number {
  if (r.duration_days !== null) return r.duration_days;
  return Math.round((Date.parse(`${r.end_date}T00:00:00Z`) - Date.parse(`${r.start_date}T00:00:00Z`)) / 86_400_000) + 1;
}

export function summariseTimeOff(rows: TimeOffRow[], staff: StaffDetail[], nowMs: number = Date.now()): TimeOffOverview {
  const today = dublinDateKey(nowMs);
  const year = Number(today.slice(0, 4));
  const staffById = new Map(staff.map((s) => [s.userId, s]));

  const entry = (r: TimeOffRow): LeaveEntry => ({
    requestId: r.request_id,
    userId: r.user_id,
    name: staffById.get(r.user_id)?.name ?? `Connecteam user ${r.user_id}`,
    leaveType: r.leave_type,
    startDate: r.start_date,
    endDate: r.end_date,
    days: r.duration_days,
    partDay: !r.is_all_day,
    times: !r.is_all_day && r.start_time && r.end_time ? `${r.start_time.slice(0, 5)}-${r.end_time.slice(0, 5)}` : null,
    status: r.status,
  });

  const approved = rows.filter((r) => r.status === "approved");
  const byStart = (a: LeaveEntry, b: LeaveEntry) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name);

  const soonEnd = addDays(today, LEAVE_RULES.soonDays);
  const upcomingEnd = addDays(today, LEAVE_RULES.upcomingDays);

  // Year to date: approved requests that started this calendar year.
  const types = new Set<string>();
  const people = new Map<number, { byType: Record<string, number>; total: number }>();
  for (const r of approved) {
    if (!r.start_date.startsWith(`${year}-`)) continue;
    types.add(r.leave_type);
    const p = people.get(r.user_id) ?? { byType: {}, total: 0 };
    const d = daysOf(r);
    p.byType[r.leave_type] = round1((p.byType[r.leave_type] ?? 0) + d);
    p.total = round1(p.total + d);
    people.set(r.user_id, p);
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    today,
    offToday: approved.filter((r) => r.start_date <= today && r.end_date >= today).map(entry).sort(byStart),
    startingSoon: approved.filter((r) => r.start_date > today && r.start_date <= soonEnd).map(entry).sort(byStart),
    upcoming: approved.filter((r) => r.start_date > soonEnd && r.start_date <= upcomingEnd).map(entry).sort(byStart),
    notApproved: rows
      .filter((r) => r.status !== "approved" && r.end_date >= addDays(today, -LEAVE_RULES.pastNotApprovedDays))
      .map(entry)
      .sort(byStart),
    year,
    yearTypes: Array.from(types).sort(),
    yearPeople: Array.from(people.entries())
      .map(([userId, p]) => ({
        userId,
        name: staffById.get(userId)?.name ?? `Connecteam user ${userId}`,
        former: !!staffById.get(userId)?.former,
        byType: p.byType,
        total: p.total,
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  };
}

function describe(e: LeaveEntry): string {
  const when = e.startDate === e.endDate ? formatKey(e.startDate) : `${formatKey(e.startDate)} to ${formatKey(e.endDate)}`;
  const len = e.partDay ? `part day${e.times ? ` ${e.times}` : ""}${e.days !== null ? ` (${e.days} day)` : ""}` : e.days !== null ? `${e.days} day${e.days === 1 ? "" : "s"}` : "";
  return `${e.name}: ${e.leaveType}, ${when}${len ? ` (${len})` : ""}${e.status !== "approved" ? ` [${e.status}]` : ""}`;
}

/** Plain-text block for Eleven's prompt. */
export function formatTimeOffContext(o: TimeOffOverview, lastSyncedAt: string | null): string {
  const lines: string[] = [];
  lines.push(
    `Source: Connecteam time off${lastSyncedAt ? `, last synced ${formatKey(dublinDateKey(new Date(lastSyncedAt).getTime()))}` : ""}. Today is ${formatKey(o.today)} (Irish time).`,
    `Definitions: "off" means an approved request. Only approved requests are held, so pending or declined ones are not visible here unless listed below. Days are Connecteam's own day counts (half days are 0.5). Year to date counts approved requests that START in ${o.year}, so one spanning New Year is counted in the year it began. "Bank Holidays" are listed as their own leave type, separate from "Holidays", so don't add them together when asked about holiday entitlement used. Employee notes are deliberately not held.`
  );
  lines.push(`Off today (${o.offToday.length}): ${o.offToday.map(describe).join("; ") || "nobody"}.`);
  lines.push(`Starting in the next ${LEAVE_RULES.soonDays} days (${o.startingSoon.length}): ${o.startingSoon.map(describe).join("; ") || "none"}.`);
  lines.push(`Later, up to ${LEAVE_RULES.upcomingDays} days ahead (${o.upcoming.length}): ${o.upcoming.slice(0, 30).map(describe).join("; ") || "none"}.`);
  lines.push(`Not approved (recent or upcoming): ${o.notApproved.map(describe).join("; ") || "none"}.`);
  lines.push(`Days taken in ${o.year} by person (leave types: ${o.yearTypes.join(", ") || "none"}):`);
  for (const p of o.yearPeople) {
    lines.push(`- ${p.name}${p.former ? " [former staff]" : ""}: ${p.total} days total; ${o.yearTypes.filter((t) => p.byType[t]).map((t) => `${t} ${p.byType[t]}`).join(", ")}`);
  }
  return lines.join("\n");
}
