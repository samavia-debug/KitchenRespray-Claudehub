import { addDays } from "./followups";
import type { Special, SpecialStatus } from "./types";

/** Where a special stands today: not started, running, finished, or switched off by hand (which beats the dates). */
export function specialStatus(s: Pick<Special, "starts_on" | "ends_on" | "active">, today: string): SpecialStatus {
  if (!s.active) return "off";
  if (s.starts_on > today) return "upcoming";
  if (s.ends_on && s.ends_on < today) return "ended";
  return "running";
}

/** Whether a special applies to a company in `county` (a special with no county applies everywhere). */
export function appliesTo(s: Pick<Special, "county">, county: string | null | undefined): boolean {
  return s.county === null || s.county === (county ?? null);
}

/** The specials running today that apply to a company in `county`, the most recently started first. */
export function runningFor(specials: Special[], county: string | null | undefined, today: string): Special[] {
  return specials
    .filter((s) => specialStatus(s, today) === "running" && appliesTo(s, county))
    .sort((a, b) => (a.starts_on < b.starts_on ? 1 : a.starts_on > b.starts_on ? -1 : a.title.localeCompare(b.title)));
}

/**
 * The days a special has run so far, and the same number of days just before it started, for comparing the two. A special
 * that has not started has neither. The window is held to a year, which is as long as a report can look back.
 */
export function specialWindows(s: Pick<Special, "starts_on" | "ends_on">, today: string): { during: { from: string; to: string }; before: { from: string; to: string }; days: number } | null {
  if (s.starts_on > today) return null;
  const to = s.ends_on && s.ends_on < today ? s.ends_on : today;
  const from = s.starts_on < addDays(to, -364) ? addDays(to, -364) : s.starts_on;
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const beforeTo = addDays(from, -1);
  return { during: { from, to }, before: { from: addDays(beforeTo, -(days - 1)), to: beforeTo }, days };
}

/** "ends 30 Nov", "no end date", "ended 12 Oct", "starts 3 Nov", for showing next to a special. */
export function describeDates(s: Pick<Special, "starts_on" | "ends_on" | "active">, today: string, fmt: (iso: string) => string): string {
  const status = specialStatus(s, today);
  if (status === "off") return "Switched off";
  if (status === "upcoming") return `Starts ${fmt(s.starts_on)}${s.ends_on ? `, ends ${fmt(s.ends_on)}` : ""}`;
  if (status === "ended") return `Ended ${fmt(s.ends_on as string)}`;
  return s.ends_on ? `Ends ${fmt(s.ends_on)}` : "No end date";
}
