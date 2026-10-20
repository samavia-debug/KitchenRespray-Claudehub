import { addDays, dublinToday } from "./followups";

export const RANGE_PRESETS = ["this_week", "last_week", "this_month", "last_month", "last_30", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export type ResolvedRange = {
  preset: RangePreset;
  /** First and last day, inclusive, as YYYY-MM-DD (Irish dates). */
  from: string;
  to: string;
  label: string;
  /** The instants those days start and end at: `startIso` is included, `endIso` is the start of the next day. */
  startIso: string;
  endIso: string;
};

const MAX_DAYS = 366;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", hourCycle: "h23" });

function isRealDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * The instant a calendar day starts in Dublin. Dublin is an hour ahead of UTC in summer, so "midnight on 1 July"
 * is 23:00 UTC the evening before; trying both offsets and checking what Dublin says avoids hard-coding the dates
 * clocks change.
 */
export function dublinDayStart(date: string): string {
  for (const offset of [0, 1]) {
    const t = new Date(Date.parse(`${date}T00:00:00Z`) - offset * 3_600_000);
    if (dayFmt.format(t) === date && hourFmt.format(t) === "00") return t.toISOString();
  }
  return new Date(`${date}T00:00:00Z`).toISOString();
}

/** The Monday of the week `date` falls in. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, day === 0 ? -6 : 1 - day);
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthEnd(date: string): string {
  const d = new Date(`${monthStart(date)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pretty = (date: string) => `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3)} ${date.slice(0, 4)}`;

/**
 * Turns "this week", "last month" or a custom pair of dates into a range of whole Irish days. Anything that is not a
 * real date, runs backwards, or spans more than a year is refused.
 */
export function resolveRange(preset: string | null | undefined, today: string = dublinToday(), from?: string | null, to?: string | null): ResolvedRange | { error: string } {
  const p = (RANGE_PRESETS as readonly string[]).includes(preset ?? "") ? (preset as RangePreset) : "this_month";
  let a: string;
  let b: string;
  let label: string;

  switch (p) {
    case "this_week":
      a = weekStart(today);
      b = addDays(a, 6);
      label = "This week";
      break;
    case "last_week":
      a = addDays(weekStart(today), -7);
      b = addDays(a, 6);
      label = "Last week";
      break;
    case "last_month": {
      const lastOfPrev = addDays(monthStart(today), -1);
      a = monthStart(lastOfPrev);
      b = lastOfPrev;
      label = "Last month";
      break;
    }
    case "last_30":
      a = addDays(today, -29);
      b = today;
      label = "Last 30 days";
      break;
    case "custom": {
      if (!from || !to || !isRealDate(from) || !isRealDate(to)) return { error: "Choose a start and an end date." };
      if (from > to) return { error: "The start date must not be after the end date." };
      if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1 > MAX_DAYS) return { error: "Choose a range of a year or less." };
      a = from;
      b = to;
      label = `${pretty(from)} to ${pretty(to)}`;
      break;
    }
    default:
      a = monthStart(today);
      b = monthEnd(today);
      label = "This month";
  }

  return { preset: p, from: a, to: b, label, startIso: dublinDayStart(a), endIso: dublinDayStart(addDays(b, 1)) };
}

/** Every day from `from` to `to`, inclusive. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= MAX_DAYS + 1; d = addDays(d, 1)) out.push(d);
  return out;
}
