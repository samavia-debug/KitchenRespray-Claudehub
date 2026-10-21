import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { tableMissing } from "./errors";
import {
  bucketMimeTypes, checkUpload, cleanFileName, cleanFinishRequest, cleanUploadRequest, describeSize, DOCUMENT_TYPES, fileExtension, matchesSignature,
  MAX_DOCUMENT_BYTES, parseStoragePath, storagePath,
} from "./documents";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
const bytes = (...b: number[]) => new Uint8Array(b);

describe("file names", () => {
  it("keeps an ordinary name, tidies spacing, and drops folders and awkward characters", () => {
    expect(cleanFileName("Murphy kitchen quote.pdf")).toBe("Murphy kitchen quote.pdf");
    expect(cleanFileName("  Quote   v2 .pdf ")).toBe("Quote v2 .pdf");
    expect(cleanFileName("C:\\Users\\joanna\\Desktop\\Quote.pdf")).toBe("Quote.pdf");
    expect(cleanFileName("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(cleanFileName('Q<uo>te:"1"|?.pdf')).toBe("Quote1.pdf");
    expect(cleanFileName("tab\there\u0000.pdf")).toBe("tabhere.pdf");
  });

  it("gives nothing for a name that is not one", () => {
    for (const raw of ["", "   ", ".", "..", "/", "a/", null, undefined, 5]) expect(cleanFileName(raw), String(raw)).toBeNull();
  });

  it("shortens a very long name but keeps its ending", () => {
    const name = cleanFileName(`${"a".repeat(400)}.pdf`)!;
    expect(name.length).toBe(150);
    expect(name.endsWith(".pdf")).toBe(true);
  });

  it("reads the ending in lower case", () => {
    expect(fileExtension("Quote.PDF")).toBe("pdf");
    expect(fileExtension("a.b.docx")).toBe("docx");
    expect(fileExtension("noending")).toBeNull();
    expect(fileExtension("trailing.")).toBeNull();
  });
});

describe("which files are accepted", () => {
  const ok = (file_name: string, size = 1000, content_type?: string) => checkUpload({ file_name, size, content_type });

  it("accepts PDF, Word, Excel and pictures, whatever the case of the ending", () => {
    for (const name of ["a.pdf", "A.PDF", "a.doc", "a.docx", "a.xls", "a.xlsx", "a.jpg", "a.JPEG", "a.png"]) expect(ok(name), name).toHaveProperty("value");
    expect(ok("a.xlsx")).toEqual({ value: { file_name: "a.xlsx", ext: "xlsx", contentType: DOCUMENT_TYPES.xlsx.mime } });
  });

  it("refuses anything that can run, or that is not a business document", () => {
    for (const name of ["a.exe", "a.bat", "a.js", "a.html", "a.svg", "a.docm", "a.xlsm", "a.zip", "a.php", "a.pdf.exe", "a.txt", "a", ".pdf."]) {
      expect("error" in ok(name), name).toBe(true);
    }
    expect(ok("a.pdf ")).toHaveProperty("value"); // trailing space is tidied away
  });

  it("refuses an empty file and one over 10 MB, and says so in plain words", () => {
    expect(ok("a.pdf", 0)).toEqual({ error: "The file is empty" });
    expect(ok("a.pdf", -5)).toHaveProperty("error");
    expect(ok("a.pdf", Number.NaN)).toHaveProperty("error");
    expect(ok("a.pdf", "100" as unknown as number)).toHaveProperty("error");
    expect(ok("a.pdf", MAX_DOCUMENT_BYTES)).toHaveProperty("value");
    expect(ok("a.pdf", MAX_DOCUMENT_BYTES + 1)).toEqual({ error: expect.stringContaining("10 MB") });
  });

  it("does not depend on the type the browser reports, which is often wrong or empty for Office files", () => {
    for (const type of ["application/pdf", "", "application/octet-stream", "application/x-zip-compressed", "text/html", undefined]) {
      expect(ok("a.docx", 10, type), String(type)).toHaveProperty("value.contentType", DOCUMENT_TYPES.docx.mime);
    }
  });
});

describe("where a file is kept", () => {
  it("is the company's folder and a name made up by us, never the person's file name", () => {
    expect(storagePath(COMPANY, DOC, "pdf")).toBe(`${COMPANY}/${DOC}.pdf`);
    expect(parseStoragePath(`${COMPANY}/${DOC}.pdf`)).toEqual({ companyId: COMPANY, id: DOC, ext: "pdf" });
  });

  it("recognises only paths we would have made", () => {
    for (const p of [`${COMPANY}/${DOC}.exe`, `${COMPANY}/../${DOC}.pdf`, `${COMPANY}/${DOC}.pdf/extra`, `x/${DOC}.pdf`, `${COMPANY}/x.pdf`, `/${COMPANY}/${DOC}.pdf`, "", null, 5]) {
      expect(parseStoragePath(p), String(p)).toBeNull();
    }
  });
});

describe("a file's first bytes", () => {
  it("must be what its ending says", () => {
    expect(matchesSignature("pdf", bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe(true);
    expect(matchesSignature("png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
    expect(matchesSignature("jpg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(matchesSignature("jpeg", bytes(0xff, 0xd8, 0xff, 0xe1))).toBe(true);
    expect(matchesSignature("docx", bytes(0x50, 0x4b, 0x03, 0x04, 1))).toBe(true);
    expect(matchesSignature("xlsx", bytes(0x50, 0x4b, 0x03, 0x04, 1))).toBe(true);
    expect(matchesSignature("doc", bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe(true);
    expect(matchesSignature("xls", bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe(true);
  });

  it("rejects a program, a web page or a script given a document's ending, and anything empty or cut short", () => {
    const exe = bytes(0x4d, 0x5a, 0x90, 0x00); // MZ
    const html = Array.from(new TextEncoder().encode("<html><script>"));
    for (const ext of Object.keys(DOCUMENT_TYPES)) {
      expect(matchesSignature(ext, exe), ext).toBe(false);
      expect(matchesSignature(ext, bytes(...html)), ext).toBe(false);
      expect(matchesSignature(ext, bytes()), ext).toBe(false);
    }
    expect(matchesSignature("pdf", bytes(0x25, 0x50, 0x44))).toBe(false);
    expect(matchesSignature("exe", bytes(0x4d, 0x5a))).toBe(false);
    // A pdf that is really a Word file, and the reverse.
    expect(matchesSignature("pdf", bytes(0x50, 0x4b, 0x03, 0x04))).toBe(false);
    expect(matchesSignature("docx", bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe(false);
  });
});

describe("the request to start an upload", () => {
  const good = { company_id: COMPANY, file_name: "Quote.pdf", size: 5000, content_type: "application/pdf" };

  it("accepts a good one, with or without a job", () => {
    expect(cleanUploadRequest(good)).toEqual({ value: { ...good, opportunity_id: null } });
    expect(cleanUploadRequest({ ...good, opportunity_id: JOB })).toHaveProperty("value.opportunity_id", JOB);
    expect(cleanUploadRequest({ ...good, opportunity_id: "" })).toHaveProperty("value.opportunity_id", null);
  });

  it("refuses what is missing or not valid", () => {
    for (const bad of [null, [], "x", {}, { ...good, company_id: "nope" }, { ...good, opportunity_id: "nope" }, { ...good, file_name: "a.exe" }, { ...good, size: 0 }, { ...good, size: MAX_DOCUMENT_BYTES + 1 }]) {
      expect("error" in cleanUploadRequest(bad), JSON.stringify(bad)).toBe(true);
    }
  });
});

describe("the request to save an uploaded file", () => {
  const path = storagePath(COMPANY, DOC, "pdf");
  const good = { company_id: COMPANY, path, file_name: "Quote v2.pdf", note: "  after the site visit  " };

  it("accepts a good one and tidies the note", () => {
    expect(cleanFinishRequest(good)).toEqual({ value: { company_id: COMPANY, opportunity_id: null, path, file_name: "Quote v2.pdf", note: "after the site visit" } });
    expect(cleanFinishRequest({ ...good, note: "   " })).toHaveProperty("value.note", null);
    expect(cleanFinishRequest({ ...good, note: undefined })).toHaveProperty("value.note", null);
  });

  it("refuses a path that belongs to another company, a name that does not match the file, and a note that is too long", () => {
    const other = "44444444-4444-4444-8444-444444444444";
    expect(cleanFinishRequest({ ...good, company_id: other })).toEqual({ error: "That upload is not valid" });
    expect(cleanFinishRequest({ ...good, path: `${COMPANY}/${DOC}.exe` })).toEqual({ error: "That upload is not valid" });
    expect(cleanFinishRequest({ ...good, file_name: "Quote.docx" })).toEqual({ error: "The file name does not match the upload" });
    expect(cleanFinishRequest({ ...good, note: "x".repeat(501) })).toHaveProperty("error");
    expect(cleanFinishRequest({ ...good, note: 5 })).toHaveProperty("error");
    expect(cleanFinishRequest({ ...good, opportunity_id: "nope" })).toHaveProperty("error");
    expect(cleanFinishRequest(null)).toHaveProperty("error");
  });
});

describe("sizes", () => {
  it("are shown in plain units", () => {
    expect(describeSize(500)).toBe("500 B");
    expect(describeSize(1536)).toBe("2 KB");
    expect(describeSize(1)).toBe("1 B");
    expect(describeSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("the migration", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261029100000_crm_documents.sql", import.meta.url), "utf8");

  it("makes the bucket private, with the same size limit and file types the code accepts", () => {
    expect(sql).toContain(`${MAX_DOCUMENT_BYTES}`);
    for (const mime of bucketMimeTypes()) expect(sql, mime).toContain(`'${mime}'`);
    expect(sql).toMatch(/'crm-documents',\s*'crm-documents',\s*false,/);
    expect(sql).toMatch(/public = false/);
  });

  it("switches row-level security on for the table, with no policy", () => {
    expect(sql).toMatch(/alter table crm_documents enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
  });
});

describe("tableMissing", () => {
  it("recognises the ways the database says a table is not there yet", () => {
    for (const m of ['relation "crm_documents" does not exist', "Could not find the table 'public.crm_documents' in the schema cache", "schema cache is stale"]) expect(tableMissing(m), m).toBe(true);
    for (const m of ["permission denied", "connection reset", "", null, undefined]) expect(tableMissing(m as string), String(m)).toBe(false);
  });
});
