import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/paginate";
import {
  fetchJobs,
  fetchTimeActivities,
  fetchTimeClocks,
  fetchTimeOffPolicyTypes,
  fetchTimeOffRequests,
  isConnecteamConfigured,
} from "./client";
import { CONNECTEAM_SOURCE, parseStaffContent } from "./mapping";
import { dateWindows, parseShifts, type ShiftRow } from "./time-clock";
import { formatClockContext, summariseClock, type ClockOverview, type ClockShiftInput, type StaffDetail } from "./time-clock-summary";
import { parseTimeOffRequest, type TimeOffRow } from "./time-off";
import { formatTimeOffContext, summariseTimeOff, type TimeOffOverview } from "./time-off-summary";

const DAY = 86_400_000;
const UPSERT_CHUNK = 500;
const ID_CHUNK = 100;

// Connecteam rejects clock-in ranges over about 90 days and time-off ranges
// over 365, so history is read in windows below those limits.
const CLOCK_WINDOW_DAYS = 60;
const TIME_OFF_WINDOW_DAYS = 360;
const CLOCK_BACKFILL_DAYS = 420;
const CLOCK_ROUTINE_DAYS = 45;
const FETCH_PARALLEL = 4;

async function upsertInChunks(table: string, rows: Record<string, unknown>[], onConflict: string) {
  const supabase = createServiceClient();
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function rowCount(table: string, column: string): Promise<number> {
  const { count, error } = await createServiceClient().from(table).select(column, { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function lastSynced(table: string): Promise<string | null> {
  const { data, error } = await createServiceClient().from(table).select("synced_at").order("synced_at", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.synced_at ?? null;
}

// ---- Time clock ----

export type TimeClockSyncResult = { shifts: number; jobs: number; backfilled: boolean };

/**
 * First run reads about 14 months of history; after that only the last 45
 * days are re-read each time, which also picks up an admin correcting a
 * missed clock-out. Rows are upserted by shift id.
 */
export async function syncTimeClock(): Promise<TimeClockSyncResult> {
  const backfill = (await rowCount("time_clock_shifts", "shift_id")) === 0;
  const now = Date.now();
  const windows = dateWindows(now - (backfill ? CLOCK_BACKFILL_DAYS : CLOCK_ROUTINE_DAYS) * DAY, now, CLOCK_WINDOW_DAYS);

  const clocks = (await fetchTimeClocks()).filter((c) => !c.isArchived);
  const tasks = clocks.flatMap((clock) => windows.map((w) => ({ clock, w })));

  // The first run makes around 16 calls at about 2 seconds each; four at a
  // time keeps it comfortably inside the host's 60 second limit.
  const byId = new Map<string, ShiftRow>();
  for (let i = 0; i < tasks.length; i += FETCH_PARALLEL) {
    const batch = await Promise.all(
      tasks.slice(i, i + FETCH_PARALLEL).map(async ({ clock, w }) => parseShifts(clock.id, await fetchTimeActivities(clock.id, w.startDate, w.endDate)))
    );
    for (const rows of batch) for (const row of rows) byId.set(row.shift_id, row);
  }

  const syncedAt = new Date().toISOString();
  await upsertInChunks("time_clock_shifts", Array.from(byId.values()).map((r) => ({ ...r, synced_at: syncedAt })), "shift_id");

  const jobs = await fetchJobs();
  await upsertInChunks(
    "connecteam_jobs",
    jobs.map((j) => ({ job_id: j.jobId, title: j.title, is_deleted: !!j.isDeleted, synced_at: syncedAt })),
    "job_id"
  );

  return { shifts: byId.size, jobs: jobs.length, backfilled: backfill };
}

// ---- Time off ----

export type TimeOffSyncResult = { requests: number; removed: number };

/**
 * Re-reads a year either side of today. A request cancelled in Connecteam
 * simply stops being returned, so afterwards any stored request that falls
 * inside the span but wasn't returned is removed, which keeps "who's off" honest.
 */
export async function syncTimeOff(): Promise<TimeOffSyncResult> {
  const backfill = (await rowCount("time_off_requests", "request_id")) === 0;
  const now = Date.now();
  const spanStart = now - (backfill ? 720 : 360) * DAY;
  const spanEnd = now + 360 * DAY;

  const typeNames = new Map((await fetchTimeOffPolicyTypes()).map((t) => [t.id, t.name]));
  const fetched = new Map<string, ReturnType<typeof parseTimeOffRequest>>();
  for (const w of dateWindows(spanStart, spanEnd, TIME_OFF_WINDOW_DAYS)) {
    for (const r of await fetchTimeOffRequests(w.startDate, w.endDate)) fetched.set(r.id, parseTimeOffRequest(r, typeNames));
  }

  const syncedAt = new Date().toISOString();
  await upsertInChunks("time_off_requests", Array.from(fetched.values()).map((r) => ({ ...r, synced_at: syncedAt })), "request_id");

  const supabase = createServiceClient();
  const from = new Date(spanStart).toISOString().slice(0, 10);
  const to = new Date(spanEnd).toISOString().slice(0, 10);
  const { data: stored, error } = await supabase.from("time_off_requests").select("request_id").gte("start_date", from).lte("start_date", to);
  if (error) throw new Error(error.message);

  // An empty answer is far more likely an API hiccup than a year with no
  // leave at all, so never delete on the strength of one.
  const gone = fetched.size === 0 ? [] : (stored || []).map((r) => r.request_id as string).filter((id) => !fetched.has(id));
  for (let i = 0; i < gone.length; i += ID_CHUNK) {
    const { error: delError } = await supabase.from("time_off_requests").delete().in("request_id", gone.slice(i, i + ID_CHUNK));
    if (delError) throw new Error(delError.message);
  }

  return { requests: fetched.size, removed: gone.length };
}

// ---- Status and overviews ----

export type SyncStatus = { configured: boolean; lastSyncedAt: string | null; count: number };

export async function getTimeClockStatus(): Promise<SyncStatus> {
  return { configured: isConnecteamConfigured(), lastSyncedAt: await lastSynced("time_clock_shifts"), count: await rowCount("time_clock_shifts", "shift_id") };
}

export async function getTimeOffStatus(): Promise<SyncStatus> {
  return { configured: isConnecteamConfigured(), lastSyncedAt: await lastSynced("time_off_requests"), count: await rowCount("time_off_requests", "request_id") };
}

/** Staff with their Connecteam role and team, read back from the synced staff entries. */
export async function loadStaffDetails(): Promise<StaffDetail[]> {
  const { data } = await createServiceClient()
    .from("knowledge_entries")
    .select("title, status, external_id, content")
    .eq("external_source", CONNECTEAM_SOURCE);

  return (data || [])
    .map((e) => {
      const d = parseStaffContent((e.content as string) ?? "");
      return { userId: Number(e.external_id), name: e.title as string, former: e.status === "archived", role: d.role, team: d.team };
    })
    .filter((s) => Number.isFinite(s.userId));
}

export async function getTimeClockOverview(): Promise<{ overview: ClockOverview; lastSyncedAt: string | null }> {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - 100 * DAY).toISOString();
  const rows = await fetchAllRows<ClockShiftInput & { synced_at: string }>((from, to) =>
    supabase
      .from("time_clock_shifts")
      .select("shift_id, user_id, started_at, ended_at, job_id, start_source, synced_at")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .order("shift_id")
      .range(from, to)
  );

  const { data: jobs } = await supabase.from("connecteam_jobs").select("job_id, title");
  const lastSyncedAt = rows.map((r) => r.synced_at as string).sort().slice(-1)[0] ?? null;
  return { overview: summariseClock(rows, jobs || [], await loadStaffDetails()), lastSyncedAt };
}

export async function getTimeOffOverview(): Promise<{ overview: TimeOffOverview; lastSyncedAt: string | null }> {
  const supabase = createServiceClient();
  const rows = await fetchAllRows<TimeOffRow & { synced_at: string }>((from, to) =>
    supabase
      .from("time_off_requests")
      .select("request_id, user_id, policy_type_id, leave_type, status, is_all_day, duration_days, start_date, end_date, start_time, end_time, synced_at")
      .order("start_date", { ascending: true })
      .order("request_id")
      .range(from, to)
  );
  const lastSyncedAt = rows.map((r) => r.synced_at as string).sort().slice(-1)[0] ?? null;
  return { overview: summariseTimeOff(rows, await loadStaffDetails()), lastSyncedAt };
}

/** Text blocks for Eleven's prompt; empty when the tables don't exist yet or hold nothing. */
export async function getTimeClockContextForEleven(): Promise<string> {
  try {
    const { overview, lastSyncedAt } = await getTimeClockOverview();
    return overview.periods.every((p) => p.people.length === 0) ? "" : formatClockContext(overview, lastSyncedAt);
  } catch {
    return "";
  }
}

export async function getTimeOffContextForEleven(): Promise<string> {
  try {
    const { overview, lastSyncedAt } = await getTimeOffOverview();
    return overview.yearPeople.length === 0 && overview.offToday.length === 0 && overview.upcoming.length === 0 ? "" : formatTimeOffContext(overview, lastSyncedAt);
  } catch {
    return "";
  }
}
