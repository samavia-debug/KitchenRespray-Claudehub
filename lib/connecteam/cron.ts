import { isConnecteamConfigured } from "./client";
import { getConnecteamStatus, syncConnecteamStaff } from "./sync";
import { getVehicleStatus, syncVehicleInspections } from "./vehicles-sync";
import { getPpeStatus, syncPpeRequests } from "./ppe-sync";
import { getScheduleStatus, getTimeClockStatus, getTimeOffStatus, syncSchedule, syncTimeClock, syncTimeOff } from "./time-sync";

/** How long, in total, one Connecteam tick lets itself run. The scheduler gives up on a request after 30 seconds. */
export const CONNECTEAM_TICK_BUDGET_MS = 24_000;
/** A sync is only started when at least this much of the budget is left. */
const MIN_STAGE_BUDGET_MS = 9_000;

export type StageKey = "connecteamSync" | "vehiclesSync" | "ppeSync" | "timeClockSync" | "scheduleSync" | "timeOffSync";
export type StageResult = { synced?: number; error?: string; skipped?: string; ms?: number };

type Stage = {
  key: StageKey;
  /** The data counts as fresh until it is this many hours old. */
  staleHours: number;
  status: () => Promise<{ lastSyncedAt: string | null }>;
  run: () => Promise<number>;
};

// "Who's working now" and late arrivals need fresh clock-ins, so the clock and rota refresh on every
// 30-minute tick (24 minutes, so a tick that lands a little early still counts as due). The rest change slowly.
const STAGES: Stage[] = [
  { key: "timeClockSync", staleHours: 0.4, status: getTimeClockStatus, run: async () => (await syncTimeClock()).shifts },
  { key: "scheduleSync", staleHours: 0.4, status: getScheduleStatus, run: async () => (await syncSchedule()).shifts },
  { key: "timeOffSync", staleHours: 3, status: getTimeOffStatus, run: async () => (await syncTimeOff()).requests },
  { key: "vehiclesSync", staleHours: 3, status: getVehicleStatus, run: async () => (await syncVehicleInspections()).total },
  { key: "ppeSync", staleHours: 3, status: getPpeStatus, run: async () => (await syncPpeRequests()).total },
  { key: "connecteamSync", staleHours: 20, status: getConnecteamStatus, run: async () => (await syncConnecteamStaff()).total },
];

/**
 * The stages that are due, most overdue first. "Overdue" is the age as a multiple of how often the stage
 * should refresh, so a three-hour sync that has waited six hours goes before a clock sync that is a
 * little late. Because the budget can run out part-way through, this keeps one sync from always
 * being the one that gets skipped.
 */
export function dueOrder(ages: { key: StageKey; staleHours: number; ageHours: number }[]): StageKey[] {
  return ages
    .filter((a) => a.ageHours >= a.staleHours)
    .sort((a, b) => b.ageHours / b.staleHours - a.ageHours / a.staleHours)
    .map((a) => a.key);
}

/**
 * Runs the Connecteam syncs that are due, within a fixed time budget. Each has its own try/catch, so
 * a Connecteam problem in one never stops the others. What does not fit is simply picked up on the next tick.
 */
export async function runConnecteamTick(startedAt = Date.now(), budgetMs = CONNECTEAM_TICK_BUDGET_MS): Promise<Record<StageKey, StageResult>> {
  const results = Object.fromEntries(STAGES.map((s) => [s.key, { skipped: "not connected" } as StageResult])) as Record<StageKey, StageResult>;
  if (!isConnecteamConfigured()) return results;

  const ages: { key: StageKey; staleHours: number; ageHours: number }[] = [];
  await Promise.all(
    STAGES.map(async (s) => {
      try {
        const status = await s.status();
        const ageHours = status.lastSyncedAt ? (Date.now() - new Date(status.lastSyncedAt).getTime()) / 3_600_000 : Infinity;
        ages.push({ key: s.key, staleHours: s.staleHours, ageHours });
        if (ageHours < s.staleHours) results[s.key] = { skipped: "fresh" };
        else results[s.key] = { skipped: "out of time budget" };
      } catch (err: any) {
        results[s.key] = { error: err.message };
      }
    })
  );

  for (const key of dueOrder(ages)) {
    if (budgetMs - (Date.now() - startedAt) < MIN_STAGE_BUDGET_MS) break;
    const stage = STAGES.find((s) => s.key === key)!;
    const t0 = Date.now();
    try {
      results[key] = { synced: await stage.run(), ms: Date.now() - t0 };
    } catch (err: any) {
      results[key] = { error: err.message, ms: Date.now() - t0 };
    }
  }
  return results;
}
