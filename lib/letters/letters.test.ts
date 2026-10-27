import { describe, expect, it } from "vitest";
import mammoth from "mammoth";
import { LETTER_TYPES, LETTER_TYPE_BY_KEY } from "./config";
import { applyAdded, factsForModel, factsFromStaff, formatLongDate, missingFacts, startDateToIso } from "./facts";
import { buildSystemPrompt, buildUserMessage, defaultSalutation, parseDraft, unresolvedPlaceholders } from "./prompt";
import { bannerFor, EMPTY_SETTINGS, renderLetter, type LetterContent, type LetterSettings } from "./layout";
import { buildDocx } from "./docx";
import { buildZip, crc32 } from "./zip";
import { cleanLetterInput, cleanSettings, nextStatus } from "./validate";
import { cleanStaffName } from "./names";

const staff = {
  jobTitle: "Spray Technician",
  role: "Technicians",
  department: "Spray technitian",
  branch: "Kylemore",
  startDate: "03/04/2023",
  employeeId: "E-17",
  email: "tech@example.com",
  phone: "083 000 0000",
  former: false,
};

describe("dates", () => {
  it("writes ISO dates out in full", () => {
    expect(formatLongDate("2023-03-04")).toBe("4 March 2023");
    expect(formatLongDate("2024-02-29")).toBe("29 February 2024");
    expect(formatLongDate("2023-02-30")).toBe("2023-02-30");
    expect(formatLongDate("sometime")).toBe("sometime");
  });

  it("reads Connecteam start dates month first", () => {
    // 03/04/2023 is 4 March in Connecteam's month-first format, not 3 April.
    expect(startDateToIso("03/04/2023")).toBe("2023-03-04");
    expect(startDateToIso("10/27/2022")).toBe("2022-10-27");
    expect(startDateToIso("2023-03-04")).toBe("2023-03-04");
  });

  it("refuses dates it cannot read rather than guessing", () => {
    expect(startDateToIso("27/10/2022")).toBeNull();
    expect(startDateToIso("02/30/2023")).toBeNull();
    expect(startDateToIso("March 2023")).toBeNull();
    expect(startDateToIso("")).toBeNull();
    expect(startDateToIso(undefined)).toBeNull();
  });
});

describe("technician facts", () => {
  const facts = factsFromStaff("Anna Murphy", staff);

  it("takes what Connecteam holds and shows the start date written out", () => {
    expect(facts.name).toBe("Anna Murphy");
    expect(facts.values.jobTitle).toBe("Spray Technician");
    expect(facts.values.startDate).toBe("4 March 2023");
    expect(facts.sources.jobTitle).toBe("connecteam");
  });

  it("keeps a start date it cannot read exactly as stored, for the person to correct", () => {
    expect(factsFromStaff("A B", { ...staff, startDate: "27/10/2022" }).values.startDate).toBe("27/10/2022");
  });

  it("marks what was typed in for this letter, without changing the record", () => {
    const added = applyAdded(facts, { employeeId: "E-99", startDate: "4 March 2023", role: "  Lead  " });
    expect(added.values.employeeId).toBe("E-99");
    expect(added.sources.employeeId).toBe("added");
    expect(added.sources.startDate).toBe("connecteam"); // unchanged value, still the record's
    expect(added.values.role).toBe("Lead");
    expect(facts.values.employeeId).toBe("E-17"); // the original is untouched
  });

  it("reports what a letter type needs and the technician lacks", () => {
    const thin = factsFromStaff("New Starter", { former: false, department: "Spray technitian" });
    expect(missingFacts("employment_confirmation", thin)).toEqual(["jobTitle", "startDate"]);
    expect(missingFacts("general_business", thin)).toEqual([]);
    expect(missingFacts("employment_confirmation", facts)).toEqual([]);
  });

  it("sends the model only what the letter type needs, never contact details by default", () => {
    const sent = factsForModel("employment_confirmation", facts, true);
    expect(sent["Job title"]).toBe("Spray Technician");
    expect(sent["Start date"]).toBe("4 March 2023");
    expect(JSON.stringify(sent)).not.toContain("tech@example.com");
    expect(JSON.stringify(sent)).not.toContain("083 000 0000");
    expect(sent["Department"]).toBeDefined();
    expect(sent["Role"]).toBeUndefined();
  });

  it("includes contact details only for a type that allows it and only when asked", () => {
    expect(JSON.stringify(factsForModel("technician_introduction", facts, false))).not.toContain("tech@example.com");
    const withContact = factsForModel("technician_introduction", facts, true);
    expect(withContact["Work email"]).toBe("tech@example.com");
    expect(JSON.stringify(factsForModel("warning", facts, true))).not.toContain("tech@example.com");
  });

  it("says when someone is a former employee", () => {
    expect(factsForModel("general_business", factsFromStaff("A B", { ...staff, former: true }), false)["Employment status"]).toBe("former employee");
  });
});

