import { describe, expect, it } from "vitest";
import mammoth from "mammoth";
import { buildDocx } from "./docx";
import { EMPTY_SETTINGS, recipientLinesOf, renderLetter, signatureLinesOf, type LetterContent, type LetterSettings } from "./layout";
import { cleanDetails } from "./validate";

const settings: LetterSettings = { ...EMPTY_SETTINGS, company_name: "Kitchen Respray", signatory_name: "A. Manager", signatory_title: "Director" };

const content: LetterContent = {
  letter_type: "work_assignment",
  status: "approved",
  letter_date: "2026-10-26",
  subject: "Work",
  recipient: { name: "Pat Example", address: "12 Main Street\nKylemore", phone: "083 000 0000" },
  greeting: "Dear Pat,",
  body: "You are assigned:\n- the **Murphy** kitchen\n- the *Byrne* hall\n\nSteps:\n1. Arrive\n2. Spray\n\nThank you.",
  closing: "Yours sincerely,",
};

const textOf = async (doc: Buffer) => (await mammoth.extractRawText({ buffer: doc })).value;
const rawXml = (doc: Buffer) => doc.toString("latin1");

describe("a letter with formatting", () => {
  it("is laid out as paragraphs and lists, with the original text kept as paragraphs too", () => {
    const l = renderLetter(settings, content);
    expect(l.blocks.map((b) => b.kind)).toEqual(["text", "list", "text", "list", "text"]);
    expect(l.paragraphs).toHaveLength(3);
  });

  it("goes into Word with real bold and italic runs, and bullets and numbers as editable text", async () => {
    const doc = buildDocx(renderLetter(settings, content));
    const xml = rawXml(doc);
    expect(xml).toMatch(/<w:b\/><w:sz w:val="22"\/><\/w:rPr><w:t xml:space="preserve">Murphy<\/w:t>/);
    expect(xml).toMatch(/<w:i\/><w:sz w:val="22"\/><\/w:rPr><w:t xml:space="preserve">Byrne<\/w:t>/);
    expect(xml).toContain('<w:ind w:left="567" w:hanging="283"/>');

    const out = await textOf(doc);
    expect(out).toContain("•\tthe Murphy kitchen");
    expect(out).toContain("1.\tArrive");
    expect(out).toContain("2.\tSpray");
    expect(out).not.toContain("**");
  });
});

describe("the address block and the sign-off", () => {
  it("are built from the recipient details and the settings by default", () => {
    expect(recipientLinesOf(content.recipient)).toEqual(["Pat Example", "12 Main Street", "Kylemore", "Tel: 083 000 0000"]);
    expect(signatureLinesOf(settings)).toEqual(["", "", "A. Manager", "Director"]);
    expect(renderLetter(settings, content).recipientLines).toEqual(recipientLinesOf(content.recipient));
  });

  it("words typed over them for this letter are used instead, and blanks are ignored", () => {
    const l = renderLetter(settings, { ...content, details: { addressBlock: "Mr Byrne\n\nAIB, Bray ", signatureBlock: "P. Example\nHR Manager" } });
    expect(l.recipientLines).toEqual(["Mr Byrne", "AIB, Bray"]);
    expect(l.signature).toEqual(["", "", "P. Example", "HR Manager"]);
  });

  it("an empty typed block falls back to the details", () => {
    const l = renderLetter(settings, { ...content, details: { addressBlock: "  ", signatureBlock: "" } });
    expect(l.recipientLines[0]).toBe("Pat Example");
    expect(l.signature).toEqual(["", "", "A. Manager", "Director"]);
  });

  it("are saved with the letter, within limits", () => {
    const d = cleanDetails({ addressBlock: "a".repeat(900), signatureBlock: " Name \r\nTitle " });
    expect(d.addressBlock).toHaveLength(600);
    expect(d.signatureBlock).toBe("Name \nTitle"); // the ends are trimmed; each line is trimmed again when the letter is laid out
  });
});
