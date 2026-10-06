import type { ScheduledShift } from "./client";

export type ScheduledShiftRow = {
  shift_id: string;
  scheduler_id: number;
  start_at: string;
  end_at: string;
  assigned_user_ids: number[];
  is_open: boolean;
  is_published: boolean;
  job_id: string | null;
  tasks_total: number;
  tasks_done: number;
};

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/**
 * One row per rota shift. Only counts of the shift's checklist are kept, not
 * the shift title, location or notes, which can name a customer or address.
 */
export function parseScheduledShifts(schedulerId: number, shifts: ScheduledShift[]): ScheduledShiftRow[] {
  return shifts
    .filter((s) => s.id && s.startTime && s.endTime)
    .map((s) => ({
      shift_id: s.id,
      scheduler_id: schedulerId,
      start_at: iso(s.startTime),
      end_at: iso(s.endTime),
      assigned_user_ids: s.assignedUserIds ?? [],
      is_open: !!s.isOpenShift,
      is_published: s.isPublished !== false,
      job_id: s.jobId || null,
      tasks_total: s.tasks?.length ?? 0,
      tasks_done: s.tasks?.filter((t) => t.isComplete).length ?? 0,
    }));
}