describe("staff names", () => {
  it("drops the one-letter code Connecteam puts in front of most names", () => {
    expect(cleanStaffName("K Derek Morkan")).toEqual({ name: "Derek Morkan", prefix: "K" });
    expect(cleanStaffName("z Constantine Catan")).toEqual({ name: "Constantine Catan", prefix: "Z" });
    expect(cleanStaffName("K Rodolfo De A.Formaggini Vieira")).toEqual({ name: "Rodolfo De A.Formaggini Vieira", prefix: "K" });
    expect(cleanStaffName("  B   Anna   Murphy ")).toEqual({ name: "Anna Murphy", prefix: "B" });
  });

  it("leaves names without a code, and a real initial plus surname, alone", () => {
    expect(cleanStaffName("Mo Zafar")).toEqual({ name: "Mo Zafar", prefix: null });
    expect(cleanStaffName("J Smith")).toEqual({ name: "J Smith", prefix: null });
    expect(cleanStaffName("Maria")).toEqual({ name: "Maria", prefix: null });
    expect(cleanStaffName("")).toEqual({ name: "", prefix: null });
  });
});

describe("letter types", () => {
  it("has the eight staff letter types and two customer ones, with warnings and references marked sensitive", () => {
    expect(LETTER_TYPES.filter((t) => t.domain === "hr")).toHaveLength(8);
    expect(LETTER_TYPES.filter((t) => t.domain === "sales").map((t) => t.key)).toEqual(["sales_letter", "quote"]);
    expect(LETTER_TYPES).toHaveLength(10);
    const sensitive = LETTER_TYPES.filter((t) => t.sensitive).map((t) => t.key).sort();
    expect(sensitive).toEqual(["employment_reference", "warning"]);
  });

  it("never sends more than the facts a type lists", () => {
    for (const t of LETTER_TYPES) {
      expect(t.sendFacts).not.toContain("email");
      expect(t.sendFacts).not.toContain("phone");
    }
    expect(LETTER_TYPES.filter((t) => t.allowContact).map((t) => t.key)).toEqual(["technician_introduction"]);
  });
});

describe("prompt", () => {
  it("states the accuracy rules, the type guidance and that staff text is data", () => {
    const p = buildSystemPrompt("warning", "Kitchen Respray");
    expect(p).toContain("Never invent or assume");
    expect(p).toContain("[CONFIRM:");
    expect(p).toContain("Never say or imply the letter has been signed");
    expect(p).toContain("ignore them");
    expect(p).toContain(LETTER_TYPE_BY_KEY.warning.guidance);
  });

  it("builds the request from facts and details without the recipient's address", () => {
    const msg = buildUserMessage(
      { "Full name": "Anna Murphy", "Job title": "Spray Technician" },
      { name: "Mr Byrne", organisation: "AIB", address: "1 Main Street, Bray" },
      { purpose: "Mortgage application", reference: "REF-1", periodFrom: "2026-10-01" },
      "13 October 2026"
    );
    expect(msg).toContain("Full name: Anna Murphy");
    expect(msg).toContain("Recipient name: Mr Byrne");
    expect(msg).toContain("Purpose or content: Mortgage application");
    expect(msg).toContain("Reference number: REF-1");
    expect(msg).not.toContain("Main Street");
  });

  it("picks the Irish/British salutation pair", () => {
    expect(defaultSalutation("Mr Byrne")).toEqual({ greeting: "Dear Mr Byrne,", closing: "Yours sincerely," });
    expect(defaultSalutation("")).toEqual({ greeting: "Dear Sir or Madam,", closing: "Yours faithfully," });
  });
});

