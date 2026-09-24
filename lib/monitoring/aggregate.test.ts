import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sum, avg, percentChange, sinceDaysAgo, splitLastNDays, getConnectedWebsiteIds } from "./aggregate";

describe("sum", () => {
  it("adds values, treating null as 0", () => {
    expect(sum([1, 2, null, 3])).toBe(6);
  });
  it("returns 0 for an empty array", () => {
    expect(sum([])).toBe(0);
  });
});

describe("avg", () => {
  it("averages non-null values", () => {
    expect(avg([2, 4, 6])).toBe(4);
  });
  it("returns null (not 0) for an empty array, so callers can distinguish 'no data' from a real zero average", () => {
    expect(avg([])).toBeNull();
  });
  it("returns null when every value is null", () => {
    expect(avg([null, null])).toBeNull();
  });
});

describe("percentChange", () => {
  it("computes a positive change", () => {
    expect(percentChange(150, 100)).toBe(50);
  });
  it("returns 0 when both periods are zero", () => {
    expect(percentChange(0, 0)).toBe(0);
  });
  it("returns null when there's no prior-period baseline to compare against", () => {
    expect(percentChange(10, 0)).toBeNull();
  });
});

describe("splitLastNDays", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("splits into two equal-width, non-overlapping 7-day windows", () => {
    const rows = [
      { date: "2026-09-25", value: 1 }, // today
      { date: "2026-09-24", value: 1 },
      { date: "2026-09-23", value: 1 },
      { date: "2026-09-22", value: 1 },
      { date: "2026-09-21", value: 1 },
      { date: "2026-09-20", value: 1 },
      { date: "2026-09-19", value: 1 }, // 6 days ago — last day still in "current"
      { date: "2026-09-18", value: 1 }, // 7 days ago — first day of "previous"
      { date: "2026-09-17", value: 1 },
      { date: "2026-09-16", value: 1 },
      { date: "2026-09-15", value: 1 },
      { date: "2026-09-14", value: 1 },
      { date: "2026-09-13", value: 1 },
      { date: "2026-09-12", value: 1 }, // 13 days ago — last day of "previous"
      { date: "2026-09-11", value: 1 }, // 14 days ago — outside both windows
    ];

    const { current, previous } = splitLastNDays(rows, 7);

    // The old buggy version made "current" 8 dates and "previous" 7 —
    // this locks in that both are exactly 7, with no overlap or gap.
    expect(current).toHaveLength(7);
    expect(previous).toHaveLength(7);
    expect(current.map((r) => r.date)).toEqual([
      "2026-09-25",
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
      "2026-09-20",
      "2026-09-19",
    ]);
    expect(previous.map((r) => r.date)).toEqual([
      "2026-09-18",
      "2026-09-17",
      "2026-09-16",
      "2026-09-15",
      "2026-09-14",
      "2026-09-13",
      "2026-09-12",
    ]);
    // 2026-09-11 (14 days ago) belongs to neither window.
    expect(current.some((r) => r.date === "2026-09-11")).toBe(false);
    expect(previous.some((r) => r.date === "2026-09-11")).toBe(false);
  });

  it("does not inflate a steady-traffic site's % change purely from the window width", () => {
    // 15 sessions every day for 14 days — a perfectly flat trend should
    // show 0% change, not the ~14% the old 8-vs-7-day bug would produce.
    const rows = Array.from({ length: 14 }, (_, i) => ({
      date: sinceDaysAgo(i),
      sessions: 15,
    }));
    const { current, previous } = splitLastNDays(rows, 7);
    const change = percentChange(sum(current.map((r) => r.sessions)), sum(previous.map((r) => r.sessions)));
    expect(change).toBe(0);
  });
});

describe("getConnectedWebsiteIds", () => {
  it("unions website_ids across multiple row sets", () => {
    const analytics = [{ website_id: "a" }, { website_id: "b" }];
    const searchConsole = [{ website_id: "b" }, { website_id: "c" }];
    const ids = getConnectedWebsiteIds(analytics, searchConsole);
    expect(Array.from(ids).sort()).toEqual(["a", "b", "c"]);
  });

  it("includes a site with rows present but every metric value at zero (the bug this replaces)", () => {
    const analytics = [{ website_id: "zero-traffic-site", sessions: 0, users: 0 }];
    const ids = getConnectedWebsiteIds(analytics);
    expect(ids.has("zero-traffic-site")).toBe(true);
  });
});
