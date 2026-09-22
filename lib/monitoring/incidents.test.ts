import { describe, expect, it } from "vitest";
import { decideIncidentAction, formatDuration } from "./incidents";

describe("decideIncidentAction", () => {
  it("opens a new incident when a site goes critical with no open incident", () => {
    expect(decideIncidentAction("critical", false)).toEqual({ type: "open", severity: "critical" });
  });

  it("opens a new incident when a site goes offline with no open incident", () => {
    expect(decideIncidentAction("offline", false)).toEqual({ type: "open", severity: "offline" });
  });

  it("continues (does not duplicate) an already-open incident when still critical", () => {
    expect(decideIncidentAction("critical", true)).toEqual({ type: "continue" });
  });

  it("continues an already-open incident when still offline", () => {
    expect(decideIncidentAction("offline", true)).toEqual({ type: "continue" });
  });

  it("resolves an open incident when the site recovers to healthy", () => {
    expect(decideIncidentAction("healthy", true)).toEqual({ type: "resolve" });
  });

  it("resolves an open incident when the site only recovers to attention", () => {
    expect(decideIncidentAction("attention", true)).toEqual({ type: "resolve" });
  });

  it("does nothing for a healthy site with no open incident", () => {
    expect(decideIncidentAction("healthy", false)).toEqual({ type: "none" });
  });

  it("does nothing for an attention-level site with no open incident — attention alone doesn't open an incident", () => {
    expect(decideIncidentAction("attention", false)).toEqual({ type: "none" });
  });

  it("does nothing for an unknown status with no open incident", () => {
    expect(decideIncidentAction("unknown", false)).toEqual({ type: "none" });
  });

  it("resolves an open incident even if the new status is unknown", () => {
    expect(decideIncidentAction("unknown", true)).toEqual({ type: "resolve" });
  });
});

describe("formatDuration", () => {
  const start = "2026-01-01T00:00:00.000Z";

  it("formats minutes only, under an hour", () => {
    expect(formatDuration(start, "2026-01-01T00:45:00.000Z")).toBe("45m");
  });

  it("formats hours and minutes, under a day", () => {
    expect(formatDuration(start, "2026-01-01T02:15:00.000Z")).toBe("2h 15m");
  });

  it("formats days and hours once past 24 hours", () => {
    expect(formatDuration(start, "2026-01-03T02:00:00.000Z")).toBe("2d 2h");
  });

  it("treats a null end as ongoing (measures up to now)", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const result = formatDuration(fiveMinutesAgo, null);
    expect(result).toMatch(/^[45]m$/);
  });

  it("never returns a negative duration for a clock-skew edge case", () => {
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(formatDuration(future, null)).toBe("0m");
  });
});
