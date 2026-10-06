import { describe, expect, it } from "vitest";
import { formatScorecardContext, levelFor, SCORE_RULES, splitList, summariseScorecard, weekRanges, type ScoreInspection, type ScorePpe } from "./scorecard";
import type { OpsScheduled, OpsShift } from "./operations";
import type { StaffDetail } from "./time-clock-summary";

// Wednesday 7 Oct 2026. Latest full week = Mon 28 Sep to Sun 4 Oct; the week before = 21 to 27 Sep.
const NOW = Date.parse("2026-10-07T12:00:00Z");

describe("weekRanges", () => {
  it("returns the week so far, then whole Monday to Sunday weeks going back", () => {
    const w = weekRanges("2026-10-07", 3);
    expect(w[0]).toEqual({ from: "2026-10-05", to: "2026-10-07", partial: true });
    expect(w[1]).toEqual({ from: "2026-09-28", to: "2026-10-04", partial: false });
    expect(w[3]).toEqual({ from: "2026-09-14", to: "2026-09-20", partial: false });
  });
});

describe("levelFor", () => {
  it("flags high late and safety figures, and low inspection and PPE figures", () => {
    expect(levelFor("latePct", 10)).toBe("good");
    expect(levelFor("latePct", SCORE_RULES.amber.latePct)).toBe("amber");
    expect(levelFor("latePct", 50)).toBe("red");
    expect(levelFor("inspectionPct", 100)).toBe("good");
    expect(levelFor("inspectionPct", 60)).toBe("amber");
    expect(levelFor("inspectionPct", 40)).toBe("red");
    expect(levelFor("safetyMissingPct", 40)).toBe("red");
    expect(levelFor("ppeDonePct", 70)).toBe("amber");
  });

  it("never marks an unknown figure as a problem", () => {
    expect(levelFor("latePct", null)).toBe("good");
    expect(levelFor("inspectionPct", null)).toBe("good");
  });
});

describe("splitList", () => {
  it("splits a multi-value field and ignores blanks", () => {
    expect(splitList("Bray, Kylemore ,")).toEqual(["Bray", "Kylemore"]);
    expect(splitList(undefined)).toEqual([]);
  });
});

const staff: StaffDetail[] = [
  { userId: 1, name: "Anna Painter", former: false, branch: "Kylemore", team: "Kylemore, Baths", department: "Field Operations" },
  { userId: 2, name: "Ben Sprayer", former: false, branch: "Bray", team: "Bray", department: "Field Operations" },
  { userId: 3, name: "Cara Fitter", former: false, branch: "Kylemore", team: "Carpentry", department: "Carpenters" },
  { userId: 4, name: "Dara Quiet", former: false },
  { userId: 5, name: "Eoin Gone", former: true, branch: "Bray" },
];

const shift = (id: string, user: number, startIso: string, hours: number | null, link: string | null = null): OpsShift => ({
  shift_id: id,
  user_id: user,
  started_at: startIso,
  ended_at: hours === null ? null : new Date(Date.parse(startIso) + hours * 3_600_000).toISOString(),
  job_id: "w",
  scheduler_shift_id: link,
});
const plan = (id: string, user: number, startIso: string): OpsScheduled => ({
  shift_id: id,
  start_at: startIso,
  end_at: new Date(Date.parse(startIso) + 8 * 3_600_000).toISOString(),
  assigned_user_ids: [user],
  is_open: false,
  is_published: true,
  job_id: "w",
  tasks_total: 6,
  tasks_done: 0,
});

// Anna: five 8h days Mon 28 Sep to Fri 2 Oct, each scheduled at 08:00; she is 20 minutes late on the first.
const annaDays = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const scheduled: OpsScheduled[] = annaDays.map((d, i) => plan(`pa${i}`, 1, `${d}T08:00:00Z`));
const shifts: OpsShift[] = [
  ...annaDays.map((d, i) => shift(`a${i}`, 1, i === 0 ? `${d}T08:20:00Z` : `${d}T08:00:00Z`, 8, `pa${i}`)),
  shift("b1", 2, "2026-09-28T08:00:00Z", 8),
  shift("b2", 2, "2026-09-29T08:00:00Z", 8),
  shift("b-bad", 2, "2026-09-30T08:00:00Z", 20), // forgotten clock-out
  shift("c1", 3, "2026-09-28T08:00:00Z", 8),
  shift("c2", 3, "2026-09-29T08:00:00Z", 8),
  shift("e1", 5, "2026-09-29T08:00:00Z", 8), // has since left
];
const inspections: ScoreInspection[] = [
  { submitter_user_id: 1, submitted_at: "2026-09-29T09:00:00Z", safety_equipment_ok: false, condition_ok: true, defects: [] }, // Anna, latest full week
  { submitter_user_id: 2, submitted_at: "2026-09-22T09:00:00Z", safety_equipment_ok: true, condition_ok: true, defects: ["Tires"] }, // Ben, week before
];
const ppe: ScorePpe[] = [
  { submitter_user_id: 2, submitted_at: "2026-09-29T09:00:00Z", status: "Done", status_updated_at: "2026-09-29T20:00:00Z" }, // Ben: done in 11h
  { submitter_user_id: 3, submitted_at: "2026-09-30T09:00:00Z", status: null, status_updated_at: null }, // Cara: still open
];

