import { inflateRawSync } from "zlib";

// A small, strict ZIP reader, enough to open an .xlsx (a ZIP of XML files) without adding a package.
// An uploaded file is untrusted, so it refuses what it does not need (encrypted or ZIP64 archives) and caps how much
// it will unpack, so a crafted "zip bomb" cannot use up the server's memory.

const MAX_ENTRIES = 300;
const MAX_ENTRY_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

export class ZipError extends Error {}

type Entry = { name: string; method: number; compressedSize: number; size: number; localOffset: number };

export type Zip = { names: string[]; has(name: string): boolean; read(name: string): Buffer | null };

export function openZip(buf: Buffer): Zip {
  // The end-of-central-directory record is within the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("This is not a valid Excel (.xlsx) file.");

  const total = buf.readUInt16LE(eocd + 10);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || dirOffset === 0xffffffff) throw new ZipError("This Excel file uses a format that cannot be read. Save it again as a normal .xlsx or as a CSV.");
  if (total > MAX_ENTRIES) throw new ZipError("This Excel file has too many parts to be a normal spreadsheet.");

  const entries = new Map<string, Entry>();
  let pos = dirOffset;
  let declared = 0;
  for (let n = 0; n < total; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new ZipError("This Excel file looks damaged.");
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    if (pos + 46 + nameLen > buf.length) throw new ZipError("This Excel file looks damaged.");
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);

    if (flags & 1) throw new ZipError("This Excel file is password protected. Remove the password, save it, and try again.");
    if (size > MAX_ENTRY_BYTES) throw new ZipError("This Excel file contains a part that is too large.");
    declared += size;
    if (declared > MAX_TOTAL_BYTES) throw new ZipError("This Excel file is too large when unpacked.");

    entries.set(name, { name, method, compressedSize, size, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return {
    names: Array.from(entries.keys()),
    has: (name) => entries.has(name),
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      const o = e.localOffset;
      if (o + 30 > buf.length || buf.readUInt32LE(o) !== 0x04034b50) throw new ZipError("This Excel file looks damaged.");
      const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
      const data = buf.subarray(start, start + e.compressedSize);
      if (data.length !== e.compressedSize) throw new ZipError("This Excel file looks damaged.");
      if (e.method === 0) return Buffer.from(data);
      if (e.method !== 8) throw new ZipError("This Excel file uses a compression method that cannot be read.");
      try {
        // The declared size is the limit, so a file that claims to be small cannot unpack to something huge.
        return inflateRawSync(data, { maxOutputLength: e.size + 1 });
      } catch {
        throw new ZipError("This Excel file looks damaged.");
      }
    },
  };
}
