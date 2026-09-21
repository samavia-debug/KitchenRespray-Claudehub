import { describe, expect, it } from "vitest";
import { computeWebsiteStatus, sslDaysRemaining } from "./status";
import type { HealthCheck } from "./types";

function check(overrides: Partial<HealthCheck>): HealthCheck {
  return {
    id: "1",
    website_id: "w1",
    checked_at: new Date().toISOString(),
    is_up: true,
    http_status: 200,
    response_time_ms: 400,
    ssl_valid: true,
    ssl_expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    error_message: null,
    likely_blocked: false,
    ...overrides,
  };
}

describe("computeWebsiteStatus", () => {
  it("is unknown when there is no check yet", () => {
    expect(computeWebsiteStatus(null)).toBe("unknown");
  });

  it("is offline when the site did not respond", () => {
    expect(computeWebsiteStatus(check({ is_up: false }))).toBe("offline");
  });

  it("is healthy for a fast response with a long-lived certificate", () => {
    expect(computeWebsiteStatus(check({}))).toBe("healthy");
  });

  it("is critical when the SSL certificate is invalid", () => {
    expect(computeWebsiteStatus(check({ ssl_valid: false }))).toBe("critical");
  });

  it("is critical when SSL expires within 7 days", () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect(computeWebsiteStatus(check({ ssl_expires_at: soon }))).toBe("critical");
  });

  it("is critical when response time exceeds 5s", () => {
    expect(computeWebsiteStatus(check({ response_time_ms: 6000 }))).toBe("critical");
  });

  it("is attention when SSL expires within 30 days but more than 7", () => {
    const soon = new Date(Date.now() + 20 * 86_400_000).toISOString();
    expect(computeWebsiteStatus(check({ ssl_expires_at: soon }))).toBe("attention");
  });

  it("is attention when response time is between 2s and 5s", () => {
    expect(computeWebsiteStatus(check({ response_time_ms: 3000 }))).toBe("attention");
  });
});

describe("sslDaysRemaining", () => {
  it("returns null when there is no expiry date", () => {
    expect(sslDaysRemaining(null)).toBeNull();
  });

  it("returns the number of whole days remaining", () => {
    // A day-boundary target computed slightly before sslDaysRemaining's own
    // Date.now() call can floor down by one — allow that instead of
    // asserting an exact value that depends on sub-millisecond timing.
    const iso = new Date(Date.now() + 10 * 86_400_000).toISOString();
    expect(sslDaysRemaining(iso)).toBeGreaterThanOrEqual(9);
    expect(sslDaysRemaining(iso)).toBeLessThanOrEqual(10);
  });

  it("returns a negative number for an already-expired certificate", () => {
    const iso = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(sslDaysRemaining(iso)).toBeLessThan(0);
  });
});
