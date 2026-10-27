import { describe, expect, it } from "vitest";
import mammoth from "mammoth";
import { buildDocx } from "./docx";
import { EMPTY_SETTINGS, renderLetter, type LetterContent, type LetterSettings } from "./layout";
import { MAX_SIGNATURE_BYTES, cleanSignerInput, imageInfo, parseImageDataUrl, showSignatureImage, signerLines } from "./signers";
import { cleanDetails } from "./validate";

/** The first bytes of a PNG of the given size: enough for the file to be recognised and measured. */
function png(width: number, height: number, extra = 0): Buffer {
  const b = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** The first bytes of a JPEG: a start marker, an APP0 segment, then a baseline frame header carrying the size. */
function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(20)]);
}

const url = (type: string, buf: Buffer) => `data:image/${type};base64,${buf.toString("base64")}`;

describe("reading a picture's real size", () => {
  it("PNG", () => expect(imageInfo(png(300, 90))).toEqual({ type: "png", width: 300, height: 90 }));
  it("JPEG, past its other segments", () => expect(imageInfo(jpeg(640, 200))).toEqual({ type: "jpeg", width: 640, height: 200 }));
  it("nothing else is a picture", () => {
    expect(imageInfo(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(imageInfo(Buffer.from("GIF89a................................"))).toBeNull();
    expect(imageInfo(Buffer.alloc(0))).toBeNull();
  });
});

describe("a signature picture sent from the page", () => {
  it("accepts a PNG or JPEG of a sensible size", () => {
    const a = parseImageDataUrl(url("png", png(400, 120)));
    expect("image" in a && a.image.info).toEqual({ type: "png", width: 400, height: 120 });
    const b = parseImageDataUrl(url("jpeg", jpeg(500, 150)));
    expect("image" in b && b.image.info.type).toBe("jpeg");
    expect("image" in parseImageDataUrl(url("jpg", jpeg(500, 150)))).toBe(true);
  });

  it("refuses anything else, with a reason the person can act on", () => {
    expect(parseImageDataUrl(42)).toEqual({ error: "The signature picture was not sent properly" });
    expect(parseImageDataUrl("hello")).toEqual({ error: "The signature must be a PNG or JPEG picture" });
    expect(parseImageDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toEqual({ error: "The signature must be a PNG or JPEG picture" });
    expect(parseImageDataUrl(url("png", Buffer.from("not a picture at all, just words in a row")))).toEqual({ error: "That file is not a PNG or JPEG picture" });
    expect(parseImageDataUrl(url("png", jpeg(400, 120)))).toEqual({ error: "That picture is not the kind of file it says it is" });
    expect(parseImageDataUrl(url("png", png(10, 10)))).toEqual({ error: "That picture is too small to be a signature" });
    expect(parseImageDataUrl(url("png", png(5000, 100)))).toEqual({ error: "That picture is too large (the longest side can be 2000 pixels)" });
    expect(parseImageDataUrl(url("png", png(400, 120, MAX_SIGNATURE_BYTES)))).toMatchObject({ error: expect.stringContaining("too large") });
  });
});

describe("signers", () => {
  it("need a name; the title is optional; they are usable unless switched off", () => {
    expect(cleanSignerInput({ name: "  " })).toEqual({ error: "Enter the signer's name" });
    expect(cleanSignerInput(null)).toEqual({ error: "Nothing was sent" });
    expect(cleanSignerInput({ name: " Pat  Example ", title: "Director", is_default: true })).toEqual({ value: { name: "Pat Example", title: "Director", is_default: true, active: true } });
    expect(cleanSignerInput({ name: "A", active: false })).toEqual({ value: { name: "A", title: null, is_default: false, active: false } });
  });

  it("the typed lines under a signature are the name and the title", () => {
    expect(signerLines({ name: "Pat Example", title: "Director" })).toBe("Pat Example\nDirector");
    expect(signerLines({ name: "Pat Example", title: null })).toBe("Pat Example");
  });
});

describe("when a letter may show a signature picture", () => {
  it("never on a draft, once finalised for an ordinary letter, and for a sensitive kind only once approved", () => {
    expect(showSignatureImage("draft", "employment_confirmation")).toBe(false);
    expect(showSignatureImage("draft", "warning")).toBe(false);
    expect(showSignatureImage("finalised", "employment_confirmation")).toBe(true);
    expect(showSignatureImage("finalised", "warning")).toBe(false);
    expect(showSignatureImage("finalised", "employment_reference")).toBe(false);
    expect(showSignatureImage("approved", "warning")).toBe(true);
    expect(showSignatureImage("approved", "general_business")).toBe(true);
  });
});

const ID = "0b9f6c2e-7d52-4f0e-9a41-3c8f1d2e5a77";
const settings: LetterSettings = { ...EMPTY_SETTINGS, signatory_name: "A. Manager", signatory_title: "Director" };
const letter = (over: Partial<LetterContent> = {}): LetterContent => ({
  letter_type: "work_assignment",
  status: "finalised",
  letter_date: "2026-10-26",
  subject: "Work",
  recipient: { name: "Pat Example" },
  greeting: "Dear Pat,",
  body: "You are assigned the Murphy kitchen.",
  closing: "Yours sincerely,",
  details: { signerId: ID, signatureBlock: "Pat Example\nDirector" },
  ...over,
});

describe("a letter and its signer", () => {
  it("carries the signer only once the letter may show a picture", () => {
    expect(renderLetter(settings, letter({ status: "draft" })).signerId).toBeNull();
    expect(renderLetter(settings, letter({ status: "finalised" })).signerId).toBe(ID);
    expect(renderLetter(settings, letter({ status: "finalised", letter_type: "warning" })).signerId).toBeNull();
    expect(renderLetter(settings, letter({ status: "approved", letter_type: "warning" })).signerId).toBe(ID);
  });

  it("has none when no signer was chosen or the id is not a real one", () => {
    expect(renderLetter(settings, letter({ details: {} })).signerId).toBeNull();
    expect(renderLetter(settings, letter({ details: { signerId: "../../etc/passwd" } })).signerId).toBeNull();
  });

  it("keeps only a well-formed id when saved", () => {
    expect(cleanDetails({ signerId: ` ${ID.toUpperCase()} ` }).signerId).toBe(ID);
    expect(cleanDetails({ signerId: "nope" }).signerId).toBe("");
    expect(cleanDetails({}).signerId).toBe("");
  });
});

const zipText = (buf: Buffer, name: string): string | null => {
  let p = 0;
  while (p < buf.length - 30 && buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extra = buf.readUInt16LE(p + 28);
    const start = p + 30 + nameLen + extra;
    if (buf.subarray(p + 30, p + 30 + nameLen).toString("utf8") === name) return buf.subarray(start, start + size).toString("latin1");
    p = start + size;
  }
  return null;
};
const hasPart = (buf: Buffer, name: string) => zipText(buf, name) !== null;

describe("the signature picture in the Word file", () => {
  const rendered = renderLetter(settings, letter());
  const picture = png(450, 150);
  const sig = { data: picture, type: "png" as const, width: 450, height: 150 };

  it("goes above the typed name, in place of the blank lines, with its own relationship", () => {
    const doc = buildDocx(rendered, new Date("2026-10-26T10:00:00Z"), undefined, sig);
    expect(hasPart(doc, "word/media/signature.png")).toBe(true);
    expect(zipText(doc, "word/_rels/document.xml.rels")).toContain('Id="rIdSign"');
    expect(zipText(doc, "[Content_Types].xml")).toContain('Extension="png"');
    const body = zipText(doc, "word/document.xml")!;
    expect(body).toContain('<a:blip r:embed="rIdSign"/>');
    // 15 mm high, three times as wide.
    expect(body).toContain('<wp:extent cx="1620000" cy="540000"/>');
    // The picture comes after the closing and before the typed name and title, and no blank signing lines are left behind it.
    const at = body.indexOf("rIdSign");
    expect(body.indexOf("Yours sincerely,")).toBeLessThan(at);
    expect(body.lastIndexOf("Pat Example")).toBeGreaterThan(at);
    expect(body.indexOf("Director")).toBeGreaterThan(body.lastIndexOf("Pat Example") - 1);
    expect(body.slice(at)).not.toContain('<w:t xml:space="preserve"></w:t>');
  });

  it("a very wide signature is narrowed so it never runs across the page", () => {
    const wide = { data: png(1200, 100), type: "png" as const, width: 1200, height: 100 };
    const body = zipText(buildDocx(rendered, new Date(), undefined, wide), "word/document.xml")!;
    expect(body).toContain('<wp:extent cx="2160000" cy="180000"/>'); // 60 mm wide at 12 to 1
  });

  it("a JPEG is stored as .jpg with its own content type", () => {
    const doc = buildDocx(rendered, new Date(), undefined, { data: jpeg(300, 100), type: "jpeg", width: 300, height: 100 });
    expect(hasPart(doc, "word/media/signature.jpg")).toBe(true);
    expect(zipText(doc, "[Content_Types].xml")).toContain('Extension="jpg" ContentType="image/jpeg"');
  });

  it("works together with the letterhead, and the file still reads as the letter", async () => {
    const letterhead = png(1489, 2106);
    const doc = buildDocx(renderLetter(settings, letter(), { artwork: true }), new Date(), letterhead, sig);
    const rels = zipText(doc, "word/_rels/document.xml.rels")!;
    expect(rels).toContain("rIdHeader");
    expect(rels).toContain("rIdSign");
    expect(hasPart(doc, "word/media/letterhead.png")).toBe(true);
    const { value, messages } = await mammoth.extractRawText({ buffer: doc });
    expect(messages.filter((m) => m.type === "error")).toEqual([]);
    expect(value).toContain("Pat Example");
    expect(value).toContain("Director");
  });

  it("without a picture the file is as it was, with room left to sign", () => {
    const doc = buildDocx(renderLetter(settings, letter({ status: "draft" })), new Date());
    expect(hasPart(doc, "word/_rels/document.xml.rels")).toBe(false);
    expect(zipText(doc, "word/document.xml")).not.toContain("rIdSign");
  });
});