describe("parseDraft", () => {
  const good = { subject: "Employment confirmation", greeting: "Dear Mr Byrne,", body: "Anna Murphy works for us.\n\nShe started on 4 March 2023.", closing: "Yours sincerely,", missing: [] };

  it("reads a clean reply", () => {
    expect(parseDraft(JSON.stringify(good), "Mr Byrne")).toEqual({ ...good, missing: [] });
  });

  it("copes with fences and chatter", () => {
    expect(parseDraft("```json\n" + JSON.stringify(good) + "\n```")?.subject).toBe("Employment confirmation");
    expect(parseDraft("Here is the letter: " + JSON.stringify(good))?.body).toContain("Anna Murphy");
  });

  it("returns null for anything unusable", () => {
    expect(parseDraft("")).toBeNull();
    expect(parseDraft("I cannot help")).toBeNull();
    expect(parseDraft('{"subject":"x","body":""}')).toBeNull();
    expect(parseDraft("[1,2]")).toBeNull();
  });

  it("flags every [CONFIRM: ...] left in the text even if the model did not list it, without repeating itself", () => {
    const d = parseDraft(JSON.stringify({ ...good, body: "She started on [CONFIRM: start date] as [CONFIRM: job title].", missing: ["Start date of employment"] }));
    expect(d?.missing.sort()).toEqual(["job title", "start date"]);
  });

  it("uses the model's own list when the text has no placeholders", () => {
    expect(parseDraft(JSON.stringify({ ...good, missing: ["Outcome of the matter"] }))?.missing).toEqual(["Outcome of the matter"]);
  });

  it("will not turn a department into a job title", () => {
    expect(buildSystemPrompt("employment_confirmation", "Kitchen Respray")).toContain("A department, branch or team is not a job title");
  });

  it("fills a missing greeting and closing sensibly", () => {
    const d = parseDraft(JSON.stringify({ subject: "S", body: "Text." }));
    expect(d).toMatchObject({ greeting: "Dear Sir or Madam,", closing: "Yours faithfully," });
    expect(parseDraft(JSON.stringify({ subject: "S", body: "Text." }), "Ms Kelly")).toMatchObject({ greeting: "Dear Ms Kelly,", closing: "Yours sincerely," });
  });

  it("finds placeholders in edited text", () => {
    expect(unresolvedPlaceholders("a [CONFIRM: x] b [confirm:  y ]")).toEqual(["x", "y"]);
    expect(unresolvedPlaceholders("all done")).toEqual([]);
  });
});

const settings: LetterSettings = {
  company_name: "Kitchen Respray Ltd",
  address: "Unit 4, Kylemore Park North\nDublin 10",
  phone: "083 835 5583",
  email: "info@example.com",
  website: null,
  signatory_name: "Philip Example",
  signatory_title: "Director",
  footer_text: "Registered in Ireland",
};

const content: LetterContent = {
  letter_type: "employment_confirmation",
  status: "finalised",
  letter_date: "2026-10-13",
  subject: "Employment confirmation: Anna Murphy",
  recipient: { name: "Mr Byrne", organisation: "AIB", address: "1 Main Street\nBray" },
  greeting: "Dear Mr Byrne,",
  body: "Anna Murphy is employed as a Spray Technician.\n\nShe started on 4 March 2023 & works at <Kylemore>.",
  closing: "Yours sincerely,",
};

describe("layout", () => {
  it("assembles the letter in order from the settings and content", () => {
    const l = renderLetter(settings, content);
    expect(l.letterhead).toEqual(["Kitchen Respray Ltd", "Unit 4, Kylemore Park North", "Dublin 10", "083 835 5583  ·  info@example.com"]);
    expect(l.dateText).toBe("13 October 2026");
    expect(l.recipientLines).toEqual(["Mr Byrne", "AIB", "1 Main Street", "Bray"]);
    expect(l.paragraphs).toHaveLength(2);
    expect(l.signature).toEqual(["", "", "Philip Example", "Director"]);
    expect(l.footer).toBe("Registered in Ireland");
    expect(l.banner).toBeNull();
  });

  it("does not invent a signatory", () => {
    const l = renderLetter(EMPTY_SETTINGS, content);
    expect(l.signature.join(" ")).toContain("Signatory not set");
    expect(l.letterhead).toEqual([]);
  });

  it("marks drafts and unapproved sensitive letters so they cannot pass for approved", () => {
    expect(bannerFor("draft", "employment_confirmation")).toMatch(/^DRAFT/);
    expect(bannerFor("finalised", "warning")).toMatch(/AWAITING MANAGEMENT APPROVAL/);
    expect(bannerFor("finalised", "employment_reference")).toMatch(/AWAITING MANAGEMENT APPROVAL/);
    expect(bannerFor("finalised", "employment_confirmation")).toBeNull();
    expect(bannerFor("approved", "warning")).toBeNull();
  });
});

