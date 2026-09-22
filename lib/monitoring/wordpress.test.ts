import { afterEach, describe, expect, it, vi } from "vitest";
import { checkWordPress, compareVersions } from "./wordpress";

function htmlResponse(body: string) {
  return { ok: true, text: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compareVersions", () => {
  it("detects a lower version as less than a higher one", () => {
    expect(compareVersions("1.2.0", "1.3.0")).toBe(-1);
  });

  it("detects equal versions", () => {
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  });

  it("treats a shorter version as equal when trailing segments are zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });

  it("detects a higher version as greater", () => {
    expect(compareVersions("4.1.0", "4.0.9")).toBe(1);
  });
});

describe("checkWordPress", () => {
  it("detects WordPress via the generator meta tag and extracts the core version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse(`<html><head><meta name="generator" content="WordPress 6.4.2"></head></html>`))
    );

    const result = await checkWordPress("example.com");
    expect(result.isWordPress).toBe(true);
    expect(result.coreVersion).toBe("6.4.2");
  });

  it("detects WordPress via wp-content references even without a generator tag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse(`<html><head><link rel="stylesheet" href="/wp-content/themes/astra/style.css"></head></html>`))
    );

    const result = await checkWordPress("example.com");
    expect(result.isWordPress).toBe(true);
  });

  it("returns isWordPress false for a non-WordPress site, with no core version or plugins", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(`<html><body>Hello, plain site</body></html>`)));

    const result = await checkWordPress("example.com");
    expect(result.isWordPress).toBe(false);
    expect(result.coreVersion).toBeNull();
    expect(result.plugins).toEqual([]);
  });

  it("extracts the active theme slug", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        htmlResponse(
          `<html><head><meta name="generator" content="WordPress 6.4"><link href="/wp-content/themes/astra/style.css?ver=4.5.0"></head></html>`
        )
      )
    );

    const result = await checkWordPress("example.com");
    expect(result.themeSlug).toBe("astra");
  });

  it("finds a plugin, checks its version against the WordPress.org API, and flags it outdated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("api.wordpress.org")) {
          return { ok: true, json: async () => ({ version: "3.0.0" }) } as Response;
        }
        return htmlResponse(
          `<html><head><meta name="generator" content="WordPress 6.4"><script src="/wp-content/plugins/contact-form-7/js/scripts.js?ver=2.1.0"></script></head></html>`
        );
      })
    );

    const result = await checkWordPress("example.com");
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].slug).toBe("contact-form-7");
    expect(result.plugins[0].version).toBe("2.1.0");
    expect(result.plugins[0].latestVersion).toBe("3.0.0");
    expect(result.plugins[0].isOutdated).toBe(true);
  });

  it("does not flag a plugin as outdated when its version matches the latest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("api.wordpress.org")) {
          return { ok: true, json: async () => ({ version: "2.1.0" }) } as Response;
        }
        return htmlResponse(
          `<html><head><meta name="generator" content="WordPress 6.4"><script src="/wp-content/plugins/contact-form-7/js/scripts.js?ver=2.1.0"></script></head></html>`
        );
      })
    );

    const result = await checkWordPress("example.com");
    expect(result.plugins[0].isOutdated).toBe(false);
  });

  it("leaves isOutdated null when the plugin has no visible version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("api.wordpress.org")) {
          return { ok: true, json: async () => ({ version: "3.0.0" }) } as Response;
        }
        return htmlResponse(
          `<html><head><meta name="generator" content="WordPress 6.4"><script src="/wp-content/plugins/contact-form-7/js/scripts.js"></script></head></html>`
        );
      })
    );

    const result = await checkWordPress("example.com");
    expect(result.plugins[0].version).toBeNull();
    expect(result.plugins[0].isOutdated).toBeNull();
  });

  it("dedupes multiple asset references to the same plugin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("api.wordpress.org")) return { ok: true, json: async () => ({ version: "2.1.0" }) } as Response;
        return htmlResponse(
          `<html><head>
            <meta name="generator" content="WordPress 6.4">
            <script src="/wp-content/plugins/contact-form-7/js/scripts.js?ver=2.1.0"></script>
            <link href="/wp-content/plugins/contact-form-7/css/styles.css?ver=2.1.0">
          </head></html>`
        );
      })
    );

    const result = await checkWordPress("example.com");
    expect(result.plugins).toHaveLength(1);
  });

  it("returns not-WordPress instead of throwing when the fetch itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const result = await checkWordPress("example.com");
    expect(result.isWordPress).toBe(false);
  });

  it("gracefully treats a plugin API lookup failure as an unknown latest version rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("api.wordpress.org")) return { ok: false, status: 404 } as Response;
        return htmlResponse(
          `<html><head><meta name="generator" content="WordPress 6.4"><script src="/wp-content/plugins/some-plugin/js/s.js?ver=1.0.0"></script></head></html>`
        );
      })
    );

    const result = await checkWordPress("example.com");
    expect(result.plugins[0].latestVersion).toBeNull();
    expect(result.plugins[0].isOutdated).toBeNull();
  });
});
