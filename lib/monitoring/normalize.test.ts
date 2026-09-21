import { describe, expect, it } from "vitest";
import { normalizeDomain } from "./normalize";

describe("normalizeDomain", () => {
  it("strips protocol", () => {
    expect(normalizeDomain("https://example.com")).toBe("example.com");
    expect(normalizeDomain("http://example.com")).toBe("example.com");
  });

  it("strips www subdomain", () => {
    expect(normalizeDomain("www.example.com")).toBe("example.com");
    expect(normalizeDomain("https://www.example.com")).toBe("example.com");
  });

  it("strips trailing path, query, and hash", () => {
    expect(normalizeDomain("https://example.com/")).toBe("example.com");
    expect(normalizeDomain("example.com/about")).toBe("example.com");
    expect(normalizeDomain("example.com?ref=x")).toBe("example.com");
  });

  it("strips a trailing port", () => {
    expect(normalizeDomain("example.com:8080")).toBe("example.com");
  });

  it("lowercases the domain", () => {
    expect(normalizeDomain("Example.COM")).toBe("example.com");
  });

  it("treats equivalent forms of the same site identically", () => {
    const forms = ["https://example.com/", "example.com", "www.example.com", "HTTP://WWW.EXAMPLE.COM"];
    const normalized = new Set(forms.map(normalizeDomain));
    expect(normalized.size).toBe(1);
  });
});
