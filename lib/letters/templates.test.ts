import { describe, expect, it } from "vitest";
import { LETTER_TYPES } from "./config";
import { unresolvedPlaceholders } from "./prompt";
import { STOCK, type StockContext } from "./stock";
import { CONCERN_LETTERS } from "./concern-letters";
import { parseBlocks } from "./format";
import { SAMPLE_CONTEXT, TEMPLATE_TOKENS, buildFromTemplate, cleanTemplateInput, fillFields, generaliseLetterText, starterTemplates, templateFields } from "./templates";
import { nextStatus } from "./validate";

const valid = { name: "Mortgage letter", category: "hr", letter_type: "employment_confirmation", subject: "Employment: {name}", greeting: "", body: "{name} {is} employed as {jobTitle}.", closing: "" };

describe("cleanTemplateInput", () => {
  it("accepts a complete template and tidies it", () => {
    const r = cleanTemplateInput({ ...valid, name: "  Mortgage   letter  ", body: "Line one\r\n\r\nLine two" });
    expect(r).toEqual({ value: { ...valid, name: "Mortgage letter", body: "Line one\n\nLine two" } });
  });

  it("asks for a name, a known category, a known kind of letter and some text", () => {
    expect(cleanTemplateInput(null)).toEqual({ error: "Nothing was sent" });
    expect(cleanTemplateInput({ ...valid, name: "  " })).toEqual({ error: "Give the template a name" });
    expect(cleanTemplateInput({ ...valid, category: "other" })).toEqual({ error: "Choose a category" });
    expect(cleanTemplateInput({ ...valid, letter_type: "nope" })).toEqual({ error: "Choose the kind of letter this template is for" });
    expect(cleanTemplateInput({ ...valid, body: "" })).toEqual({ error: "The template has no text yet" });
  });

  it("keeps lengths within what a letter allows", () => {
    const r = cleanTemplateInput({ ...valid, subject: "s".repeat(500), body: "b".repeat(20000) });
    if (!("value" in r)) throw new Error("expected a value");
    expect(r.value.subject.length).toBe(160);
    expect(r.value.body.length).toBe(8000);
  });
});

describe("buildFromTemplate", () => {
  it("fills in the staff details, the company and the recipient", () => {
    const d = buildFromTemplate({ ...valid, letter_type: "employment_confirmation", greeting: "Dear {recipientName},", closing: "Kind regards," } as never, SAMPLE_CONTEXT);
    expect(d.subject).toBe("Employment: Pat Example");
    expect(d.greeting).toBe("Dear Mr Murphy,");
    expect(d.body).toBe("Pat Example is employed as Spray Technician.");
    expect(d.closing).toBe("Kind regards,");
    expect(d.missing).toEqual([]);
  });

  it("uses was and worked for former staff", () => {
    const ctx: StockContext = { ...SAMPLE_CONTEXT, facts: { ...SAMPLE_CONTEXT.facts, former: true } };
    expect(buildFromTemplate({ ...valid, body: "{name} {works} for {company}." } as never, ctx).body).toBe("Pat Example worked for Kitchen Respray.");
  });

  it("marks what it does not know instead of guessing, so the letter cannot be finalised with it", () => {
    const ctx: StockContext = { ...SAMPLE_CONTEXT, details: {}, recipient: {} };
    const d = buildFromTemplate({ ...valid, body: "Dates: {period}. Re: {purpose}." } as never, ctx);
    expect(d.body).toContain("[CONFIRM: the dates]");
    expect(d.body).toContain("[CONFIRM: the details for this letter]");
    expect(d.missing).toEqual(["the dates", "the details for this letter"]);
  });

  it("leaves a {word} it does not know exactly as typed", () => {
    expect(buildFromTemplate({ ...valid, body: "Hello {mystery}." } as never, SAMPLE_CONTEXT).body).toBe("Hello {mystery}.");
  });

  it("greets by the usual default when the template leaves the greeting and closing empty", () => {
    const named = buildFromTemplate(valid as never, SAMPLE_CONTEXT);
    expect(named.greeting).toBe("Dear Mr Murphy,");
    expect(named.closing).toBe("Yours sincerely,");
    const anon = buildFromTemplate({ ...valid, letter_type: "general_business" } as never, { ...SAMPLE_CONTEXT, recipient: {} });
    expect(anon.greeting).toBe("Dear Sir or Madam,");
    expect(anon.closing).toBe("Yours faithfully,");
  });

  it("asks for a subject when the template has none", () => {
    expect(buildFromTemplate({ ...valid, subject: "" } as never, SAMPLE_CONTEXT).missing).toContain("Add a subject line");
  });
});

