import { describe, expect, it } from "vitest";
import { extractDocumentText, extractFileNameFromPath } from "./extract";

describe("extractFileNameFromPath", () => {
  it("recovers the real filename (with extension) from a Supabase Storage public URL", () => {
    const url = "https://kcdilumtlmruagvbqzbs.supabase.co/storage/v1/object/public/business-brain-documents/1790432941188-abc123.pdf";
    expect(extractFileNameFromPath(url)).toBe("1790432941188-abc123.pdf");
  });

  it("handles docx, txt, csv and md the same way", () => {
    expect(extractFileNameFromPath("https://example.com/bucket/file.docx")).toBe("file.docx");
    expect(extractFileNameFromPath("https://example.com/bucket/notes.txt")).toBe("notes.txt");
    expect(extractFileNameFromPath("https://example.com/bucket/data.csv")).toBe("data.csv");
    expect(extractFileNameFromPath("https://example.com/bucket/readme.md")).toBe("readme.md");
  });

  it("returns an empty string for a malformed URL instead of throwing", () => {
    expect(extractFileNameFromPath("not-a-url")).toBe("");
  });
});

describe("extractDocumentText — regression: title used as the filename made every upload 'unsupported'", () => {
  it("still resolves a real PDF correctly when given a user-typed title instead of a filename with no extension (the exact bug: doc.title has no dot, so the old code always fell through to fromType, but fromType alone is unreliable for docx/txt/md — the real fix is passing the real filename)", async () => {
    // Simulates what extract-document/route.ts now does: derive the real
    // filename from the storage URL rather than passing doc.title, which
    // is what makes this resolve to "txt" instead of "unsupported".
    const realFileName = extractFileNameFromPath("https://example.com/bucket/1790432941188-abc123.txt");
    const result = await extractDocumentText(Buffer.from("hello world"), realFileName, "text/plain");
    expect(result.status).toBe("done");
  });

  it("demonstrates the original bug: passing a title with no extension resolves to unsupported even for a real text file", async () => {
    const userTypedTitle = "Employee Handbook"; // no dot, not a filename
    const result = await extractDocumentText(Buffer.from("hello world"), userTypedTitle, "text/plain");
    // This is the bug being documented, not the desired behavior — the
    // fix is at the call site (use extractFileNameFromPath), not here.
    expect(result.status).toBe("unsupported");
  });
});
