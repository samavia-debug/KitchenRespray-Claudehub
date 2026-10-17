import { customerDetails, type CustomerDetails } from "./details";

export type GraphDateTime = { dateTime?: string; timeZone?: string };

/** The parts of a Microsoft Bookings appointment this uses. Everything is optional: the shape is checked, not assumed. */
export type RawAppointment = {
  id?: string;
  serviceName?: string;
  // Microsoft's calendarView returns "start" and "end"; the older names are accepted too.
  start?: GraphDateTime;
  end?: GraphDateTime;
  startDateTime?: GraphDateTime;
  endDateTime?: GraphDateTime;
  customerName?: string;
  customerPhone?: string;
  customerNotes?: string | null;
  customers?: { name?: string; phone?: string; notes?: string | null }[];
  isCancelled?: boolean;
};

export type BookingAppointment = {
  id: string;
  service: string;
  startSec: number;
  endSec: number;
  /** First name, used in the shift title. */
  firstName: string | null;
  /** Full name, phone and the customer's own note, shown inside the shift's notes. */
  details: CustomerDetails;
};

const IRISH_ZONES = new Set(["europe/dublin", "gmt standard time", "greenwich standard time"]);
const UTC_ZONES = new Set(["utc", "etc/utc", "z", "coordinated universal time"]);

const parts = (ms: number, timeZone: string) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(ms)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
};

/** A wall-clock time in Ireland as a UTC instant, correct either side of the clocks changing. */
function dublinWallClockToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = asIfUtc;
  // Two passes settle the offset, including right at a clock change.
  for (let i = 0; i < 2; i++) {
    const p = parts(guess, "Europe/Dublin");
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += asIfUtc - shown;
  }
  return guess;
}

/**
 * Graph gives a local-looking time plus a zone name ("2026-10-20T10:00:00.0000000"
 * with "UTC"). Only UTC and Irish time are understood; anything else returns null
 * rather than guessing, so an appointment is never copied at the wrong hour.
 */
export function graphDateToSec(v: GraphDateTime | undefined): number | null {
  if (!v?.dateTime || !v.timeZone) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(v.dateTime.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  const zone = v.timeZone.trim().toLowerCase();

  // Reject impossible dates and times (31 November, 25:00) that Date.UTC would quietly roll over.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;

  let ms: number;
  if (UTC_ZONES.has(zone)) ms = Date.UTC(y, mo - 1, d, h, mi, s);
  else if (IRISH_ZONES.has(zone)) ms = dublinWallClockToUtc(y, mo, d, h, mi, s);
  else return null;

  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** "Mary O'Brien" -> "Mary"; titles and odd characters are not passed on. */
export function firstNameOf(raw: string | undefined): string | null {
  if (!raw) return null;
  const tokens = raw.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const titles = new Set(["mr", "mrs", "ms", "miss", "dr", "mr.", "mrs.", "ms.", "dr."]);
  const first = tokens.find((t) => !titles.has(t.toLowerCase()));
  if (!first) return null;
  const clean = first.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'’-]/g, "").slice(0, 30); // Latin letters incl. fadas
  return clean.length >= 2 ? clean : null;
}

export type Normalised = { appointments: BookingAppointment[]; skipped: number };

export function normaliseAppointments(raw: RawAppointment[]): Normalised {
  const byId = new Map<string, BookingAppointment>();
  let skipped = 0;
  for (const r of raw) {
    if (!r || typeof r !== "object" || r.isCancelled === true) continue;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const startSec = graphDateToSec(r.start ?? r.startDateTime);
    const endSec = graphDateToSec(r.end ?? r.endDateTime);
    if (!id || startSec === null || endSec === null || endSec <= startSec) {
      skipped += 1;
      continue;
    }
    const service = (r.serviceName ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || "Showroom";
    byId.set(id, { id, service, startSec, endSec, firstName: firstNameOf(r.customers?.[0]?.name ?? r.customerName), details: customerDetails(r) });
  }
  return { appointments: Array.from(byId.values()).sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id)), skipped };
}

/** The shift title in Connecteam: the showroom or visit type and a first name. The rest is in the shift's notes. */
export function shiftTitle(a: Pick<BookingAppointment, "service" | "firstName">, labels: Record<string, string> = {}): string {
  const service = labels[a.service] ?? a.service;
  return `Showroom visit – ${service}${a.firstName ? ` – ${a.firstName}` : ""}`.slice(0, 120);
}
