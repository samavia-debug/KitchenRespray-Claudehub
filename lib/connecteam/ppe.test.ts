import { describe, expect, it } from "vitest";
import { parsePpeRequest } from "./ppe";
import { formatPpeContext, summarisePpe, type PpeSummaryRow } from "./ppe-summary";
import type { StaffRef } from "./vehicles-summary";
import type { ConnecteamForm, FormSubmission } from "./client";

const form: ConnecteamForm = {
  formId: 2,
  formName: "Tools & PPE Order Request",
  questions: [
    { questionId: "i", title: "Requested Tools &PPE Items 👷🏻", questionType: "multipleChoice" },
    { questionId: "q", title: "Quantity Needed", questionType: "number" },
    { questionId: "s", title: "Spray suit Size", questionType: "multipleChoice" },
    { questionId: "o", title: "If other please specify ", questionType: "openEnded" },
    { questionId: "d", title: "Date Required", questionType: "datetime" },
  ],
};

const submission = (over: Partial<FormSubmission> = {}): FormSubmission => ({
  formSubmissionId: "p-1",
  formId: 2,
  submissionTimestamp: 1_791_000_000,
  submittingUserId: 5,
  answers: [
    { questionId: "i", questionType: "multipleChoice", selectedAnswers: [{ text: "Gloves " }, { text: "Spray suit" }] },
    { questionId: "q", questionType: "number", inputValue: 2 },
    { questionId: "s", questionType: "multipleChoice", selectedAnswers: [{ text: "L" }] },
    { questionId: "o", questionType: "openEnded", value: "  for new starter " },
    { questionId: "d", questionType: "datetime", timestamp: 1_791_086_400 },
  ],
  managerFields: [
    { managerFieldId: "a", managerFieldType: "status", status: { name: "Done" }, lastUpdatedTimestamp: 1_791_007_200 },
    { managerFieldId: "b", managerFieldType: "note", note: " ordered " },
  ],
  ...over,
});

describe("parsePpeRequest", () => {
  it("reads items, quantity, size, details, date, status and manager note", () => {
    const r = parsePpeRequest(form, submission());
    expect(r.items).toEqual(["Gloves", "Spray suit"]);
    expect(r.quantity).toBe(2);
    expect(r.spray_suit_sizes).toEqual(["L"]);
    expect(r.other_text).toBe("for new starter");
    expect(r.status).toBe("Done");
    expect(r.manager_note).toBe("ordered");
    expect(r.submitter_user_id).toBe(5);
    expect(r.status_updated_at).toBe(new Date(1_791_007_200 * 1000).toISOString());
    expect(r.date_required).toBe(new Date(1_791_086_400 * 1000).toISOString());
  });

  it("treats a request with no manager status as having no status", () => {
    const r = parsePpeRequest(form, submission({ managerFields: [{ managerFieldId: "a", managerFieldType: "status" }, { managerFieldId: "b", managerFieldType: "note" }] }));
    expect(r.status).toBeNull();
    expect(r.manager_note).toBeNull();
    expect(r.status_updated_at).toBeNull();
  });

  it("copes with a request that has no answers at all", () => {
    const r = parsePpeRequest(form, submission({ answers: [], managerFields: undefined }));
    expect(r.items).toEqual([]);
    expect(r.quantity).toBeNull();
    expect(r.other_text).toBeNull();
  });
});

const NOW = new Date("2026-10-06T12:00:00Z").getTime();
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const req = (id: string, days: number, over: Partial<PpeSummaryRow> = {}): PpeSummaryRow => ({
  submission_id: id,
  submitted_at: ago(days),
  submitter_user_id: 1,
  items: ["Gloves"],
  quantity: 1,
  spray_suit_sizes: [],
  other_text: null,
  status: "Done",
  status_updated_at: new Date(new Date(ago(days)).getTime() + 2 * 3_600_000).toISOString(),
  manager_note: null,
  ...over,
});
const staff: StaffRef[] = [{ userId: 1, name: "Anna Painter", former: false }];

