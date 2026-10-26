import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import mammoth from "mammoth";
import { buildDocx } from "./docx";
import { LETTERHEAD, mmToEmu, mmToTwips, SHEET_PADDING } from "./letterhead";
import { LETTERHEAD_PNG_BASE64 } from "./letterhead-image";
import { EMPTY_SETTINGS, renderLetter, type LetterContent, type LetterSettings } from "./layout";

const png = readFileSync(join(__dirname, "../../public/letterhead.png"));

const settings: LetterSettings = { ...EMPTY_SETTINGS, company_name: "Kitchen Respray", address: "4 Kylemore Park\nBallyfermot", phone: "+353 86 245 6456", signatory_name: "A. Manager", signatory_title: "Director" };
const content: LetterContent = {
  letter_type: "work_assignment",
  status: "approved",
  letter_date: "2026-10-26",
  subject: "Work assignment",
  recipient: { name: "Pat Example", address: "12 Main Street\nKylemore", phone: "083 000 0000", email: "pat@example.com" },
  greeting: "Dear Pat Example,",
  body: "This letter confirms the work you are being assigned.\n\nWork assigned: the Murphy kitchen.",
  closing: "Yours sincerely,",
};

/** The names of the files inside a zip, read from its central directory. */
function zipNames(buf: Buffer): string[] {
  const names: string[] = [];
  let at = buf.length - 22;
  const count = buf.readUInt16LE(at + 10);
  let p = buf.readUInt32LE(at + 16);
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + nameLen).toString("utf8"));
    p += 46 + nameLen + extra + comment;
  }
  return names;
}

const text = (buf: Buffer, name: string) => {
  // Entries are stored uncompressed, so a part's text can be found by reading from its local header.
  let p = 0;
  while (p < buf.length - 30 && buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extra = buf.readUInt16LE(p + 28);
    const start = p + 30 + nameLen + extra;
    if (buf.subarray(p + 30, p + 30 + nameLen).toString("utf8") === name) return buf.subarray(start, start + size).toString("utf8");
    p = start + size;
  }
  return null;
};

describe("the letterhead artwork", () => {
  it("is an A4 page image", () => {
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width / height).toBeCloseTo(LETTERHEAD.pageWidthMm / LETTERHEAD.pageHeightMm, 2);
    expect(width).toBeGreaterThanOrEqual(1200); // sharp enough to print
  });

  it("is the same picture the Word download embeds, so the two cannot drift apart", () => {
    expect(Buffer.from(LETTERHEAD_PNG_BASE64, "base64").equals(png)).toBe(true);
  });

  it("leaves room for the header and footer bars", () => {
    expect(LETTERHEAD.topMm).toBeGreaterThanOrEqual(52); // the header bar and logo end about 51 mm down
    expect(LETTERHEAD.pageHeightMm - LETTERHEAD.bottomMm).toBeLessThanOrEqual(276); // the contact bar starts about 279 mm down
    expect(LETTERHEAD.topMm + LETTERHEAD.bottomMm).toBeLessThan(LETTERHEAD.pageHeightMm / 2);
  });

  it("is turned into screen and Word measures", () => {
    expect(SHEET_PADDING).toBe("26.667% 9.524% 11.429%");
    expect(mmToTwips(56)).toBe(3175);
    expect(mmToEmu(210)).toBe(7560000);
  });
});

describe("a letter on the letterhead", () => {
  it("leaves off the typed letterhead lines, since the artwork has them, and keeps everything else", () => {
    const plain = renderLetter(settings, content);
    const art = renderLetter(settings, content, { artwork: true });
    expect(plain.letterhead.length).toBeGreaterThan(0);
    expect(art.letterhead).toEqual([]);
    expect(art.recipientLines).toEqual(["Pat Example", "12 Main Street", "Kylemore", "Tel: 083 000 0000", "Email: pat@example.com"]);
    expect(art.signature).toEqual(plain.signature);
    expect(art.paragraphs).toEqual(plain.paragraphs);
  });

  it("puts the picture behind every page of the Word file and keeps the margins clear of it", () => {
    const doc = buildDocx(renderLetter(settings, content, { artwork: true }), new Date("2026-10-26T10:00:00Z"), png);
    const names = zipNames(doc);
    expect(names).toEqual(expect.arrayContaining(["[Content_Types].xml", "word/document.xml", "word/_rels/document.xml.rels", "word/header1.xml", "word/_rels/header1.xml.rels", "word/media/letterhead.png"]));

    const header = text(doc, "word/header1.xml")!;
    expect(header).toContain('behindDoc="1"');
    expect(header).toContain('<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset>');
    expect(header).toContain(`<wp:extent cx="${mmToEmu(210)}" cy="${mmToEmu(297)}"/>`);

    const body = text(doc, "word/document.xml")!;
    expect(body).toContain('<w:headerReference w:type="default" r:id="rIdHeader"/>');
    expect(body).toContain(`w:top="${mmToTwips(LETTERHEAD.topMm)}"`);
    expect(body).toContain(`w:bottom="${mmToTwips(LETTERHEAD.bottomMm)}"`);

    // Every id the document refers to is declared, and the picture inside is the real one.
    expect(text(doc, "word/_rels/document.xml.rels")).toContain('Id="rIdHeader"');
    expect(text(doc, "word/_rels/header1.xml.rels")).toContain('Id="rIdImage"');
    expect(text(doc, "[Content_Types].xml")).toContain('Extension="png"');
    expect(text(doc, "[Content_Types].xml")).toContain("/word/header1.xml");
    const at = doc.indexOf(png);
    expect(at).toBeGreaterThan(0);
  });

  it("is still a readable Word file whose text is the letter", async () => {
    const doc = buildDocx(renderLetter(settings, content, { artwork: true }), new Date(), png);
    const { value, messages } = await mammoth.extractRawText({ buffer: doc });
    expect(messages).toEqual([]);
    expect(value).toContain("Pat Example");
    expect(value).toContain("12 Main Street");
    expect(value).toContain("Work assigned: the Murphy kitchen.");
    expect(value).not.toContain("4 Kylemore Park");
  });

  it("makes the same plain Word file as before when there is no picture", () => {
    const doc = buildDocx(renderLetter(settings, content), new Date("2026-10-26T10:00:00Z"));
    expect(zipNames(doc)).toEqual(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    expect(text(doc, "word/document.xml")).not.toContain("headerReference");
  });
});