describe("summariseScorecard by branch", () => {
  const o = summariseScorecard("branch", shifts, scheduled, inspections, ppe, staff, NOW);
  const g = Object.fromEntries(o.groups.map((x) => [x.name, x]));
  const week = (name: string) => g[name].weeks[1]; // latest full week

  it("builds one group per branch plus 'Not set', largest first, with whole-company alongside", () => {
    expect(o.groups.map((x) => x.name)).toEqual(["Kylemore", "Bray", "Not set"]);
    expect(g.Kylemore.headcount).toBe(2);
    expect(o.everyone.name).toBe("Whole company");
    expect(o.weeks).toHaveLength(SCORE_RULES.weeks + 1);
  });

  it("totals hours and rates the late arrivals against scheduled clock-ins only", () => {
    const k = week("Kylemore");
    expect(k.worked).toBe(2);
    expect(k.hours).toBe(56); // Anna 40 + Cara 16
    expect(k.hoursPerPerson).toBe(28);
    expect(k.linkedClockIns).toBe(5);
    expect(k.late).toBe(1);
    expect(k.latePct).toBe(20);
  });

  it("leaves a forgotten clock-out out of the hours and counts it", () => {
    const b = week("Bray");
    expect(b.hours).toBe(16);
    expect(b.forgottenClockOuts).toBe(1);
  });

  it("measures the vehicle-check rate among drivers who worked that week", () => {
    const k = week("Kylemore");
    expect(k.drivers).toBe(1); // Anna is a driver; Cara has never inspected so isn't expected to
    expect(k.inspected).toBe(1);
    expect(k.inspectionPct).toBe(100);
    const b = week("Bray");
    expect(b.drivers).toBe(1);
    expect(b.inspected).toBe(0); // Ben inspected the week before, not this one
    expect(b.inspectionPct).toBe(0);
  });

  it("reports how often safety equipment was missing", () => {
    expect(week("Kylemore")).toMatchObject({ reports: 1, safetyMissing: 1, safetyMissingPct: 100 });
    expect(week("Bray").safetyMissingPct).toBeNull(); // no reports that week
  });

  it("measures how quickly PPE requests were closed", () => {
    expect(week("Bray")).toMatchObject({ ppeSettled: 1, ppeDoneFast: 1, ppeDonePct: 100, ppeOpen: 0 });
    expect(week("Kylemore")).toMatchObject({ ppeSettled: 1, ppeDoneFast: 0, ppeDonePct: 0, ppeOpen: 1 });
  });

  it("shows empty weeks as unknown rather than zero percent", () => {
    const n = week("Not set");
    expect(n.worked).toBe(0);
    expect(n.hoursPerPerson).toBeNull();
    expect(n.inspectionPct).toBeNull();
    expect(n.latePct).toBeNull();
  });

  it("counts people who have since left in the whole-company line but not in a group headcount", () => {
    expect(o.everyone.weeks[1].hours).toBe(56 + 16 + 8);
    expect(g.Bray.headcount).toBe(1);
  });
});

describe("summariseScorecard by team", () => {
  const o = summariseScorecard("team", shifts, scheduled, inspections, ppe, staff, NOW);

  it("counts someone in two teams in both", () => {
    const names = o.groups.map((x) => x.name).sort();
    expect(names).toEqual(["Baths", "Bray", "Carpentry", "Kylemore", "Not set"]);
    const baths = o.groups.find((x) => x.name === "Baths")!;
    const kylemore = o.groups.find((x) => x.name === "Kylemore")!;
    expect(baths.weeks[1].hours).toBe(40);
    expect(kylemore.weeks[1].hours).toBe(40);
  });
});

describe("formatScorecardContext", () => {
  it("states the definitions and lists each group with its previous week", () => {
    const text = formatScorecardContext([summariseScorecard("branch", shifts, scheduled, inspections, ppe, staff, NOW)]);
    expect(text).toContain("latest full week is 28 Sep 2026 to 4 Oct 2026");
    expect(text).toContain("Whole company");
    expect(text).toContain("Kylemore (2 staff)");
    expect(text).toContain("vehicle check 1 of 1 drivers = 100%");
    expect(text).toContain("Amber or red marks a figure that needs attention");
  });
});
