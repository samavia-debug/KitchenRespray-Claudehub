import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { addDays, dublinDateKey, mondayOf } from "@/lib/connecteam/time-clock-summary";
import { loadStaffDetails } from "@/lib/connecteam/time-sync";
import type { OpsScheduled, OpsShift } from "@/lib/connecteam/operations";
import { CAPACITY_RULES, formatCapacityContext, summariseCapacity, type CapacityLeave, type CapacityOverview, type DemandDay, type SearchDay } from "./summary";

const SCHEDULED_COLUMNS = "shift_id, start_at, end_at, assigned_user_ids, is_open, is_published, job_id, tasks_total, tasks_done";

/** Reads our own tables only, so it works without calling Google or Connecteam. */
export async function getCapacityOverview(): Promise<CapacityOverview & { shiftsKnown: boolean }> {
  const supabase = createServiceClient();
  const now = Date.now();
  const today = dublinDateKey(now);
  const from = addDays(mondayOf(today), -7 * CAPACITY_RULES.pastWeeks);
  const to = addDays(mondayOf(today), 7 * (CAPACITY_RULES.futureWeeks + 1));
  // A day either side so a shift near midnight lands in the right Irish week.
  const fromIso = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString();
  const toIso = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString();

  // One row per site per day, so a year of sites would exceed the 1,000-row cap without paging.
  const analytics = await fetchAllRows<DemandDay & { website_id: string }>((a, b) =>
    supabase.from("analytics_metrics").select("website_id, date, sessions, conversions").gte("date", from).order("date").order("website_id").range(a, b)
  );
  const search = await fetchAllRows<SearchDay & { website_id: string }>((a, b) =>
    supabase.from("search_console_metrics").select("website_id, date, clicks").gte("date", from).order("date").order("website_id").range(a, b)
  );
  const shifts = await fetchAllRows<OpsShift>((a, b) =>
    supabase
      .from("time_clock_shifts")
      .select("shift_id, user_id, started_at, ended_at, job_id, scheduler_shift_id")
      .gte("started_at", fromIso)
      .order("started_at")
      .order("shift_id")
      .range(a, b)
  );
  const scheduled = await fetchAllRows<OpsScheduled>((a, b) =>
    supabase.from("scheduled_shifts").select(SCHEDULED_COLUMNS).gte("start_at", fromIso).lte("start_at", toIso).order("start_at").order("shift_id").range(a, b)
  );
  const leave = await fetchAllRows<CapacityLeave>((a, b) =>
    supabase.from("time_off_requests").select("user_id, leave_type, status, start_date, end_date, is_all_day").gte("end_date", from).order("start_date").order("request_id").range(a, b)
  );
  const staff = await loadStaffDetails();

  return { ...summariseCapacity(analytics, search, shifts, scheduled, leave, staff, now), shiftsKnown: shifts.length > 0 };
}

/** Text block for Eleven's prompt; empty when there is nothing to compare yet. */
export async function getCapacityContextForEleven(): Promise<string> {
  try {
    const o = await getCapacityOverview();
    if (!o.shiftsKnown) return "";
    return formatCapacityContext(o);
  } catch {
    return "";
  }
}