describe("the details a template can use", () => {
  it("each one fills in with its example, none is left as a {word}", () => {
    for (const t of TEMPLATE_TOKENS) {
      const d = buildFromTemplate({ ...valid, subject: "x", body: `{${t.token}}` } as never, SAMPLE_CONTEXT);
      expect(d.body, t.token).not.toMatch(/\{\w+\}/);
      expect(d.body, t.token).not.toContain("[CONFIRM");
      expect(d.body, t.token).toBe(t.example);
    }
  });
});

describe("the starter templates", () => {
  const starters = starterTemplates();

  it("has one per kind of letter, each valid", () => {
    expect(starters).toHaveLength(LETTER_TYPES.length);
    for (const s of starters) expect("value" in cleanTemplateInput(s), s.name).toBe(true);
    expect(new Set(starters.map((s) => s.name)).size).toBe(starters.length);
  });

  it("keeps the {details} in, and nothing a letter would have to guess", () => {
    const confirmation = starters.find((s) => s.letter_type === "employment_confirmation")!;
    expect(confirmation.body).toContain("{name}");
    expect(confirmation.body).toContain("{jobTitle}");
    expect(confirmation.body).not.toContain("{purpose}");
  });

  it("fill in to the same sentences the ready-made paragraphs give", () => {
    const confirmation = starters.find((s) => s.letter_type === "employment_confirmation")!;
    const d = buildFromTemplate(confirmation, SAMPLE_CONTEXT);
    expect(d.body).toContain("This letter confirms that Pat Example is employed by Kitchen Respray in the role of Spray Technician.");
    expect(unresolvedPlaceholders(d.body)).toEqual([]);
  });

  it("carry the existing [CONFIRM] notes for a warning letter, so it still needs a person's decision", () => {
    const warning = starters.find((s) => s.letter_type === "warning")!;
    expect(unresolvedPlaceholders(buildFromTemplate(warning, SAMPLE_CONTEXT).body).length).toBeGreaterThan(0);
    expect(STOCK.warning.paragraphs.some((p) => p.text.includes("[CONFIRM"))).toBe(true);
  });
});

describe("generaliseLetterText", () => {
  it("puts the person's name and the company back as {name} and {company}", () => {
    expect(generaliseLetterText("Pat Example works for Kitchen Respray. Pat Example is a technician.", { name: "Pat Example" }, "Kitchen Respray")).toBe("{name} works for {company}. {name} is a technician.");
  });

  it("leaves text alone when there is nothing to swap, and never swaps a very short name", () => {
    expect(generaliseLetterText("Hello.", { name: "Pat Example" }, "Kitchen Respray")).toBe("Hello.");
    expect(generaliseLetterText("Al is here", { name: "Al" }, "")).toBe("Al is here");
  });
});

describe("fill-in boxes", () => {
  const tpl = {
    letter_type: "warning" as const,
    subject: "Concern: [[Topic]]",
    greeting: "Dear {name},",
    body: "Further to our conversation on [[Date of the conversation]] I am writing.\n\nYou said:\n\n[[The reason the employee gave]]\n\nAgain: [[ Date of the   conversation ]].",
    closing: "Yours sincerely,",
  };

  it("lists each box once, in order, and says what kind it is", () => {
    expect(templateFields(tpl)).toEqual([
      { label: "Topic", kind: "text" },
      { label: "Date of the conversation", kind: "date" },
      { label: "The reason the employee gave", kind: "long" },
    ]);
    expect(templateFields({ subject: "", greeting: "", body: "No boxes here, only {name}.", closing: "" })).toEqual([]);
  });

  it("puts what was typed into every place a box appears, writing a date out", () => {
    const d = buildFromTemplate(tpl, SAMPLE_CONTEXT, { Topic: "lateness", "Date of the conversation": "2026-10-28", "The reason the employee gave": "Traffic on the M50." });
    expect(d.subject).toBe("Concern: lateness");
    expect(d.greeting).toBe("Dear Pat Example,");
    expect(d.body).toBe("Further to our conversation on 28 October 2026 I am writing.\n\nYou said:\n\nTraffic on the M50.\n\nAgain: 28 October 2026.");
    expect(d.missing).toEqual([]);
  });

  it("marks a box left empty, so the letter cannot be finalised until it is filled in", () => {
    const d = buildFromTemplate(tpl, SAMPLE_CONTEXT, { Topic: "lateness", "Date of the conversation": "   " });
    expect(d.body).toContain("[CONFIRM: Date of the conversation]");
    expect(d.body).toContain("[CONFIRM: The reason the employee gave]");
    expect(d.missing).toEqual(["Date of the conversation", "The reason the employee gave"]);
    expect(nextStatus("draft", "finalise", { subject: d.subject, body: d.body, letter_type: "warning" }).ok).toBe(false);
  });

  it("does not let typed text open a new box or break the wording", () => {
    expect(fillFields("A [[Reason]] B", { Reason: "x [[Evil]] y" })).toBe("A x Evil y B");
  });

  it("a date that is not in the date format is left as typed", () => {
    expect(fillFields("On [[Date]].", { Date: "last Tuesday" })).toBe("On last Tuesday.");
  });
});

