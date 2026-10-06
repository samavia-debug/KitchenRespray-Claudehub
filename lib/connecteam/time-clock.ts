import type { TimeActivityUser } from "./client";

export type ShiftRow = {
  shift_id: string;
  clock_id: number;
  user_id: number;
  started_at: string;
  ended_at: string | null;
  job_id: string | null;
  scheduler_shift_id: string | null;
  start_source: string | null;
  end_source: string | null;
  is_auto_clock_out: boolean;
};

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/**
 * Flattens Connecteam's per-person activity into one row per shift. Only the
 * facts needed for hours are kept: no photos or attachments, and no location.
 * A shift with no end timestamp is still open (or the clock-out was missed).
 */
export function parseShifts(clockId: number, users: TimeActivityUser[]): ShiftRow[] {
  const rows: ShiftRow[] = [];
  for (const user of users) {
    for (const shift of user.shifts ?? []) {
      const start = shift.start?.timestamp;
      if (!start) continue;
      const end = shift.end?.timestamp;
      rows.push({
        shift_id: shift.id,
        clock_id: clockId,
        user_id: user.userId,
        started_at: iso(start),
        ended_at: end ? iso(end) : null,
        job_id: shift.jobId || null,
        scheduler_shift_id: shift.schedulerShiftId || null,
        start_source: shift.start.source?.type ?? null,
        end_source: shift.end?.source?.type ?? null,
        is_auto_clock_out: !!shift.isAutoClockOut,
      });
    }
  }
  return rows;
}

const DAY = 86_400_000;

/**
 * Splits a long range into windows of at most `maxDays`, because Connecteam
 * rejects wide ranges (about 90 days for clock-ins, 365 for time off).
 * Consecutive windows share one day so nothing on a boundary is missed;
 * rows are upserted by id, so the overlap is harmless.
 */
export function dateWindows(startMs: number, endMs: number, maxDays: number): { startDate: string; endDate: string }[] {
  const windows: { startDate: string; endDate: string }[] = [];
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  let from = startMs;
  for (let guard = 0; guard < 100; guard++) {
    const to = Math.min(endMs, from + (maxDays - 1) * DAY);
    windows.push({ startDate: day(from), endDate: day(to) });
    if (to >= endMs) break;
    from = to;
  }
  return windows;
}
