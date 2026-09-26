import { describe, expect, it } from "vitest";
import { getFindings, priorityScore } from "./recommendations";
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

describe("getFindings", () => {
  it("prompts a first check when there is no history", () => {
    const findings = getFindings("unknown", null);
    expect(findings).toHaveLength(1);
    expect(findings[0].recommendedActions[0]).toMatch(/run a manual check/i);
  });

  it("reports a clean site with no recommended actions", () => {
    const findings = getFindings("healthy", check({}));
    expect(findings).toHaveLength(1);
    expect(findings[0].recommendedActions).toEqual([]);
  });

  it("recommends DNS/registration checks when the site is offline", () => {
    const findings = getFindings("offline", check({ is_up: false, http_status: null, error_message: "fetch failed" }));
    expect(findings[0].finding).toMatch(/did not respond/i);
    expect(findings[0].recommendedActions.some((a) => /domain|dns/i.test(a))).toBe(true);
  });

  it("distinguishes a likely WAF block from a real 4xx error", () => {
    const blocked = getFindings("attention", check({ http_status: 403, likely_blocked: true }));
    const real = getFindings("attention", check({ http_status: 403, likely_blocked: false }));

    expect(blocked.some((f) => /waf|bot-protection/i.test(f.finding))).toBe(true);
    expect(real.some((f) => /waf|bot-protection/i.test(f.finding))).toBe(false);
  });

  it("marks near-expiry SSL as urgent only inside the 7-day window", () => {
    const urgent = getFindings(
      "critical",
      check({ ssl_expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString() })
    );
    const routine = getFindings(
      "attention",
      check({ ssl_expires_at: new Date(Date.now() + 20 * 86_400_000).toISOString() })
    );

    expect(urgent[0].recommendedActions.some((a) => /immediately/i.test(a))).toBe(true);
    expect(routine[0].recommendedActions.some((a) => /immediately/i.test(a))).toBe(false);
  });

  it("flags a 5xx as a server-side failure distinct from a slow response", () => {
    const findings = getFindings("critical", check({ http_status: 503, response_time_ms: 300 }));
    expect(findings.some((f) => /http 503/i.test(f.finding))).toBe(true);
  });

  it("surfaces a critical security finding even when every uptime check passes (the respraymykitchen.ie case)", () => {
    const findings = getFindings("critical", check({}), {
      riskLevel: "critical",
      finalUrl: "https://kitchensavages.com/",
      flaggedKeywords: ["slot gacor"],
    });

    expect(findings.some((f) => /hijacked|redirects/i.test(f.finding))).toBe(true);
    // The bug this guards against: with security ignored, a clean uptime
    // check falls through to "All checks passing", directly contradicting
    // a status badge that says critical.
    expect(findings.some((f) => /all checks passing/i.test(f.finding))).toBe(false);
  });

  it("surfaces a suspicious security finding without treating it as critical", () => {
    const findings = getFindings("attention", check({}), {
      riskLevel: "suspicious",
      finalUrl: null,
      flaggedKeywords: ["hacked by"],
    });

    expect(findings.some((f) => /hacked by/i.test(f.finding))).toBe(true);
  });

  it("ignores a clean security scan and reports the usual all-clear", () => {
    const findings = getFindings("healthy", check({}), { riskLevel: "none", finalUrl: null, flaggedKeywords: [] });
    expect(findings.some((f) => /all checks passing/i.test(f.finding))).toBe(true);
  });
});

describe("priorityScore", () => {
  it("ranks a critical issue on a critical-priority site above the same issue on a low-priority site", () => {
    expect(priorityScore("critical", "critical")).toBeGreaterThan(priorityScore("low", "critical"));
  });

  it("ranks status severity above site priority — offline beats a healthy critical-priority site", () => {
    expect(priorityScore("low", "offline")).toBeGreaterThan(priorityScore("critical", "healthy"));
  });

  it("is zero for a healthy, low-priority site", () => {
    expect(priorityScore("low", "healthy")).toBe(0);
  });
});