describe("the lawyers' letters of concern", () => {
  it("are five valid warning templates, each with its own name", () => {
    expect(CONCERN_LETTERS.map((t) => t.name)).toEqual([
      "Letter of concern: Lateness",
      "Letter of concern: Unfinished jobs",
      "Letter of concern: Dangerous driving",
      "Letter of concern: Face mask",
      "Letter of concern: Before and after pictures",
    ]);
    for (const t of CONCERN_LETTERS) {
      expect("value" in cleanTemplateInput(t), t.name).toBe(true);
      expect(t.letter_type).toBe("warning");
      expect(t.category).toBe("hr");
    }
  });

  it("keep the lawyers' sentences word for word, including their punctuation", () => {
    const all = CONCERN_LETTERS.map((t) => t.body);
    const warning = "On this particular occasion, we have decided not to proceed with formal disciplinary action. As a consequence, therefore you are now being issued with an informal warning.";
    expect(all.filter((b) => b.includes(warning))).toHaveLength(4);
    // The driving letter is punctuated differently, and is kept as it is.
    expect(all[2]).toContain("As a consequence therefore you are now being issued with an informal warning.");
    expect(all[2]).toContain("regarding the content of this letter please do not hesitate to contact me.");
    for (const b of all) {
      expect(b).toContain("Please understand from this letter that you are now in receipt of what we consider to be a reasonable written management instruction not to repeat these actions in the future.");
      expect(b).toContain("Although this is not a formal warning, should there be any repeat of this conduct, or indeed any misconduct in general you may be subject to formal disciplinary action. Please find enclosed a copy of the company's disciplinary rules and procedures in this regard.");
    }
    expect(all[0]).toContain("Having listened to your explanation I consider it to be unsatisfactory because all employees are expected to start their shifts on their allocated time. This is to ensure operational efficiency and our customer's needs are met.");
    expect(all[3]).toContain("you failed to wear a face mask while carrying out spray painting as outlined in our employee handbook and as you are in close contact with dangerous chemicals.");
    expect(all[4]).toContain("you failed to send before and after pictures as requested to do so by management.");
  });

  it("hold no one's name or address: the person comes from the record and the signer from Signed off by", () => {
    for (const t of CONCERN_LETTERS) {
      const everything = [t.name, t.subject, t.greeting, t.body, t.closing].join("\n");
      expect(everything, t.name).not.toMatch(/Mckinney|Maria|Philip|Erica|Carroll|Soluos|Solous|Souls|Tower|Unit 5|Bray|Clapinski|Flinn/i);
      expect(t.greeting).toBe("Dear {name},");
      expect(t.closing).toBe("Yours sincerely,");
    }
  });

  it("ask only for what changes: the date of the conversation, and for two of them the employee's reason", () => {
    expect(templateFields(CONCERN_LETTERS[0]).map((f) => f.label)).toEqual(["Date of the conversation", "The reason the employee gave"]);
    expect(templateFields(CONCERN_LETTERS[1]).map((f) => f.label)).toEqual(["Date of the conversation", "The reason the employee gave"]);
    expect(templateFields(CONCERN_LETTERS[2])).toEqual([]);
    for (const i of [3, 4]) expect(templateFields(CONCERN_LETTERS[i]).map((f) => f.label)).toEqual(["Date of the conversation"]);
  });

  it("write into a finished letter for the chosen employee, with the matter as a list", () => {
    const d = buildFromTemplate(CONCERN_LETTERS[1], SAMPLE_CONTEXT, { "Date of the conversation": "2026-10-28", "The reason the employee gave": "No reason given." });
    expect(d.greeting).toBe("Dear Pat Example,");
    expect(d.body).toContain("Further to our conversation on 28 October 2026 I am writing to inform you of my decision.");
    expect(d.body).toContain("- Leaving duties you are expected to carry out");
    expect(d.body).toContain("At the time, the reason you gave for your behavior was:\n\nNo reason given.");
    expect(d.missing).toEqual([]);
    const blocks = parseBlocks(d.body);
    expect(blocks.some((b) => b.kind === "list" && b.items.length === 2)).toBe(true);
  });

  it("are added with the ready-made wording, none repeating another's name", () => {
    const names = [...starterTemplates(), ...CONCERN_LETTERS].map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
