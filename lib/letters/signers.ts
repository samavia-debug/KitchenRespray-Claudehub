import { LETTER_TYPE_BY_KEY } from "./config";

// People who sign letters: a typed name and job title, and optionally a picture of their signature. The picture is a
// signature, so it is handled carefully: it is only ever served to an Admin, and a letter only shows it once the letter
// has been finalised (and, for a sensitive kind of letter, approved), so a draft never looks signed.

export type Signer = {
  id: string;
  name: string;
  title: string | null;
  has_image: boolean;
  is_default: boolean;
  active: boolean;
};

export type SignerInput = {
  name: string;
  title: string | null;
  is_default: boolean;
  active: boolean;
};

export const MAX_SIGNATURE_BYTES = 300_000;
const MAX_SIDE = 2000;
const MIN_SIDE = 20;

export type ImageInfo = { type: "png" | "jpeg"; width: number; height: number };

/** What the bytes really are and how big, read from the file itself, never from what the browser says it is. */
export function imageInfo(buf: Uint8Array): ImageInfo | null {
  const b = buf;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    return { type: "png", width: u32(16), height: u32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      // The start-of-frame markers carry the size; C4, C8 and CC are not frames.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "jpeg", height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

export type ParsedImage = { data: Buffer; info: ImageInfo };

/** A `data:image/png;base64,...` picture from the page, checked; or what is wrong with it, worded for the person. */
export function parseImageDataUrl(value: unknown): { image: ParsedImage } | { error: string } {
  if (typeof value !== "string") return { error: "The signature picture was not sent properly" };
  const m = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.trim());
  if (!m) return { error: "The signature must be a PNG or JPEG picture" };
  const data = Buffer.from(m[2], "base64");
  if (data.length > MAX_SIGNATURE_BYTES) return { error: `That picture is too large (the limit is ${Math.round(MAX_SIGNATURE_BYTES / 1000)} KB). Use a smaller one.` };
  const info = imageInfo(data);
  if (!info) return { error: "That file is not a PNG or JPEG picture" };
  if (info.type !== (m[1] === "png" ? "png" : "jpeg")) return { error: "That picture is not the kind of file it says it is" };
  if (info.width < MIN_SIDE || info.height < MIN_SIDE) return { error: "That picture is too small to be a signature" };
  if (info.width > MAX_SIDE || info.height > MAX_SIDE) return { error: `That picture is too large (the longest side can be ${MAX_SIDE} pixels)` };
  return { image: { data, info } };
}

const text = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  return s || null;
};

export function cleanSignerInput(raw: unknown): { value: SignerInput } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Nothing was sent" };
  const b = raw as Record<string, unknown>;
  const name = text(b.name, 120);
  if (!name) return { error: "Enter the signer's name" };
  return { value: { name, title: text(b.title, 120), is_default: b.is_default === true, active: b.active !== false } };
}

/** The typed words under a signature: the name, then the job title. */
export const signerLines = (s: Pick<Signer, "name" | "title">): string => [s.name, s.title].filter(Boolean).join("\n");

/**
 * Whether a letter may show the signature picture. Never on a draft; once finalised for an ordinary letter; and for the kinds that
 * need management approval (a warning, a reference) only once approved, the same point at which their "awaiting approval" banner goes.
 */
export function showSignatureImage(status: "draft" | "finalised" | "approved", letterType: string): boolean {
  if (status === "approved") return true;
  if (status === "finalised") return !LETTER_TYPE_BY_KEY[letterType]?.sensitive;
  return false;
}

/** Whether a picture is a stored id a letter can refer to. */
export const SIGNER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
