import type { PersonStatus } from "@/lib/connecteam/operations";

// Times are always shown in Irish time, whatever the viewer's own computer says.
const clockFormat = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hour12: false });
export const clockTime = (iso: string) => clockFormat.format(new Date(iso));

export const STATUS_LABEL: Record<PersonStatus, string> = {
  working: "Working",
  finished: "Finished",
  "not-clocked-in": "Not clocked in",
  scheduled: "Due later",
  "on-leave": "On leave",
  "not-scheduled": "Not scheduled",
};

export const STATUS_COLOR: Record<PersonStatus, string> = {
  working: "#2e7d32",
  finished: "#6f6a63",
  "not-clocked-in": "#b3261e",
  scheduled: "#b98900",
  "on-leave": "#5b6abf",
  "not-scheduled": "#a39e96",
};

export function ago(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)} days ago`;
}