describe("summarisePpe", () => {
  const rows = [
    req("done-recent", 2),
    req("open-new", 3, { status: null, status_updated_at: null, items: ["Masking tape", "Gloves"], quantity: 5 }),
    req("working", 10, { status: "Working on it", status_updated_at: null }),
    req("open-old", 100, { status: null, status_updated_at: null }),
    req("done-old", 200),
  ];
  const o = summarisePpe(rows, staff, NOW);

  it("treats anything not marked Done as open, splitting recent from forgotten", () => {
    expect(o.openRecent.map((r) => r.id).sort()).toEqual(["open-new", "working"]);
    expect(o.openStale.map((r) => r.id)).toEqual(["open-old"]);
  });

  it("names the requester from the staff list", () => {
    expect(o.openRecent[0].requester).toBe("Anna Painter");
  });

  it("counts requests in the recent windows", () => {
    expect(o.totals.requests7).toBe(2);
    expect(o.totals.requests30).toBe(3);
    expect(o.totals.requests90).toBe(3);
    expect(o.totals.done30).toBe(1);
  });

  it("only counts units for single-item requests with a plausible quantity", () => {
    const items = Object.fromEntries(o.topItems.map((i) => [i.item, i]));
    expect(items.Gloves.requests).toBe(3);
    expect(items.Gloves.units).toBe(2); // the multi-item request's quantity (5) is not added
    expect(items["Masking tape"].units).toBe(0);

    const typo = summarisePpe([req("big", 1, { quantity: 666 })], staff, NOW);
    expect(typo.topItems[0].units).toBe(0);
  });

  it("breaks each item down by who asked for it", () => {
    const people: StaffRef[] = [
      { userId: 1, name: "Anna Painter", former: false },
      { userId: 2, name: "Ben Fitter", former: false },
    ];
    const r = summarisePpe(
      [
        req("a1", 5, { items: ["Gloves"], quantity: 10 }),
        req("a2", 20, { items: ["Gloves"], quantity: 20, status: null, status_updated_at: null }),
        req("b1", 3, { submitter_user_id: 2, items: ["Gloves", "Tape"], quantity: 99 }),
        req("u1", 1, { submitter_user_id: null, items: ["Tape"], quantity: 4 }),
        req("g1", 7, { submitter_user_id: 77, items: ["Tape"], quantity: 2 }),
        req("old", 120, { items: ["Gloves"] }), // outside the 90-day window
      ],
      people,
      NOW
    );
    const gloves = r.topItems.find((i) => i.item === "Gloves")!;
    expect(gloves.requests).toBe(3);
    expect(gloves.openRequests).toBe(1);
    expect(gloves.orderers.map((p) => p.name)).toEqual(["Anna Painter", "Ben Fitter"]);
    expect(gloves.orderers[0]).toMatchObject({ requests: 2, units: 30, open: 1 });
    expect(gloves.orderers[1]).toMatchObject({ requests: 1, units: 0, open: 0 }); // multi-item request adds no units
    expect(gloves.lastRequestedAt).toBe(ago(3));

    const tape = r.topItems.find((i) => i.item === "Tape")!;
    expect(tape.orderers.map((p) => p.name).sort()).toEqual(["Ben Fitter", "Connecteam user 77", "Unknown"]);
  });

  it("lists who asked for each item in the text for Eleven", () => {
    const text = formatPpeContext(o, ago(0));
    expect(text).toContain("Who asked for each item in the last 90 days");
    expect(text).toMatch(/- Gloves \(1 person\): Anna Painter 3/);
  });

  it("works out the typical time to Done", () => {
    expect(o.medianHoursToDone).toBe(2);
  });

  it("produces text for Eleven that states the rules and lists the open work", () => {
    const text = formatPpeContext(o, ago(0));
    expect(text).toContain("only when a manager has set its status to Done");
    expect(text).toContain("Open requests from the last 30 days (2)");
    expect(text).toContain("Older open requests, probably forgotten (1");
    expect(text).toContain("covers the whole request");
  });
});
