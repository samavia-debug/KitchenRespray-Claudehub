import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAllConnecteamUsers, isConnecteamConfigured } from "./client";

const users = (n: number, start = 0) => Array.from({ length: n }, (_, i) => ({ userId: start + i }));
const okResponse = (list: unknown[]) => ({ ok: true, status: 200, json: async () => ({ data: { users: list } }) });

describe("Connecteam client", () => {
  beforeEach(() => {
    process.env.CONNECTEAM_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CONNECTEAM_API_KEY;
  });

  it("reports whether a key is configured", () => {
    expect(isConnecteamConfigured()).toBe(true);
    delete process.env.CONNECTEAM_API_KEY;
    expect(isConnecteamConfigured()).toBe(false);
  });

  it("asks for current and archived users together, sending the key as X-API-KEY", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(users(3)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAllConnecteamUsers();

    expect(result).toHaveLength(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("userStatus=all");
    expect(init.headers["X-API-KEY"]).toBe("test-key");
  });

  it("keeps paging until a short page comes back", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(users(500)))
      .mockResolvedValueOnce(okResponse(users(120, 500)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAllConnecteamUsers();

    expect(result).toHaveLength(620);
    expect(fetchMock.mock.calls[1][0]).toContain("offset=500");
  });

  it("throws without leaking the key when Connecteam rejects it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));
    await expect(fetchAllConnecteamUsers()).rejects.toThrow(/403/);
    await expect(fetchAllConnecteamUsers()).rejects.not.toThrow(/test-key/);
  });

  it("refuses to run with no key", async () => {
    delete process.env.CONNECTEAM_API_KEY;
    await expect(fetchAllConnecteamUsers()).rejects.toThrow(/CONNECTEAM_API_KEY/);
  });
});
