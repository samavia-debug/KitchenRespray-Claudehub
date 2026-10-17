import { createHash } from "crypto";

export type DesiredShift = {
  bookingId: string;
  service: string;
  startSec: number;
  endSec: number;
  title: string;
  assignees: number[];
  /** The shift's notes (customer name, phone, note) as HTML. Not stored by us: only a short fingerprint is. */
  notes?: string;
};

export type ShiftLink = {
  booking_id: string;
  shift_id: string;
  scheduler_id: number;
  service: string | null;
  start_at: string;
  end_at: string;
  title: string;
  signature: string;
};

// Limits that keep a bad read from doing damage: copying thirty shifts by
// mistake, or deleting most of the calendar because Microsoft returned nothing.
export const PLAN_LIMITS = { maxCreates: 60, maxRemovals: 5, emptyReadGuard: 3 } as const;

/**
 * What was written for a booking, so a change in time, title, assignees or notes is noticed. The notes
 * hold the customer's phone number and words, so only a fingerprint of them is kept, never the text.
 */
export function signatureOf(d: Pick<DesiredShift, "startSec" | "endSec" | "title" | "assignees" | "notes">): string {
  const notes = d.notes ? createHash("sha256").update(d.notes).digest("hex").slice(0, 12) : "";
  return `${d.startSec}|${d.endSec}|${d.title}|${[...d.assignees].sort((a, b) => a - b).join(",")}|${notes}`;
}

export type Plan = {
  create: DesiredShift[];
  update: { link: ShiftLink; desired: DesiredShift }[];
  remove: ShiftLink[];
  unchanged: number;
  /** The bookings already in Connecteam exactly as they should be, so a preview can show them. */
  unchangedList: DesiredShift[];
  /** Things held back for safety, in words, for the page and the log. */
  held: string[];
};

/**
 * Works out what to do, without doing it. Past appointments are left alone as a
 * record; only future ones are created, changed or removed. A booking that has
 * vanished from Microsoft's answer is removed from Connecteam, except that a read
 * which returned nothing at all while appointments are already copied is treated
 * as a failed read, not as everyone cancelling.
 */
export function planSync(desired: DesiredShift[], links: ShiftLink[], nowSec: number, windowEndSec: number): Plan {
  const wanted = new Map<string, DesiredShift>();
  for (const d of desired) if (d.endSec >= nowSec && d.startSec <= windowEndSec) wanted.set(d.bookingId, d);

  const linkById = new Map(links.map((l) => [l.booking_id, l]));
  const plan: Plan = { create: [], update: [], remove: [], unchanged: 0, unchangedList: [], held: [] };

  wanted.forEach((d, id) => {
    const link = linkById.get(id);
    if (!link) plan.create.push(d);
    else if (link.signature !== signatureOf(d)) plan.update.push({ link, desired: d });
    else {
      plan.unchanged += 1;
      plan.unchangedList.push(d);
    }
  });

  const futureLinks = links.filter((l) => Date.parse(l.end_at) / 1000 >= nowSec && Date.parse(l.start_at) / 1000 <= windowEndSec);
  const gone = futureLinks.filter((l) => !wanted.has(l.booking_id));

  if (wanted.size === 0 && futureLinks.length >= PLAN_LIMITS.emptyReadGuard) {
    plan.held.push(`Microsoft Bookings returned no appointments, but ${futureLinks.length} are already in Connecteam. Nothing was removed; this looks like a failed read.`);
  } else if (gone.length > PLAN_LIMITS.maxRemovals) {
    plan.held.push(`${gone.length} appointments would be removed from Connecteam in one go, which is more than the safe limit of ${PLAN_LIMITS.maxRemovals}. None were removed; check Bookings, then remove them by hand if they really were cancelled.`);
  } else {
    plan.remove = gone;
  }

  if (plan.create.length > PLAN_LIMITS.maxCreates) {
    plan.held.push(`${plan.create.length - PLAN_LIMITS.maxCreates} new appointments were held back because only ${PLAN_LIMITS.maxCreates} are copied per run. They will follow on the next run.`);
    plan.create = plan.create.slice(0, PLAN_LIMITS.maxCreates);
  }
  return plan;
}
