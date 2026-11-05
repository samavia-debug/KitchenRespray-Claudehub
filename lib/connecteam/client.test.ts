import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAllConnecteamUsers, fetchScheduledShifts, isConnecteamConfigured, SHIFT_WINDOW_SECONDS, shiftWindows } from "./client";

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

describe("rota shift windows", () => {
  const DAY = 86_400;

  it("keeps every window under the 92 days Connecteam allows and covers the whole range", () => {
    const start = 1_000_000;
    const end = start + 210 * DAY;
    const windows = shiftWindows(start, end);
    expect(windows[0][0]).toBe(start);
    expect(windows[windows.length - 1][1]).toBe(end);
    for (const [a, b] of windows) expect(b - a).toBeLessThanOrEqual(SHIFT_WINDOW_SECONDS);
    for (let i = 1; i < windows.length; i++) expect(windows[i][0]).toBe(windows[i - 1][1]);
    expect(SHIFT_WINDOW_SECONDS).toBeLessThan(92 * DAY);
  });

  it("uses a single window for a short range", () => {
    expect(shiftWindows(0, 30 * DAY)).toEqual([[0, 30 * DAY]]);
  });

  it("asks once per window and keeps one copy of a shift seen in two windows", async () => {
    process.env.CONNECTEAM_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { shifts: [{ id: "a", startTime: 1, endTime: 2 }] } }) }));
    vi.stubGlobal("fetch", fetchMock);
    const shifts = await fetchScheduledShifts(7, 0, 111 * DAY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(shifts).toHaveLength(1);
    vi.unstubAllGlobals();
    delete process.env.CONNECTEAM_API_KEY;
  });
});
