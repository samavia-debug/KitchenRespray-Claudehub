import type { FollowUpView } from "./types";

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's date in Dublin as YYYY-MM-DD. Follow-ups are due on a calendar day, so "today" is the Irish day, not UTC. */
export function dublinToday(now: Date = new Date()): string {
  return dayFmt.format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Sunday that ends the week `date` falls in (the date itself when it is a Sunday). */
export function weekEnd(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, day === 0 ? 0 : 7 - day);
}

export type DueRange = { status: "open" | "done"; from?: string; to?: string };

/**
 * The due-date window for each follow-up list. The four open lists never overlap, so a task is in exactly one:
 * overdue (before today), today, the rest of this week (tomorrow to Sunday), and upcoming (after Sunday).
 */
export function dueRange(view: FollowUpView, today: string): DueRange {
  const end = weekEnd(today);
  switch (view) {
    case "overdue":
      return { status: "open", to: addDays(today, -1) };
    case "today":
      return { status: "open", from: today, to: today };
    case "week":
      return end > today ? { status: "open", from: addDays(today, 1), to: end } : { status: "open", from: addDays(today, 1), to: today }; // empty on a Sunday
    case "upcoming":
      return { status: "open", from: addDays(end, 1) };
    case "completed":
      return { status: "done" };
  }
}
