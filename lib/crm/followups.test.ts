import { describe, expect, it } from "vitest";
import { addDays, dublinToday, dueRange, weekEnd } from "./followups";

describe("dates", () => {
  it("uses the Irish day, not the UTC day", () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in Dublin (summer time).
    expect(dublinToday(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    // In winter Dublin is on UTC.
    expect(dublinToday(new Date("2026-12-30T23:30:00Z"))).toBe("2026-12-30");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the Sunday that ends the week", () => {
    expect(weekEnd("2026-10-19")).toBe("2026-10-25"); // Monday
    expect(weekEnd("2026-10-24")).toBe("2026-10-25"); // Saturday
    expect(weekEnd("2026-10-25")).toBe("2026-10-25"); // Sunday
  });
});

describe("dueRange", () => {
  const today = "2026-10-21"; // a Wednesday

  it("splits open follow-ups so each falls in exactly one list", () => {
    expect(dueRange("overdue", today)).toEqual({ status: "open", to: "2026-10-20" });
    expect(dueRange("today", today)).toEqual({ status: "open", from: today, to: today });
    expect(dueRange("week", today)).toEqual({ status: "open", from: "2026-10-22", to: "2026-10-25" });
    expect(dueRange("upcoming", today)).toEqual({ status: "open", from: "2026-10-26" });
    expect(dueRange("completed", today)).toEqual({ status: "done" });
  });

  it("has an empty rest-of-week on a Sunday, and upcoming starts tomorrow", () => {
    const range = dueRange("week", "2026-10-25");
    expect(range.from && range.to && range.from > range.to).toBe(true);
    expect(dueRange("upcoming", "2026-10-25")).toEqual({ status: "open", from: "2026-10-26" });
  });
});
