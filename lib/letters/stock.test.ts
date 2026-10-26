import { describe, expect, it } from "vitest";
import { LETTER_TYPES, LETTER_TYPE_BY_KEY, type LetterTypeKey } from "./config";
import { factsForModel, factsFromStaff, type LetterFacts } from "./facts";
import { buildUserMessage, unresolvedPlaceholders } from "./prompt";
import { renderLetter, EMPTY_SETTINGS } from "./layout";
import { cleanRecipient } from "./validate";
import { addressText, findAddress } from "./staff-address";
import { buildFromStock, COMMON_PARAGRAPHS, defaultParagraphIds, fillStock, periodText, staffAsRecipient, STOCK, stockFor, type StockContext } from "./stock";

const staff = { jobTitle: "Spray technician", employmentType: "Full Time", department: "Spraying", branch: "Kylemore", team: "Kylemore", startDate: "08/15/2021", email: "tech@example.com", phone: "083 000 0000", former: false };
const facts: LetterFacts = { ...factsFromStaff("Anthonny Murray", staff), values: { ...factsFromStaff("Anthonny Murray", staff).values, address: "12 Main Street, Kylemore, Co. Kildare" } };

const ctx = (over: Partial<StockContext> = {}): StockContext => ({ facts, company: "Kitchen Respray", recipient: {}, details: {}, ...over });
const TYPES = LETTER_TYPES.map((t) => t.key);

describe("filling in a ready-made paragraph", () => {
  it("puts the person's details in, with the right tense for a former employee", () => {
    expect(fillStock("{name} {is} employed by {company} in the role of {jobTitle}.", ctx())).toBe("Anthonny Murray is employed by Kitchen Respray in the role of Spray technician.");
    const former = ctx({ facts: { ...facts, former: true } });
    expect(fillStock("{name} {is} employed. {name} {works} here.", former)).toBe("Anthonny Murray was employed. Anthonny Murray worked here.");
  });

  it("writes the employment type in lower case and the start date in full", () => {
    expect(fillStock("The position {is} {employmentType}. Started {startDate}.", ctx())).toBe("The position is full time. Started 15 August 2021.");
  });

  it("never leaves a gap or guesses: a detail that is missing becomes a [CONFIRM: ...] note", () => {
    const bare = ctx({ facts: { ...facts, values: {} } });
    expect(fillStock("In the role of {jobTitle}.", bare)).toBe("In the role of [CONFIRM: job title].");
    expect(fillStock("Reason: {purpose}.", ctx())).toBe("Reason: [CONFIRM: the details for this letter].");
  });

  it("leaves text that is not one of its words alone", () => {
    expect(fillStock("{unknown} and {name}", ctx())).toBe("{unknown} and Anthonny Murray");
  });

  it("tidies what was typed in: one line, no final full stop to double up", () => {
    const c = ctx({ details: { purpose: "  the Murphy kitchen in Bray,\n spraying the doors.  " } });
    expect(fillStock("Work assigned: {purpose}.", c)).toBe("Work assigned: the Murphy kitchen in Bray, spraying the doors.");
    expect(fillStock("{purposeText}", ctx({ details: { purpose: "Line one.\n\nLine two." } }))).toBe("Line one.\n\nLine two.");
  });

  it("writes dates as a period", () => {
    expect(periodText({ periodFrom: "2026-03-03", periodTo: "2026-03-05" })).toBe("3 March 2026 to 5 March 2026");
    expect(periodText({ periodFrom: "2026-03-03" })).toBe("3 March 2026");
    expect(periodText({})).toBe("");
  });
});

