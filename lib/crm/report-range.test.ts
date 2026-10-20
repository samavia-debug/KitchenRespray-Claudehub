import { describe, expect, it } from "vitest";
import { dublinDayStart, eachDay, resolveRange, weekStart } from "./report-range";

const ok = (r: ReturnType<typeof resolveRange>) => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("dublinDayStart", () => {
  it("is midnight UTC in winter and 23:00 UTC the evening before in summer", () => {
    expect(dublinDayStart("2026-01-15")).toBe("2026-01-15T00:00:00.000Z");
    expect(dublinDayStart("2026-07-01")).toBe("2026-06-30T23:00:00.000Z");
  });

  it("is right on the days the clocks change", () => {
    // Summer time began on 29 March 2026 (01:00), and ended on 25 October 2026 (02:00).
    expect(dublinDayStart("2026-03-29")).toBe("2026-03-29T00:00:00.000Z");
    expect(dublinDayStart("2026-03-30")).toBe("2026-03-29T23:00:00.000Z");
    expect(dublinDayStart("2026-10-25")).toBe("2026-10-24T23:00:00.000Z");
    expect(dublinDayStart("2026-10-26")).toBe("2026-10-26T00:00:00.000Z");
  });
});

describe("weekStart", () => {
  it("finds the Monday of any day of the week, Sunday included", () => {
    expect(weekStart("2026-10-21")).toBe("2026-10-19"); // Wednesday
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // Monday
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday belongs to the week before Monday
  });
});

describe("resolveRange", () => {
  const today = "2026-10-21"; // a Wednesday

  it("gives whole Monday-to-Sunday weeks", () => {
    expect(ok(resolveRange("this_week", today))).toMatchObject({ from: "2026-10-19", to: "2026-10-25", label: "This week" });
    expect(ok(resolveRange("last_week", today))).toMatchObject({ from: "2026-10-12", to: "2026-10-18", label: "Last week" });
  });

  it("gives whole calendar months, including February in a leap year", () => {
    expect(ok(resolveRange("this_month", today))).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(ok(resolveRange("last_month", today))).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(ok(resolveRange("last_month", "2028-03-10"))).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
    expect(ok(resolveRange("last_month", "2026-01-05"))).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("gives the last 30 days ending today", () => {
    expect(ok(resolveRange("last_30", today))).toMatchObject({ from: "2026-09-22", to: "2026-10-21" });
  });

  it("defaults to this month for anything it does not know", () => {
    expect(ok(resolveRange("whenever", today)).preset).toBe("this_month");
    expect(ok(resolveRange(null, today)).preset).toBe("this_month");
  });

  it("measures the range in instants, so the end is the start of the next Irish day", () => {
    const r = ok(resolveRange("this_week", today));
    // The week of 19 to 25 October 2026 straddles the clocks going back on the 25th.
    expect(r.startIso).toBe("2026-10-18T23:00:00.000Z");
    expect(r.endIso).toBe("2026-10-26T00:00:00.000Z");
  });

  it("takes a custom range, and labels it", () => {
    const r = ok(resolveRange("custom", today, "2026-09-01", "2026-09-15"));
    expect(r).toMatchObject({ preset: "custom", from: "2026-09-01", to: "2026-09-15", label: "1 Sep 2026 to 15 Sep 2026" });
    expect(ok(resolveRange("custom", today, "2026-09-15", "2026-09-15"))).toMatchObject({ from: "2026-09-15", to: "2026-09-15" });
  });

  it("refuses a custom range that is missing, not a date, backwards, or longer than a year", () => {
    const err = (a?: string, b?: string) => ("error" in resolveRange("custom", today, a, b) ? (resolveRange("custom", today, a, b) as { error: string }).error : "");
    expect(err()).toMatch(/start and an end/);
    expect(err("2026-02-31", "2026-03-01")).toMatch(/start and an end/);
    expect(err("2026-09-15", "2026-09-01")).toMatch(/not be after/);
    expect(err("2025-01-01", "2026-12-31")).toMatch(/year or less/);
    expect(err("2026-01-01", "2026-12-31")).toBe("");
  });
});

describe("eachDay", () => {
  it("lists every day inclusive, across a month end", () => {
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(eachDay("2026-10-30", "2026-10-30")).toEqual(["2026-10-30"]);
  });
});
