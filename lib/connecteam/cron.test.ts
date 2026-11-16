import { afterEach, describe, expect, it, vi } from "vitest";
import { dueOrder, runConnecteamTick } from "./cron";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

vi.mock("./client", () => ({ isConnecteamConfigured: () => true }));
vi.mock("./sync", () => ({ getConnecteamStatus: async () => ({ lastSyncedAt: hoursAgo(1) }), syncConnecteamStaff: async () => ({ total: 1 }) }));
vi.mock("./vehicles-sync", () => ({ getVehicleStatus: async () => ({ lastSyncedAt: hoursAgo(1) }), syncVehicleInspections: async () => ({ total: 1 }) }));
vi.mock("../fleet/connecteam-sync", () => ({ getVanDocsStatus: async () => ({ lastSyncedAt: hoursAgo(1) }), syncVanDocuments: async () => ({ linked: 1 }) }));
vi.mock("./ppe-sync", () => ({ getPpeStatus: async () => ({ lastSyncedAt: hoursAgo(1) }), syncPpeRequests: async () => ({ total: 1 }) }));
const timeSync = vi.hoisted(() => ({ clock: vi.fn(), schedule: vi.fn() }));
vi.mock("./time-sync", () => ({
  getTimeClockStatus: async () => ({ lastSyncedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() }),
  getScheduleStatus: async () => ({ lastSyncedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() }),
  getTimeOffStatus: async () => ({ lastSyncedAt: new Date(Date.now() - 3_600_000).toISOString() }),
  syncTimeClock: timeSync.clock,
  syncSchedule: timeSync.schedule,
  syncTimeOff: async () => ({ requests: 1 }),
}));

describe("runConnecteamTick", () => {
  afterEach(() => vi.clearAllMocks());

  it("runs the due syncs together, so the tick takes as long as the slowest rather than the total", async () => {
    timeSync.clock.mockImplementation(async () => (await sleep(120), { shifts: 5 }));
    timeSync.schedule.mockImplementation(async () => (await sleep(120), { shifts: 7 }));
    const t0 = Date.now();
    const results = await runConnecteamTick(Date.now(), 5_000);
    expect(Date.now() - t0).toBeLessThan(220);
    expect(results.timeClockSync.synced).toBe(5);
    expect(results.scheduleSync.synced).toBe(7);
    expect(results.ppeSync).toEqual({ skipped: "fresh" });
  });

  it("answers at the time budget and reports a sync still running, rather than hanging past the scheduler's limit", async () => {
    timeSync.clock.mockImplementation(async () => (await sleep(30), { shifts: 5 }));
    timeSync.schedule.mockImplementation(() => sleep(2_000).then(() => ({ shifts: 7 })));
    const t0 = Date.now();
    const results = await runConnecteamTick(Date.now(), 200);
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(results.timeClockSync.synced).toBe(5);
    expect(results.scheduleSync).toEqual({ skipped: "still running after the time budget" });
  });

  it("keeps one failing sync from stopping the other", async () => {
    timeSync.clock.mockRejectedValue(new Error("Connecteam API returned HTTP 500"));
    timeSync.schedule.mockResolvedValue({ shifts: 3 });
    const results = await runConnecteamTick(Date.now(), 5_000);
    expect(results.timeClockSync.error).toMatch(/HTTP 500/);
    expect(results.scheduleSync.synced).toBe(3);
  });
});

describe("dueOrder", () => {
  it("leaves out anything that is still fresh", () => {
    expect(
      dueOrder([
        { key: "ppeSync", staleHours: 3, ageHours: 1 },
        { key: "scheduleSync", staleHours: 0.4, ageHours: 0.5 },
      ])
    ).toEqual(["scheduleSync"]);
  });

  it("puts the most overdue first, measured against how often each should refresh", () => {
    expect(
      dueOrder([
        { key: "scheduleSync", staleHours: 0.4, ageHours: 0.5 }, // 1.25 times its interval
        { key: "ppeSync", staleHours: 3, ageHours: 9 }, // 3 times
        { key: "connecteamSync", staleHours: 20, ageHours: 30 }, // 1.5 times
      ])
    ).toEqual(["ppeSync", "connecteamSync", "scheduleSync"]);
  });

  it("treats a sync that has never run as the most overdue", () => {
    expect(
      dueOrder([
        { key: "ppeSync", staleHours: 3, ageHours: 100 },
        { key: "timeOffSync", staleHours: 3, ageHours: Infinity },
      ])[0]
    ).toBe("timeOffSync");
  });

  it("does the clock and rota on every 30-minute tick even when one lands a little early", () => {
    // 27 minutes old is past the 24-minute mark.
    expect(dueOrder([{ key: "timeClockSync", staleHours: 0.4, ageHours: 0.45 }])).toEqual(["timeClockSync"]);
  });
});
