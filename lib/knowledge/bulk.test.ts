import { describe, expect, it } from "vitest";
import { fileExtension, findDuplicates, formatSize, isReadableName, titleFromFilename, unreadableReason } from "./bulk";

describe("fileExtension / isReadableName", () => {
  it("reads the last extension in lower case", () => {
    expect(fileExtension("Contract.PDF")).toBe("pdf");
    expect(fileExtension("archive.tar.gz")).toBe("gz");
  });

  it("returns nothing for names without a real extension", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".env")).toBe("");
    expect(fileExtension("trailing.")).toBe("");
  });

  it("matches exactly the types Eleven can read", () => {
    for (const n of ["a.pdf", "a.DOCX", "a.txt", "a.csv", "a.md"]) expect(isReadableName(n)).toBe(true);
    for (const n of ["a.xlsx", "a.jpg", "a.png", "a.doc", "a"]) expect(isReadableName(n)).toBe(false);
  });
});

describe("titleFromFilename", () => {
  it("turns a file name into a readable title", () => {
    expect(titleFromFilename("Chadwicks_Kitchen  price list.pdf")).toBe("Chadwicks Kitchen price list");
    expect(titleFromFilename("Van-Insurance 2026.pdf")).toBe("Van-Insurance 2026");
  });

  it("keeps dots inside the name and handles missing extensions", () => {
    expect(titleFromFilename("v1.2 handbook.docx")).toBe("v1.2 handbook");
    expect(titleFromFilename("notes")).toBe("notes");
  });

  it("never returns an empty title", () => {
    expect(titleFromFilename("___.pdf")).toBe("Untitled document");
  });
});

describe("findDuplicates", () => {
  it("flags titles that already exist, ignoring case and spacing at the ends", () => {
    expect(findDuplicates(["Price List", "New thing"], ["price list "])).toEqual([true, false]);
  });

  it("flags the second of two identical titles in one batch, not the first", () => {
    expect(findDuplicates(["A", "B", "a"], [])).toEqual([false, false, true]);
  });
});

describe("unreadableReason / formatSize", () => {
  it("explains why a file can't be read, and stays quiet when it can", () => {
    expect(unreadableReason("photo.jpg", 100)).toMatch(/can't read inside/);
    expect(unreadableReason("big.pdf", 16 * 1024 * 1024)).toMatch(/over 15 MB/);
    expect(unreadableReason("ok.pdf", 1024)).toBeNull();
  });

  it("formats sizes", () => {
    expect(formatSize(500)).toBe("500 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
