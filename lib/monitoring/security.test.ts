import { afterEach, describe, expect, it, vi } from "vitest";
import { checkWebsiteSecurity } from "./security";

function mockResponse(url: string, text: string) {
  return { url, text: async () => text } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkWebsiteSecurity", () => {
  it("reports no risk for a clean site that stays on its own domain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse("https://kitchenrespray.com/", "<html><body>Kitchen respray services</body></html>"))
    );

    const result = await checkWebsiteSecurity("kitchenrespray.com");

    expect(result.riskLevel).toBe("none");
    expect(result.domainMismatch).toBe(false);
    expect(result.flaggedKeywords).toEqual([]);
  });

  it("flags critical when the homepage redirects to an unrelated domain (the respraymykitchen.ie pattern)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse("https://kitchensavages.com/", "<html><body>MIMISLOT slot gacor hari ini</body></html>"))
    );

    const result = await checkWebsiteSecurity("respraymykitchen.ie");

    expect(result.riskLevel).toBe("critical");
    expect(result.domainMismatch).toBe(true);
    expect(result.flaggedKeywords).toContain("slot gacor");
  });

  it("does not flag a same-site www redirect as a mismatch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse("https://www.kitchenrespray.com/", "<html><body>Welcome</body></html>")));

    const result = await checkWebsiteSecurity("kitchenrespray.com");

    expect(result.domainMismatch).toBe(false);
    expect(result.riskLevel).toBe("none");
  });

  it("flags suspicious (not critical) when keywords appear without a domain change", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockResponse("https://kitchenrespray.com/", "<html><body>hacked by anonymous</body></html>"))
    );

    const result = await checkWebsiteSecurity("kitchenrespray.com");

    expect(result.riskLevel).toBe("suspicious");
    expect(result.domainMismatch).toBe(false);
    expect(result.flaggedKeywords).toContain("hacked by");
  });

  it("returns a clean error result instead of throwing when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await checkWebsiteSecurity("unreachable-site.com");

    expect(result.errorMessage).toBe("network down");
    expect(result.riskLevel).toBe("none");
  });
});
