import { describe, expect, it } from "vitest";
import { normalizeReg, parseInspection, parseInspections, parseOdometer } from "./vehicles";
import { summariseVehicles, type StaffRef, type SummaryRow } from "./vehicles-summary";
import type { ConnecteamForm, FormSubmission } from "./client";

const form: ConnecteamForm = {
  formId: 1,
  formName: "Weekly Driver's Vehicle Inspection Report",
  questions: [
    { questionId: "d", title: "Date of inspection", questionType: "datetime" },
    { questionId: "t", title: "Pre-Trip or Post-Trip?", questionType: "yesNo", allAnswers: [{ yesNoOptionId: 0, text: "Pre-Trip" }, { yesNoOptionId: 1, text: "Post-Trip" }] },
    { questionId: "n", title: "Driver's Full Name", questionType: "openEnded" },
    { questionId: "r", title: "Vehicle Registration", questionType: "openEnded" },
    { questionId: "m", title: "Vehicle Make and Model", questionType: "openEnded" },
    { questionId: "o", title: "Odometer Reading", questionType: "openEnded" },
    { questionId: "x", title: "Check any defective item", questionType: "multipleChoice" },
    { questionId: "k", title: "Remarks", questionType: "openEnded" },
    { questionId: "s", title: "Safety Equipment (Fire extinguisher & First aid kit)", questionType: "yesNo", allAnswers: [{ yesNoOptionId: 0, text: "Yes" }, { yesNoOptionId: 1, text: "No" }] },
    { questionId: "c", title: "Condition of the above vehicle is acceptable", questionType: "yesNo", allAnswers: [{ yesNoOptionId: 0, text: "Yes" }, { yesNoOptionId: 1, text: "No" }] },
  ],
};

const submission = (over: Partial<Record<string, any>> = {}): FormSubmission => ({
  formSubmissionId: "sub-1",
  formId: 1,
  submissionTimestamp: 1_791_039_736,
  submittingUserId: 77,
  answers: [
    { questionId: "d", questionType: "datetime", timestamp: 1_791_039_720 },
    { questionId: "t", questionType: "yesNo", selectedIndex: 1 },
    { questionId: "n", questionType: "openEnded", value: " Sam Test " },
    { questionId: "r", questionType: "openEnded", value: over.reg ?? "191-D-12345" },
    { questionId: "m", questionType: "openEnded", value: "Ford Transit" },
    { questionId: "o", questionType: "openEnded", value: over.odo ?? "123.456" },
    {
      questionId: "x",
      questionType: "multipleChoice",
      selectedAnswers: over.defects ?? [{ text: "Other or everything working well" }],
    },
    { questionId: "k", questionType: "openEnded", value: "" },
    { questionId: "s", questionType: "yesNo", selectedIndex: over.safety ?? 0 },
    { questionId: "c", questionType: "yesNo", selectedIndex: over.cond ?? 0 },
  ],
});

describe("normalizeReg / parseOdometer", () => {
  it("treats every spelling of a registration as the same vehicle", () => {
    expect(normalizeReg("191-D-12345")).toBe("191D12345");
    expect(normalizeReg("191 d 12345")).toBe("191D12345");
    expect(normalizeReg("191.D.12345")).toBe("191D12345");
  });

  it("reads the odometer's free text, rejecting junk", () => {
    expect(parseOdometer("123456")).toBe(123456);
    expect(parseOdometer("123.456")).toBe(123456);
    expect(parseOdometer("999999AA")).toBe(999999);
    expect(parseOdometer("-")).toBeNull();
    expect(parseOdometer("9")).toBeNull();
    expect(parseOdometer("")).toBeNull();
    expect(parseOdometer(undefined)).toBeNull();
    expect(parseOdometer("99999999")).toBeNull();
  });
});

