import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runBookingsSync = vi.fn();
vi.mock("./service", () => ({ runBookingsSync: (...args: unknown[]) => runBookingsSync(...args) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

import { isCronAuthorized } from "@/lib/auth/cron";
import { handleBookingsCron } from "./cron";

const req = (auth?: string) => new Request("https://example.com/api/bookings/cron", { headers: auth ? { authorization: auth } : {} });

const ENV: Record<string, string> = {
  CRON_SECRET: "s3cret-value",
  MS_GRAPH_TENANT_ID: "t",
  MS_GRAPH_CLIENT_ID: "c",
  MS_GRAPH_CLIENT_SECRET: "x",
  MS_BOOKINGS_BUSINESS_ID: "b@example.com",
  CONNECTEAM_API_KEY: "k",
  BOOKINGS_TO_CONNECTEAM_ENABLED: "true",
};

function setEnv(over: Record<string, string | undefined> = {}) {
  for (const k of Object.keys(ENV)) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENV, ...over })) if (v !== undefined) process.env[k] = v;
}

beforeEach(() => {
  runBookingsSync.mockReset();
  setEnv();
});
afterEach(() => setEnv({ CRON_SECRET: undefined }));

describe("cron authorisation", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isCronAuthorized(req("Bearer s3cret-value"))).toBe(true);
    expect(isCronAuthorized(req("Bearer s3cret-valuf"))).toBe(false);
    expect(isCronAuthorized(req("s3cret-value"))).toBe(false);
    expect(isCronAuthorized(req())).toBe(false);
  });

  it("lets nobody in when no secret is configured", () => {
    setEnv({ CRON_SECRET: undefined });
    expect(isCronAuthorized(req("Bearer undefined"))).toBe(false);
    expect(isCronAuthorized(req("Bearer "))).toBe(false);
    expect(isCronAuthorized(req())).toBe(false);
  });
});

describe("the quick appointment tick", () => {
  it("turns away a caller without the secret, without running anything", async () => {
    expect((await handleBookingsCron(req())).status).toBe(401);
    expect((await handleBookingsCron(req("Bearer wrong"))).status).toBe(401);
    expect(runBookingsSync).not.toHaveBeenCalled();
  });

  it("does nothing until Microsoft is connected and writing is switched on", async () => {
    for (const over of [{ MS_GRAPH_CLIENT_SECRET: undefined }, { BOOKINGS_TO_CONNECTEAM_ENABLED: undefined }, { CONNECTEAM_API_KEY: undefined }]) {
      setEnv(over);
      const r = await handleBookingsCron(req("Bearer s3cret-value"));
      expect(r).toEqual({ status: 200, body: { skipped: "not switched on" } });
    }
    expect(runBookingsSync).not.toHaveBeenCalled();
  });

  it("copies for real and reports only counts", async () => {
    runBookingsSync.mockResolvedValue({
      state: "applied",
      writeEnabled: true,
      counts: { create: 1, update: 0, remove: 0, unchanged: 3, done: 1 },
      items: [{ action: "create", service: "Kylemore", startSec: 1, firstName: "Mary" }],
      held: [],
      errors: [],
      skippedAppointments: 0,
    });
    const r = await handleBookingsCron(req("Bearer s3cret-value"));
    expect(runBookingsSync).toHaveBeenCalledWith({ apply: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ state: "applied", counts: { create: 1, done: 1 } });
    expect(JSON.stringify(r.body)).not.toMatch(/Mary|Kylemore/); // nothing about a customer comes back
  });

  it("shows a failure as an error status so the scheduler flags it", async () => {
    runBookingsSync.mockResolvedValue({ state: "applied", counts: {}, held: [], errors: ["Create failed: nope"], skippedAppointments: 0 });
    expect((await handleBookingsCron(req("Bearer s3cret-value"))).status).toBe(500);

    runBookingsSync.mockResolvedValue({ state: "error", message: "Microsoft sign-in failed", held: [], errors: [], skippedAppointments: 0 });
    const r = await handleBookingsCron(req("Bearer s3cret-value"));
    expect(r.status).toBe(500);
    expect(r.body.message).toBe("Microsoft sign-in failed");

    runBookingsSync.mockRejectedValue(new Error("boom"));
    expect(await handleBookingsCron(req("Bearer s3cret-value"))).toEqual({ status: 500, body: { error: "boom" } });
  });

  it("treats 'a copy is already running' as fine, not as a failure", async () => {
    runBookingsSync.mockResolvedValue({ state: "busy", message: "A copy is already running.", held: [], errors: [], skippedAppointments: 0 });
    const r = await handleBookingsCron(req("Bearer s3cret-value"));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ state: "busy" });
  });
});
