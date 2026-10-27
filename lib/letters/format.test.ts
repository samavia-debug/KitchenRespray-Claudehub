import { describe, expect, it } from "vitest";
import { applyFormat, parseBlocks, parseInline, plainText } from "./format";

describe("inline formatting", () => {
  it("reads **bold** and *italic* and leaves the rest as text", () => {
    expect(parseInline("A **very** good *fit* indeed")).toEqual([
      { text: "A " },
      { text: "very", bold: true },
      { text: " good " },
      { text: "fit", italic: true },
      { text: " indeed" },
    ]);
  });

  it("leaves a stray or spaced asterisk alone", () => {
    expect(parseInline("5 * 3 = 15")).toEqual([{ text: "5 * 3 = 15" }]);
    expect(parseInline("a * b * c")).toEqual([{ text: "a * b * c" }]);
    expect(parseInline("not closed **bold")).toEqual([{ text: "not closed **bold" }]);
  });

  it("an empty line is one empty run, and plainText takes the marks off", () => {
    expect(parseInline("")).toEqual([{ text: "" }]);
    expect(plainText("**Pat** is *here*")).toBe("Pat is here");
  });
});

describe("paragraphs and lists", () => {
  it("a blank line starts a paragraph and a single line break stays a line break", () => {
    const blocks = parseBlocks("One\nstill one\n\nTwo");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "text" });
    expect((blocks[0] as any).lines).toHaveLength(2);
  });

  it("bullet lines make a bullet list, with - or the bullet sign or * and a space", () => {
    for (const marker of ["-", "•", "*"]) {
      const [list] = parseBlocks(`${marker} first\n${marker} second`);
      expect(list).toMatchObject({ kind: "list", ordered: false });
      expect((list as any).items.map((i: any) => i[0].text)).toEqual(["first", "second"]);
    }
  });

  it("numbered lines make a numbered list, but a date or a year at the start of a line does not", () => {
    expect(parseBlocks("1. one\n2) two")[0]).toMatchObject({ kind: "list", ordered: true });
    expect(parseBlocks("3 March 2026 was the day")[0]).toMatchObject({ kind: "text" });
    expect(parseBlocks("2026. A year")[0]).toMatchObject({ kind: "text" });
  });

  it("a paragraph can lead into a list and carry on after it", () => {
    const blocks = parseBlocks("The work includes:\n- sanding\n- spraying\nThank you.");
    expect(blocks.map((b) => b.kind)).toEqual(["text", "list", "text"]);
  });

  it("an italic start is not mistaken for a bullet", () => {
    expect(parseBlocks("*Note* this")[0]).toMatchObject({ kind: "text" });
  });

  it("nothing at all is no blocks", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("\n\n  \n")).toEqual([]);
  });
});

describe("the formatting buttons", () => {
  it("bold wraps the selection, and wraps again to take it off", () => {
    const on = applyFormat("a big day", 2, 5, "bold");
    expect(on).toEqual({ text: "a **big** day", start: 4, end: 7 });
    const off = applyFormat(on.text, on.start, on.end, "bold");
    expect(off.text).toBe("a big day");
  });

  it("bold with nothing selected leaves the cursor between the marks", () => {
    expect(applyFormat("ab", 1, 1, "bold")).toEqual({ text: "a****b", start: 3, end: 3 });
  });

  it("italic does the same with one asterisk", () => {
    expect(applyFormat("a big day", 2, 5, "italic").text).toBe("a *big* day");
  });

  it("a bullet list covers every line the selection touches, and a second click takes it off", () => {
    const text = "Intro\nsanding\nspraying\nOutro";
    const on = applyFormat(text, 8, 15, "bullets");
    expect(on.text).toBe("Intro\n- sanding\n- spraying\nOutro");
    expect(applyFormat(on.text, on.start, on.end, "bullets").text).toBe(text);
  });

  it("a numbered list numbers the lines from 1, and turns a bullet list into numbers", () => {
    expect(applyFormat("a\nb", 0, 3, "numbers").text).toBe("1. a\n2. b");
    expect(applyFormat("- a\n- b", 0, 7, "numbers").text).toBe("1. a\n2. b");
  });

  it("a list on the first line works from the very start of the text", () => {
    expect(applyFormat("first\nsecond", 0, 0, "bullets").text).toBe("- first\nsecond");
  });

  it("leaves blank lines in a selection alone", () => {
    expect(applyFormat("a\n\nb", 0, 4, "bullets").text).toBe("- a\n\n- b");
  });
});
