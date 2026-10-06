import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/paginate";
import {
  formatTodayContext,
  summarisePerson,
  summariseToday,
  type OpsLeave,
  type OpsScheduled,
  type OpsShift,
  type PersonDetail,
  type TodayOverview,
} from "./operations";
import { getScheduleStatus, getTimeClockStatus, loadStaffDetails, syncSchedule, syncTimeClock } from "./time-sync";

const DAY = 86_400_000;

const SHIFT_COLUMNS = "shift_id, user_id, started_at, ended_at, job_id, scheduler_shift_id";
const SCHEDULED_COLUMNS = "shift_id, start_at, end_at, assigned_user_ids, is_open, is_published, job_id, tasks_total, tasks_done";

async function loadJobs() {
  const { data } = await createServiceClient().from("connecteam_jobs").select("job_id, title");
  return data || [];
}

/** Everything is read from our own tables; nothing here calls Connecteam. */
export async function getTodayOverview(): Promise<{
  overview: TodayOverview;
  clockSyncedAt: string | null;
  scheduleSyncedAt: string | null;
}> {
  const supabase = createServiceClient();
  const now = Date.now();
  const recent = new Date(now - 3 * DAY).toISOString();

  // Recent clock-ins, plus any shift still open however old, since a forgotten
  // clock-out from last week still counts as a problem today.
  const shifts = await fetchAllRows<OpsShift>((from, to) =>
    supabase
      .from("time_clock_shifts")
      .select(SHIFT_COLUMNS)
      .or(`started_at.gte.${recent},ended_at.is.null`)
      .order("started_at", { ascending: false })
      .order("shift_id")
      .range(from, to)
  );

  const scheduled = await fetchAllRows<OpsScheduled>((from, to) =>
    supabase
      .from("scheduled_shifts")
      .select(SCHEDULED_COLUMNS)
      .gte("start_at", new Date(now - 35 * DAY).toISOString())
      .lte("start_at", new Date(now + 2 * DAY).toISOString())
      .order("start_at", { ascending: false })
      .order("shift_id")
      .range(from, to)
  );

  const leave = await fetchAllRows<OpsLeave>((from, to) =>
    supabase
      .from("time_off_requests")
      .select("user_id, leave_type, status, start_date, end_date")
      .gte("end_date", new Date(now - 2 * DAY).toISOString().slice(0, 10))
      .order("start_date")
      .order("request_id")
      .range(from, to)
  );

  const [jobs, staff, clock, schedule] = await Promise.all([loadJobs(), loadStaffDetails(), getTimeClockStatus(), getScheduleStatus()]);
  return {
    overview: summariseToday(shifts, scheduled, jobs, staff, leave, now),
    clockSyncedAt: clock.lastSyncedAt,
    scheduleSyncedAt: schedule.lastSyncedAt,
  };
}

export async function getPersonDetail(userId: number): Promise<PersonDetail> {
  const supabase = createServiceClient();
  const now = Date.now();
  const since = new Date(now - 40 * DAY).toISOString();

  const shifts = await fetchAllRows<OpsShift>((from, to) =>
    supabase
      .from("time_clock_shifts")
      .select(SHIFT_COLUMNS)
      .eq("user_id", userId)
      .or(`started_at.gte.${since},ended_at.is.null`)
      .order("started_at", { ascending: false })
      .order("shift_id")
      .range(from, to)
  );

  const scheduled = await fetchAllRows<OpsScheduled>((from, to) =>
    supabase
      .from("scheduled_shifts")
      .select(SCHEDULED_COLUMNS)
      .contains("assigned_user_ids", [userId])
      .gte("start_at", since)
      .lte("start_at", new Date(now + 2 * DAY).toISOString())
      .order("start_at", { ascending: false })
      .order("shift_id")
      .range(from, to)
  );

  const [{ data: leave }, { data: checks }, { data: ppe }, jobs, staff] = await Promise.all([
    supabase.from("time_off_requests").select("user_id, leave_type, status, start_date, end_date").eq("user_id", userId),
    supabase.from("vehicle_inspections").select("submitter_user_id, submitted_at").eq("submitter_user_id", userId).gte("submitted_at", new Date(now - 60 * DAY).toISOString()),
    supabase.from("ppe_requests").select("submitter_user_id, status").eq("submitter_user_id", userId),
    loadJobs(),
    loadStaffDetails(),
  ]);

  return summarisePerson(userId, shifts, scheduled, jobs, staff, leave || [], checks || [], ppe || [], now);
}

/** Refreshes the two sources the Today view depends on, in parallel. */
export async function refreshOperationsData() {
  const [clock, schedule] = await Promise.all([syncTimeClock(), syncSchedule()]);
  return { shifts: clock.shifts, scheduledShifts: schedule.shifts };
}

/** Text block for Eleven's prompt; empty when the tables don't exist yet. */
export async function getTodayContextForEleven(): Promise<string> {
  try {
    const { overview } = await getTodayOverview();
    return overview.people.length === 0 ? "" : formatTodayContext(overview);
  } catch {
    return "";
  }
}
