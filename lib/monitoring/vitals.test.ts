import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCoreWebVitals, rateCls, rateLcp, rateTbt } from "./vitals";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function fakePsiResponse(overrides: Partial<{ score: number; lcp: number; cls: number; tbt: number; hasFieldData: boolean }> = {}) {
  return {
    lighthouseResult: {
      categories: { performance: { score: overrides.score ?? 0.85 } },
      audits: {
        "largest-contentful-paint": { numericValue: overrides.lcp ?? 2000 },
        "cumulative-layout-shift": { numericValue: overrides.cls ?? 0.05 },
        "total-blocking-time": { numericValue: overrides.tbt ?? 100 },
      },
    },
    loadingExperience: overrides.hasFieldData === false ? undefined : { metrics: {} },
  };
}

describe("checkCoreWebVitals", () => {
  it("extracts the performance score (0-100) and core metrics from a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => fakePsiResponse({ score: 0.92, lcp: 1800, cls: 0.03, tbt: 50 }) }) as Response)
    );

    const result = await checkCoreWebVitals("example.com");
    expect(result.performanceScore).toBe(92);
    expect(result.lcpMs).toBe(1800);
    expect(result.cls).toBe(0.03);
    expect(result.tbtMs).toBe(50);
    expect(result.errorMessage).toBeNull();
  });

  it("reports hasFieldData true when loadingExperience.metrics is present", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => fakePsiResponse({ hasFieldData: true }) }) as Response));
    const result = await checkCoreWebVitals("example.com");
    expect(result.hasFieldData).toBe(true);
  });

  it("reports hasFieldData false when the site has no real-user field data (typical for a small site)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => fakePsiResponse({ hasFieldData: false }) }) as Response));
    const result = await checkCoreWebVitals("example.com");
    expect(result.hasFieldData).toBe(false);
  });

  it("works without an API key configured — appends no key param", async () => {
    vi.stubEnv("GOOGLE_PAGESPEED_API_KEY", "");
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => fakePsiResponse() }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await checkCoreWebVitals("example.com");

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.has("key")).toBe(false);
  });

  it("appends the API key when configured", async () => {
    vi.stubEnv("GOOGLE_PAGESPEED_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => fakePsiResponse() }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await checkCoreWebVitals("example.com");

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("key")).toBe("test-key");
  });

  it("returns a clear error message on a non-2xx response instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "Quota exceeded" } }) }) as Response)
    );

    const result = await checkCoreWebVitals("example.com");
    expect(result.errorMessage).toBe("Quota exceeded");
    expect(result.performanceScore).toBeNull();
  });

  it("returns a clear error message instead of throwing when the request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const result = await checkCoreWebVitals("example.com");
    expect(result.errorMessage).toBe("network down");
  });
});

describe("rateLcp", () => {
  it("rates <=2500ms as good", () => expect(rateLcp(2000)).toBe("good"));
  it("rates 2500-4000ms as needs-improvement", () => expect(rateLcp(3000)).toBe("needs-improvement"));
  it("rates >4000ms as poor", () => expect(rateLcp(5000)).toBe("poor"));
  it("returns null for null input", () => expect(rateLcp(null)).toBeNull());
});

describe("rateCls", () => {
  it("rates <=0.1 as good", () => expect(rateCls(0.05)).toBe("good"));
  it("rates 0.1-0.25 as needs-improvement", () => expect(rateCls(0.2)).toBe("needs-improvement"));
  it("rates >0.25 as poor", () => expect(rateCls(0.4)).toBe("poor"));
});

describe("rateTbt", () => {
  it("rates <=200ms as good", () => expect(rateTbt(100)).toBe("good"));
  it("rates 200-600ms as needs-improvement", () => expect(rateTbt(400)).toBe("needs-improvement"));
  it("rates >600ms as poor", () => expect(rateTbt(1000)).toBe("poor"));
});
