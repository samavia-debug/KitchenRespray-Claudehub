import type { WebsiteStatus } from "./types";

export type IncidentAction =
  | { type: "open"; severity: "critical" | "offline" }
  | { type: "continue" }
  | { type: "resolve" }
  | { type: "none" };

/**
 * Pure decision: given the status just computed from a new health check and
 * whether this website already has an open incident, what should happen to
 * that incident record? Kept separate from the DB read/write so the
 * open/continue/resolve logic can be tested without a database.
 */
export function decideIncidentAction(status: WebsiteStatus, hasOpenIncident: boolean): IncidentAction {
  const isIncidentWorthy = status === "critical" || status === "offline";

  if (isIncidentWorthy) {
    if (hasOpenIncident) return { type: "continue" };
    return { type: "open", severity: status as "critical" | "offline" };
  }

  if (hasOpenIncident) return { type: "resolve" };
  return { type: "none" };
}

/** "2h 15m", "45m", "3d 2h" — for incident duration in the UI. */
export function formatDuration(startIso: string, endIso: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const totalMinutes = Math.max(0, Math.round((end - start) / 60_000));

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