describe("parseInspection", () => {
  it("turns a submission into a clean row, resolving yes/no labels", () => {
    const row = parseInspection(form, submission())!;
    expect(row.vehicle_key).toBe("191D12345");
    expect(row.vehicle_reg).toBe("191-D-12345");
    expect(row.driver_name).toBe("Sam Test");
    expect(row.odometer_km).toBe(123456);
    expect(row.trip_type).toBe("Post-Trip");
    expect(row.safety_equipment_ok).toBe(true);
    expect(row.condition_ok).toBe(true);
    expect(row.submitter_user_id).toBe(77);
    expect(row.submitted_at).toBe(new Date(1_791_039_736 * 1000).toISOString());
  });

  it("drops the 'nothing wrong' option but keeps real defects", () => {
    expect(parseInspection(form, submission())!.defects).toEqual([]);
    const row = parseInspection(form, submission({ defects: [{ text: "Tires " }, { text: "Other or everything working well" }, { text: "Windows" }] }))!;
    expect(row.defects).toEqual(["Tires", "Windows"]);
  });

  it("reads 'No' answers as false", () => {
    const row = parseInspection(form, submission({ safety: 1, cond: 1 }))!;
    expect(row.safety_equipment_ok).toBe(false);
    expect(row.condition_ok).toBe(false);
  });

  it("skips a submission with no registration instead of guessing a vehicle", () => {
    expect(parseInspection(form, submission({ reg: "  " }))).toBeNull();
    const { rows, skipped } = parseInspections(form, [submission(), submission({ reg: "" })]);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

const NOW = new Date("2026-10-06T12:00:00Z").getTime();
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const row = (key: string, days: number, uid: number | null, over: Partial<SummaryRow> = {}): SummaryRow => ({
  vehicle_key: key,
  vehicle_reg: key,
  make_model: "Van",
  submitted_at: ago(days),
  submitter_user_id: uid,
  driver_name: "Typed Name",
  odometer_text: "100000",
  odometer_km: 100000,
  trip_type: "Pre-Trip",
  defects: [],
  safety_equipment_ok: true,
  condition_ok: true,
  ...over,
});

const staff: StaffRef[] = [
  { userId: 1, name: "Anna Driver", former: false },
  { userId: 2, name: "Ben Driver", former: false },
  { userId: 3, name: "Cara Gone", former: true },
];

describe("summariseVehicles", () => {
  const rows = [
    row("AAA1", 2, 1), row("AAA1", 20, 1), // regular, fresh
    row("BBB2", 30, 2), row("BBB2", 40, 2), // regular, overdue (30 days)
    row("CCC3", 5, 1), // one report only: one-off
    row("DDD4", 200, 2), // dormant: not listed
    row("AAA1", 3, 3), // a former employee also submitted
  ];
  const o = summariseVehicles(rows, staff, NOW);

  it("classifies regular, overdue and one-off vehicles, and hides dormant ones", () => {
    const by = Object.fromEntries(o.vehicles.map((v) => [v.key, v]));
    expect(by.AAA1.regular).toBe(true);
    expect(by.AAA1.overdue).toBe(false);
    expect(by.BBB2.overdue).toBe(true);
    expect(by.CCC3.regular).toBe(false);
    expect(by.DDD4).toBeUndefined();
    expect(o.regularVehicles).toBe(2);
    expect(o.overdueVehicles).toBe(1);
  });

  it("lists overdue vehicles first", () => {
    expect(o.vehicles[0].key).toBe("BBB2");
  });

  it("finds regular drivers who haven't submitted this week, ignoring people who have left", () => {
    expect(o.regularDrivers.map((d) => d.name).sort()).toEqual(["Anna Driver", "Ben Driver"]);
    expect(o.missingDrivers.map((d) => d.name)).toEqual(["Ben Driver"]);
  });

  it("flags defect reports and missing safety equipment", () => {
    const withDefects = summariseVehicles(
      [row("AAA1", 1, 1, { defects: ["Tires"], safety_equipment_ok: false }), row("AAA1", 9, 1)],
      staff,
      NOW
    );
    expect(withDefects.recentDefects).toHaveLength(1);
    expect(withDefects.recentDefects[0].defects).toEqual(["Tires"]);
    expect(withDefects.safetyEquipmentMissingOnRegular).toBe(1);
    expect(withDefects.vehicles[0].defectReports90).toBe(1);
  });

  it("counts reports in the recent windows", () => {
    expect(o.totals.reports7).toBe(3);
  });
});
