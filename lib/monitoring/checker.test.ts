import { describe, expect, it } from "vitest";
import { detectLikelyBlocked, extractLinks } from "./checker";

describe("detectLikelyBlocked", () => {
  it("is false for a normal 200 response", () => {
    expect(detectLikelyBlocked(200, new Headers(), "")).toBe(false);
  });

  it("is false for a plain 403 with no WAF signature", () => {
    expect(detectLikelyBlocked(403, new Headers(), "<html><body>Forbidden</body></html>")).toBe(false);
  });

  it("detects a Cloudflare 403 by server header", () => {
    const headers = new Headers({ server: "cloudflare" });
    expect(detectLikelyBlocked(403, headers, "")).toBe(true);
  });

  it("detects a Cloudflare 403 by cf-mitigated header", () => {
    const headers = new Headers({ "cf-mitigated": "challenge" });
    expect(detectLikelyBlocked(403, headers, "")).toBe(true);
  });

  it("detects a Sucuri block by via header", () => {
    const headers = new Headers({ via: "1.1 Sucuri/2.0" });
    expect(detectLikelyBlocked(403, headers, "")).toBe(true);
  });

  it("detects common bot-protection body text", () => {
    expect(detectLikelyBlocked(403, new Headers(), "Please verify you are a human before continuing")).toBe(true);
  });

  it("ignores body/header signatures on a status code that isn't block-shaped", () => {
    const headers = new Headers({ server: "cloudflare" });
    expect(detectLikelyBlocked(200, headers, "cloudflare")).toBe(false);
  });
});

describe("extractLinks", () => {
  const base = "https://example.com/";

  it("extracts absolute and relative hrefs, resolved against the base", () => {
    const html = `<a href="/about">About</a><a href="https://example.com/contact">Contact</a>`;
    expect(extractLinks(html, base).sort()).toEqual(
      ["https://example.com/about", "https://example.com/contact"].sort()
    );
  });

  it("dedupes repeated links", () => {
    const html = `<a href="/about">1</a><a href="/about">2</a>`;
    expect(extractLinks(html, base)).toEqual(["https://example.com/about"]);
  });

  it("strips hash fragments so #section links don't count as separate URLs", () => {
    const html = `<a href="/about#team">Team</a><a href="/about">About</a>`;
    expect(extractLinks(html, base)).toEqual(["https://example.com/about"]);
  });

  it("skips mailto, tel, and javascript hrefs", () => {
    const html = `<a href="mailto:a@example.com">Mail</a><a href="tel:12345">Call</a><a href="javascript:void(0)">JS</a>`;
    expect(extractLinks(html, base)).toEqual([]);
  });

  it("skips unresolvable hrefs without throwing", () => {
    const html = `<a href="not a valid url with spaces and no scheme :::">Bad</a>`;
    expect(() => extractLinks(html, base)).not.toThrow();
  });
});