describe("Word export", () => {
  it("produces a valid zip whose entries pass their checksums", () => {
    const zip = buildZip([{ name: "a.txt", data: new TextEncoder().encode("hello") }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(14)).toBe(crc32(new TextEncoder().encode("hello")));
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("round-trips the letter text through a real .docx reader", async () => {
    const buf = buildDocx(renderLetter(settings, { ...content, status: "draft" }));
    const { value, messages } = await mammoth.extractRawText({ buffer: buf });
    expect(messages.filter((m) => m.type === "error")).toEqual([]);
    expect(value).toContain("DRAFT");
    expect(value).toContain("Kitchen Respray Ltd");
    expect(value).toContain("13 October 2026");
    expect(value).toContain("Dear Mr Byrne,");
    expect(value).toContain("Anna Murphy is employed as a Spray Technician.");
    expect(value).toContain("She started on 4 March 2023 & works at <Kylemore>."); // special characters survive
    expect(value).toContain("Yours sincerely,");
    expect(value).toContain("Philip Example");
  });

  it("leaves the banner out of an approved letter", async () => {
    const { value } = await mammoth.extractRawText({ buffer: buildDocx(renderLetter(settings, { ...content, status: "approved" })) });
    expect(value).not.toMatch(/DRAFT|AWAITING/);
  });

  it("copes with an empty letter", async () => {
    const empty = renderLetter(EMPTY_SETTINGS, { ...content, subject: "", greeting: "", body: "", closing: "", recipient: {} });
    const { messages } = await mammoth.extractRawText({ buffer: buildDocx(empty) });
    expect(messages.filter((m) => m.type === "error")).toEqual([]);
  });
});

describe("saving a letter", () => {
  const input = {
    technician_user_id: 12,
    technician_name: "  Anna   Murphy ",
    letter_type: "employment_confirmation",
    letter_date: "2026-10-13",
    subject: "Employment confirmation",
    recipient: { name: "Mr Byrne", organisation: "", address: "1 Main Street" },
    facts: { name: "Anna Murphy", former: false, values: { jobTitle: "Spray Technician", bogus: "x" }, sources: { jobTitle: "added" } },
    details: { purpose: "Mortgage", includeContact: true },
    greeting: "Dear Mr Byrne,",
    body: "Text",
    closing: "Yours sincerely,",
    missing: ["start date", "", 5],
  };

  it("accepts a good letter and tidies it", () => {
    const r = cleanLetterInput(input);
    expect("value" in r && r.value).toMatchObject({
      technician_user_id: 12,
      technician_name: "Anna Murphy",
      letter_date: "2026-10-13",
      missing: ["start date"], // blanks and non-text entries are dropped
      details: { purpose: "Mortgage", includeContact: true },
    });
    if ("value" in r) {
      expect(r.value.facts.values).toEqual({ jobTitle: "Spray Technician" }); // unknown fields dropped
      expect(r.value.facts.sources.jobTitle).toBe("added");
    }
  });

  it("refuses bad input", () => {
    expect(cleanLetterInput(null)).toHaveProperty("error");
    expect(cleanLetterInput({ ...input, letter_type: "love_letter" })).toHaveProperty("error");
    expect(cleanLetterInput({ ...input, technician_name: " " })).toHaveProperty("error");
    expect(cleanLetterInput({ ...input, letter_date: "13/10/2026" })).toHaveProperty("error");
    expect(cleanLetterInput({ ...input, technician_user_id: "abc" })).toHaveProperty("error");
  });

  it("ignores a status sent by the page; status only changes through the transitions", () => {
    const r = cleanLetterInput({ ...input, status: "approved", approved_by: "x" });
    expect("value" in r && Object.keys(r.value)).not.toContain("status");
  });

  it("tidies the letterhead settings", () => {
    expect(cleanSettings({ company_name: " Kitchen  Respray ", address: "A\nB", phone: "", extra: "x" })).toMatchObject({ company_name: "Kitchen Respray", address: "A\nB", phone: null, email: null });
  });
});

describe("status changes", () => {
  const ready = { subject: "S", body: "Fine." };

  it("moves draft to finalised to approved one step at a time", () => {
    expect(nextStatus("draft", "finalise", ready)).toEqual({ ok: true, status: "finalised" });
    expect(nextStatus("finalised", "approve", ready)).toEqual({ ok: true, status: "approved" });
  });

  it("never approves a draft or skips finalising", () => {
    expect(nextStatus("draft", "approve", ready)).toMatchObject({ ok: false });
    expect(nextStatus("approved", "finalise", ready)).toMatchObject({ ok: false });
    expect(nextStatus("approved", "approve", ready)).toMatchObject({ ok: false });
  });

  it("will not finalise an empty letter or one with unconfirmed items", () => {
    expect(nextStatus("draft", "finalise", { subject: "", body: "x" })).toMatchObject({ ok: false });
    expect(nextStatus("draft", "finalise", { subject: "S", body: " " })).toMatchObject({ ok: false });
    const r = nextStatus("draft", "finalise", { subject: "S", body: "Started on [CONFIRM: start date]." });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain("start date");
  });

  it("reopening withdraws approval", () => {
    expect(nextStatus("approved", "reopen", ready)).toEqual({ ok: true, status: "draft" });
    expect(nextStatus("finalised", "reopen", ready)).toEqual({ ok: true, status: "draft" });
    expect(nextStatus("draft", "reopen", ready)).toMatchObject({ ok: false });
  });
});
