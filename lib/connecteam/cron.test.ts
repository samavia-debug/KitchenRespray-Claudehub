import { describe, expect, it } from "vitest";
import { dueOrder } from "./cron";

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
