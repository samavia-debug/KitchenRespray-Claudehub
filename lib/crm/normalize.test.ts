import { describe, expect, it } from "vitest";
import { cleanWebsite, emailBusinessDomain, emailKey, isFreeEmailDomain, normalizeAddress, normalizeName, phoneKey, searchTerm, websiteDomain } from "./normalize";

describe("normalizeName", () => {
  it("treats different spellings of the same company as equal", () => {
    expect(normalizeName("A&B Roofing Ltd.")).toBe(normalizeName("A and B Roofing Limited"));
    expect(normalizeName("  O'Brien   Builders  LTD ")).toBe("o brien builders");
  });

  it("drops accents and punctuation", () => {
    expect(normalizeName("Séan Ó Murchú & Sons")).toBe("sean o murchu sons");
  });

  it("does not make different companies equal", () => {
    expect(normalizeName("Ace Roofing Dublin")).not.toBe(normalizeName("Ace Roofing Leinster"));
  });

  it("gives an empty string for nothing", () => {
    expect(normalizeName(null)).toBe("");
    expect(normalizeName("Ltd")).toBe("");
  });
});

describe("phoneKey", () => {
  it("gives one key for the usual Irish ways of writing a number", () => {
    const k = phoneKey("+353 87 123 4567");
    expect(k).toBe("871234567");
    expect(phoneKey("087 123 4567")).toBe(k);
    expect(phoneKey("00353 (0)87 1234567")).toBe(k);
    expect(phoneKey("+353-87-123-4567")).toBe(k);
  });

  it("handles landlines", () => {
    expect(phoneKey("+353 1 555 0100")).toBe("15550100");
    expect(phoneKey("01 555 0100")).toBe("15550100");
  });

  it("is null for too little to compare", () => {
    expect(phoneKey("123")).toBeNull();
    expect(phoneKey("")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});

describe("websiteDomain and cleanWebsite", () => {
  it("reduces an address to its host", () => {
    expect(websiteDomain("https://www.Example.ie/about?x=1")).toBe("example.ie");
    expect(websiteDomain("example.ie")).toBe("example.ie");
    expect(websiteDomain("http://example.ie:8080/")).toBe("example.ie");
  });

  it("rejects things that are not addresses", () => {
    expect(websiteDomain("not a website")).toBeNull();
    expect(websiteDomain("localhost")).toBeNull();
    expect(websiteDomain(null)).toBeNull();
  });

  it("adds https when it is missing and refuses nonsense", () => {
    expect(cleanWebsite("example.ie")).toBe("https://example.ie");
    expect(cleanWebsite("http://example.ie")).toBe("http://example.ie");
    expect(cleanWebsite("javascript:alert(1)")).toBeNull();
    expect(cleanWebsite("  ")).toBeNull();
  });
});

describe("email helpers", () => {
  it("uses a company's own domain, but never a free provider's", () => {
    expect(emailBusinessDomain("Sales@AceRoofing.ie")).toBe("aceroofing.ie");
    expect(emailBusinessDomain("ace@gmail.com")).toBeNull();
    expect(isFreeEmailDomain("Hotmail.com")).toBe(true);
    expect(emailBusinessDomain("nonsense")).toBeNull();
  });

  it("lower-cases and validates", () => {
    expect(emailKey(" Joe@Ace.IE ")).toBe("joe@ace.ie");
    expect(emailKey("joe@")).toBeNull();
  });
});

describe("normalizeAddress", () => {
  it("needs enough text to be worth comparing", () => {
    expect(normalizeAddress("Unit 3", null)).toBeNull();
    expect(normalizeAddress("Unit 12D, Robinhood Industrial Estate", "D22 X1Y2")).toBe("unit 12d robinhood industrial estate d22 x1y2");
  });
});

describe("searchTerm", () => {
  it("removes characters that would break a database filter", () => {
    expect(searchTerm('ace,roofing)%*"')).toBe("ace roofing");
    expect(searchTerm("a),name.eq.x")).toBe("a name.eq.x");
  });

  it("is cut to a sensible length", () => {
    expect(searchTerm("x".repeat(500)).length).toBe(80);
    expect(searchTerm(null)).toBe("");
  });
});
