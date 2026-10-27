import { describe, expect, it } from "vitest";
import { refreshLetter, type Letter } from "./refresh";
import { buildFromStock, type StockContext } from "./stock";

const base: StockContext = {
  facts: { name: "Pat Example", former: false, values: { jobTitle: "Spray Technician", employmentType: "Full time" }, sources: {} },
  company: "Kitchen Respray",
  recipient: { name: "Mr Murphy" },
  details: { purpose: "a mortgage application" },
};

const withFacts = (values: Record<string, string>, over: Partial<StockContext> = {}): StockContext => ({
  ...base,
  ...over,
  facts: { ...base.facts, values: { ...base.facts.values, ...values } },
});

const written = (ctx: StockContext): Letter => {
  const d = buildFromStock("employment_confirmation", ctx);
  return { subject: d.subject, greeting: d.greeting, body: d.body, closing: d.closing };
};

describe("updating a letter when a detail changes", () => {
  it("fills a [CONFIRM] note once the detail is known, and leaves the rest of the letter alone", () => {
    const was = withFacts({ jobTitle: "" }); // no job title on record yet
    const letter = written(was);
    expect(letter.body).toContain("[CONFIRM: job title]");
    const edited = { ...letter, body: letter.body.replace("This letter confirms", "I am glad to confirm") };

    const { letter: out, changes } = refreshLetter(edited, was, base);
    expect(out.body).not.toContain("[CONFIRM: job title]");
    expect(out.body).toContain("in the role of Spray Technician.");
    expect(out.body).toContain("I am glad to confirm");
    expect(changes).toEqual([{ label: "job title", from: "(not known)", to: "Spray Technician" }]);
  });

  it("swaps a value that was filled in, in the subject and the text, only as a whole word", () => {
    const was = withFacts({ jobTitle: "Spray" });
    const letter = { subject: "Re: Spray", greeting: "Dear Sir,", body: "Role: Spray. Sprayed it. Spray-painted.", closing: "Yours," };
    const { letter: out } = refreshLetter(letter, was, withFacts({ jobTitle: "Lead Sprayer" }));
    expect(out.subject).toBe("Re: Lead Sprayer");
    // "Sprayed" has Spray inside a longer word and is left; "Spray-painted" is a different phrase boundary so it is swapped.
    expect(out.body).toBe("Role: Lead Sprayer. Sprayed it. Lead Sprayer-painted.");
  });

  it("changes the name everywhere it appears, once", () => {
    const letter = written(base);
    const { letter: out, changes } = refreshLetter(letter, base, { ...base, facts: { ...base.facts, name: "Patricia Example" } });
    expect(out.body).toContain("Patricia Example is employed");
    expect(out.subject).toBe("Confirmation of employment: Patricia Example");
    expect(out.body).not.toContain("Pat Example");
    expect(changes.map((c) => c.label)).toEqual(["name"]);
  });

  it("changes the greeting when the recipient's name changes", () => {
    const letter = written(base);
    const { letter: out } = refreshLetter(letter, base, { ...base, recipient: { name: "Ms Byrne" } });
    expect(out.greeting).toBe("Dear Ms Byrne,");
  });

  it("turns Dear Sir or Madam into a named greeting once a recipient is given", () => {
    const was = { ...base, recipient: {} };
    const letter = written(was);
    expect(letter.greeting).toBe("Dear Sir or Madam,");
    const { letter: out } = refreshLetter(letter, was, base);
    expect(out.greeting).toBe("Dear Mr Murphy,");
    expect(out.closing).toBe("Yours sincerely,");
  });

  it("does nothing when nothing has changed, or when the old value is not in the text any more", () => {
    const letter = written(base);
    expect(refreshLetter(letter, base, base)).toEqual({ letter, changes: [] });
    const rewritten = { ...letter, body: "Completely rewritten." };
    expect(refreshLetter(rewritten, base, withFacts({ jobTitle: "Foreman" })).changes).toEqual([]);
  });

  it("never removes words: a value taken away is left where it is", () => {
    const letter = written(base);
    const { letter: out, changes } = refreshLetter(letter, base, withFacts({ jobTitle: "" }));
    expect(out).toEqual(letter);
    expect(changes).toEqual([]);
  });

  it("leaves a very short old value alone rather than risk changing other words", () => {
    const was = withFacts({ branch: "AB" });
    const letter = { subject: "x", greeting: "g", body: "Branch AB and ABBA.", closing: "c" };
    expect(refreshLetter(letter, was, withFacts({ branch: "Bray" })).letter.body).toBe("Branch AB and ABBA.");
  });

  it("changing from current to former staff is not rewritten, since is/was are too short to find safely", () => {
    const letter = written(base);
    const { changes } = refreshLetter(letter, base, { ...base, facts: { ...base.facts, former: true } });
    expect(changes).toEqual([]);
  });
});
