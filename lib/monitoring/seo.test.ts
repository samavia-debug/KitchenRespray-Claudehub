import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSeo, checkDomainExpiry } from "./seo";

function textResponse(status: number, body: string) {
  return { status, text: async () => body } as Response;
}

function jsonResponse(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkSeo", () => {
  it("extracts title, meta description, canonical, and noindex from the homepage", async () => {
    const html = `<html><head>
      <title>All Surface Respray | Kitchen Resurfacing</title>
      <meta name="description" content="Professional kitchen respray services.">
      <link rel="canonical" href="https://example.com/">
      <meta name="robots" content="noindex, nofollow">
    </head></html>`;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/robots.txt")) return textResponse(200, "User-agent: *\nDisallow: /admin");
        if (url.endsWith("/sitemap.xml")) return textResponse(200, "<urlset></urlset>");
        return textResponse(200, html);
      })
    );

    const result = await checkSeo("example.com");
    expect(result.title).toBe("All Surface Respray | Kitchen Resurfacing");
    expect(result.metaDescription).toBe("Professional kitchen respray services.");
    expect(result.canonicalUrl).toBe("https://example.com/");
    expect(result.hasNoindex).toBe(true);
    expect(result.robotsTxtStatus).toBe("found");
    expect(result.sitemapStatus).toBe("found");
  });

  it("flags a robots.txt that disallows everything", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/robots.txt")) return textResponse(200, "User-agent: *\nDisallow: /\n");
        return textResponse(200, "<html></html>");
      })
    );

    const result = await checkSeo("example.com");
    expect(result.robotsDisallowsAll).toBe(true);
  });

  it("does not flag a robots.txt that only disallows specific paths", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/robots.txt")) return textResponse(200, "User-agent: *\nDisallow: /admin\n");
        return textResponse(200, "<html></html>");
      })
    );

    const result = await checkSeo("example.com");
    expect(result.robotsDisallowsAll).toBe(false);
  });

  it("reports missing robots.txt and sitemap.xml as missing, not error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/robots.txt")) return textResponse(404, "");
        if (url.endsWith("/sitemap.xml")) return textResponse(404, "");
        return textResponse(200, "<html></html>");
      })
    );

    const result = await checkSeo("example.com");
    expect(result.robotsTxtStatus).toBe("missing");
    expect(result.sitemapStatus).toBe("missing");
  });

  it("detects a Sitemap: directive inside robots.txt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/robots.txt")) return textResponse(200, "User-agent: *\nSitemap: https://example.com/sitemap.xml\n");
        return textResponse(200, "<html></html>");
      })
    );

    const result = await checkSeo("example.com");
    expect(result.sitemapInRobots).toBe(true);
  });

  it("returns nulls for a homepage with no title/description/canonical, without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => textResponse(200, "<html><body>Hello</body></html>"))
    );

    const result = await checkSeo("example.com");
    expect(result.title).toBeNull();
    expect(result.metaDescription).toBeNull();
    expect(result.canonicalUrl).toBeNull();
    expect(result.hasNoindex).toBe(false);
  });
});

describe("checkDomainExpiry", () => {
  it("extracts the expiration event date from a successful RDAP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          events: [
            { eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" },
            { eventAction: "expiration", eventDate: "2027-01-01T00:00:00Z" },
          ],
        })
      )
    );

    const result = await checkDomainExpiry("example.com");
    expect(result.expiresAt).toBe(new Date("2027-01-01T00:00:00Z").toISOString());
    expect(result.unavailable).toBe(false);
  });

  it("marks the domain unavailable (not an error) on a 404 from RDAP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, {})));

    const result = await checkDomainExpiry("example.ie");
    expect(result.unavailable).toBe(true);
    expect(result.errorMessage).toBeNull();
  });

  it("marks the domain unavailable when RDAP succeeds but has no expiration event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { events: [] })));

    const result = await checkDomainExpiry("example.com");
    expect(result.unavailable).toBe(true);
    expect(result.expiresAt).toBeNull();
  });

  it("reports a real error distinctly from unavailable when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const result = await checkDomainExpiry("example.com");
    expect(result.unavailable).toBe(false);
    expect(result.errorMessage).toBe("network down");
  });
});
