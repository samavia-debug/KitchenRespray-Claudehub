import { describe, expect, it } from "vitest";
import { LETTER_TYPES } from "./config";
import { unresolvedPlaceholders } from "./prompt";
import { STOCK, type StockContext } from "./stock";
import { SAMPLE_CONTEXT, TEMPLATE_TOKENS, buildFromTemplate, cleanTemplateInput, generaliseLetterText, starterTemplates } from "./templates";

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