describe("the ready-made paragraphs", () => {
  it("cover every letter type", () => {
    for (const t of TYPES) {
      expect(STOCK[t], t).toBeDefined();
      expect(defaultParagraphIds(t, ctx({ details: { purpose: "x" } })).length, t).toBeGreaterThan(0);
    }
  });

  it("use only words the filler knows, so nothing is ever printed with curly brackets", () => {
    for (const t of TYPES) {
      for (const p of [...STOCK[t].paragraphs, ...COMMON_PARAGRAPHS]) {
        const out = fillStock(`${STOCK[t].subject} ${p.text}`, ctx());
        expect(out, `${t}/${p.id}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("have unique ids within a type", () => {
    for (const t of TYPES) {
      const ids = stockFor(t).map((p) => p.id);
      expect(new Set(ids).size, t).toBe(ids.length);
    }
  });

  it("never say he, she, his or her, since nobody's pronouns are known", () => {
    for (const t of TYPES) for (const p of stockFor(t)) expect(p.text, `${t}/${p.id}`).not.toMatch(/\b(he|she|his|hers?|him|himself|herself)\b/i);
  });

  it("make no claim about pay, conduct or performance on the person's behalf", () => {
    for (const t of TYPES) for (const p of stockFor(t)) expect(p.text, `${t}/${p.id}`).not.toMatch(/\b(excellent|outstanding|hardworking|reliable|dismiss|terminate|salary of|€)/i);
  });
});

describe("writing a whole letter from them", () => {
  it("writes an employment confirmation from the record alone", () => {
    const d = buildFromStock("employment_confirmation", ctx({ recipient: { name: "Ms Byrne" } }));
    expect(d.subject).toBe("Confirmation of employment: Anthonny Murray");
    expect(d.greeting).toBe("Dear Ms Byrne,");
    expect(d.closing).toBe("Yours sincerely,");
    expect(d.body).toContain("This letter confirms that Anthonny Murray is employed by Kitchen Respray in the role of Spray technician.");
    expect(d.body).toContain("Employment began on 15 August 2021.");
    expect(d.body).toContain("The position is full time.");
    expect(d.missing).toEqual([]);
  });

  it("uses 'Dear Sir or Madam' when there is nobody to name", () => {
    const d = buildFromStock("employment_confirmation", ctx());
    expect(d.greeting).toBe("Dear Sir or Madam,");
    expect(d.closing).toBe("Yours faithfully,");
  });

  it("greets the person by name in a letter to them, even if the recipient box was left empty", () => {
    expect(buildFromStock("work_assignment", ctx({ details: { purpose: "the Murphy kitchen" } })).greeting).toBe("Dear Anthonny Murray,");
  });

  it("includes only what is known, and the purpose paragraph only when there is a purpose", () => {
    expect(defaultParagraphIds("employment_confirmation", ctx())).not.toContain("why");
    expect(defaultParagraphIds("employment_confirmation", ctx({ details: { purpose: "a mortgage application" } }))).toContain("why");
    const d = buildFromStock("employment_confirmation", ctx({ details: { purpose: "a mortgage application." } }));
    expect(d.body).toContain("in connection with a mortgage application.");
    const noStart = buildFromStock("employment_confirmation", ctx({ facts: { ...facts, values: { jobTitle: "Spray technician" } } }));
    expect(noStart.body).not.toContain("Employment began");
  });

  it("calls out what is missing rather than inventing it", () => {
    const d = buildFromStock("work_assignment", ctx());
    expect(d.body).toContain("Work assigned: [CONFIRM: the details for this letter].");
    expect(d.missing).toContain("the details for this letter");
    const bare = buildFromStock("employment_confirmation", ctx({ facts: { ...facts, values: {} } }));
    expect(bare.missing).toEqual(expect.arrayContaining(["job title", "Job title is not recorded for this technician", "Start date is not recorded for this technician"]));
  });

  it("leaves the outcome and the contact person of a warning for management to fill in", () => {
    const d = buildFromStock("warning", ctx({ details: { purpose: "late arrival on 3, 4 and 7 October", periodFrom: "2026-10-03" } }));
    expect(d.body).toContain("The matter is as follows: late arrival on 3, 4 and 7 October.");
    expect(d.body).toContain("Date(s): 3 October 2026.");
    expect(unresolvedPlaceholders(d.body)).toEqual(["the outcome, and any next steps", "who to contact"]);
    expect(d.missing).toEqual(["the outcome, and any next steps", "who to contact"]);
  });

  it("adds the technician's phone and email to an introduction only when asked", () => {
    const base = { recipient: { name: "Mr Murphy" }, details: { purpose: "will visit to measure the kitchen" } };
    expect(buildFromStock("technician_introduction", ctx(base)).body).not.toContain("083 000 0000");
    const withContact = buildFromStock("technician_introduction", ctx({ ...base, details: { ...base.details, includeContact: true } }));
    expect(withContact.body).toContain("Anthonny Murray can be reached on 083 000 0000.");
    expect(withContact.body).toContain("Anthonny Murray can also be reached at tech@example.com.");
  });

  it("asks for a subject on the open letter types, which have none of their own", () => {
    const d = buildFromStock("general_business", ctx({ details: { purpose: "your recent enquiry" } }));
    expect(d.subject).toBe("");
    expect(d.missing).toContain("Add a subject line");
    expect(d.body).toContain("I am writing to you about the following: your recent enquiry.");
  });

  it("uses exactly the paragraphs it is given, in the type's own order", () => {
    const d = buildFromStock("employment_confirmation", ctx(), ["scope", "intro"]);
    expect(d.body.split("\n\n")).toEqual([
      "This letter confirms that Anthonny Murray is employed by Kitchen Respray in the role of Spray technician.",
      "This letter confirms employment only. It is not a statement about pay or about future employment.",
    ]);
  });

  it("writes a letter of every type that reads as finished once the details are in", () => {
    const full = ctx({ recipient: { name: "Mr Murphy" }, details: { purpose: "the Murphy kitchen in Bray, spraying the doors", periodFrom: "2026-03-03", reference: "R-1", includeContact: true } });
    for (const t of TYPES as LetterTypeKey[]) {
      const d = buildFromStock(t, full);
      expect(d.body.length, t).toBeGreaterThan(20);
      if (!LETTER_TYPE_BY_KEY[t].sensitive && t !== "general_business" && t !== "custom") expect(unresolvedPlaceholders(d.body), t).toEqual([]);
    }
  });
});

describe("addressing the letter to the person", () => {
  it("puts their name, address and contact details in the address block, one per line", () => {
    expect(staffAsRecipient(facts)).toEqual({ name: "Anthonny Murray", address: "12 Main Street\nKylemore\nCo. Kildare", phone: "083 000 0000", email: "tech@example.com" });
    const l = renderLetter(EMPTY_SETTINGS, { letter_type: "work_assignment", status: "draft", letter_date: "2026-10-26", subject: "", recipient: staffAsRecipient(facts), greeting: "", body: "", closing: "" });
    expect(l.recipientLines).toEqual(["Anthonny Murray", "12 Main Street", "Kylemore", "Co. Kildare", "Tel: 083 000 0000", "Email: tech@example.com"]);
  });

  it("copes with a person who has no address on record", () => {
    const none = { ...facts, values: { ...facts.values, address: undefined } };
    expect(staffAsRecipient(none).address).toBe("");
    expect(renderLetter(EMPTY_SETTINGS, { letter_type: "custom", status: "draft", letter_date: "2026-10-26", subject: "", recipient: staffAsRecipient(none), greeting: "", body: "", closing: "" }).recipientLines).toEqual([
      "Anthonny Murray",
      "Tel: 083 000 0000",
      "Email: tech@example.com",
    ]);
  });

  it("keeps the phone and email on a saved letter, cleaned", () => {
    expect(cleanRecipient({ name: "A", phone: " 083\n000 ", email: "a@b.ie", address: "x" })).toEqual({ name: "A", organisation: "", address: "x", phone: "083 000", email: "a@b.ie" });
  });

  it("keeps the home address, phone and email away from the AI service", () => {
    const sent = factsForModel("work_assignment", facts, true);
    expect(JSON.stringify(sent)).not.toContain("Main Street");
    expect(JSON.stringify(sent)).not.toContain("083 000");
    const message = buildUserMessage(sent, { name: "A", address: "12 Main Street", phone: "083 000 0000", email: "tech@example.com" }, {}, "26 October 2026");
    expect(message).not.toContain("Main Street");
    expect(message).not.toContain("tech@example.com");
  });
});

describe("reading a home address from Connecteam", () => {
  const field = (name: string, value: unknown) => ({ customFieldId: 1, name, type: "str", value });

  it("takes text, a list or an address object and makes one line", () => {
    expect(addressText("12 Main Street\nKylemore\nKildare")).toBe("12 Main Street, Kylemore, Kildare");
    expect(addressText([{ value: "12 Main Street" }, "Kildare"])).toBe("12 Main Street, Kildare");
    expect(addressText({ formattedAddress: "12 Main Street, Kildare" })).toBe("12 Main Street, Kildare");
    expect(addressText({ street: "12 Main Street", city: "Kylemore", county: "Kildare", eircode: "W91 X0X0" })).toBe("12 Main Street, Kylemore, Kildare, W91 X0X0");
    expect(addressText(null)).toBe("");
    expect(addressText({})).toBe("");
  });

  it("finds the home address, preferring one called 'Home address'", () => {
    expect(findAddress([field("Title", "Spray technician"), field("Address", "1 Other Road"), field("Home Address", "12 Main Street")])).toBe("12 Main Street");
    expect(findAddress([field("Address", "1 Other Road")])).toBe("1 Other Road");
  });

  it("does not mistake a work, web or email address for a home address", () => {
    expect(findAddress([field("Email address", "a@b.ie"), field("Work address", "Unit 4"), field("Website address", "x.ie"), field("Branch", "Kylemore")])).toBe("");
    expect(findAddress(undefined)).toBe("");
    expect(findAddress([field("Home address", "")])).toBe("");
  });
});
