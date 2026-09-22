import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  computeExpiresAt,
  decodeEmailFromIdToken,
  isGoogleOAuthConfigured,
  isTokenExpired,
} from "./oauth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isGoogleOAuthConfigured", () => {
  it("is false when the client id/secret are not set", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(isGoogleOAuthConfigured()).toBe(false);
  });

  it("is true when both are set", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
    expect(isGoogleOAuthConfigured()).toBe(true);
  });

  it("is false when only one of the two is set", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(isGoogleOAuthConfigured()).toBe(false);
  });
});

describe("buildAuthorizeUrl", () => {
  it("requests offline access and forces consent so a refresh_token is always issued", () => {
    const url = new URL(buildAuthorizeUrl({ service: "analytics", redirectUri: "https://example.com/cb", state: "abc" }));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("uses the analytics.readonly scope for the analytics service", () => {
    const url = new URL(buildAuthorizeUrl({ service: "analytics", redirectUri: "https://example.com/cb", state: "abc" }));
    expect(url.searchParams.get("scope")).toContain("analytics.readonly");
  });

  it("uses the webmasters.readonly scope for the search_console service", () => {
    const url = new URL(buildAuthorizeUrl({ service: "search_console", redirectUri: "https://example.com/cb", state: "abc" }));
    expect(url.searchParams.get("scope")).toContain("webmasters.readonly");
  });

  it("passes the redirect URI through unchanged, not hardcoded", () => {
    const url = new URL(
      buildAuthorizeUrl({ service: "analytics", redirectUri: "https://kitchenrespray.netlify.app/api/google/callback", state: "abc" })
    );
    expect(url.searchParams.get("redirect_uri")).toBe("https://kitchenrespray.netlify.app/api/google/callback");
  });

  it("carries the state through for CSRF protection", () => {
    const url = new URL(buildAuthorizeUrl({ service: "analytics", redirectUri: "https://example.com/cb", state: "unique-state-value" }));
    expect(url.searchParams.get("state")).toBe("unique-state-value");
  });
});

describe("computeExpiresAt / isTokenExpired", () => {
  it("computes an ISO timestamp expiresInSeconds in the future", () => {
    const iso = computeExpiresAt(3600);
    const diffMs = new Date(iso).getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(3500 * 1000);
    expect(diffMs).toBeLessThanOrEqual(3600 * 1000);
  });

  it("treats a token expiring in the past as expired", () => {
    expect(isTokenExpired(new Date(Date.now() - 1000).toISOString())) .toBe(true);
  });

  it("treats a token expiring within the 60s safety margin as expired", () => {
    expect(isTokenExpired(new Date(Date.now() + 30_000).toISOString())).toBe(true);
  });

  it("treats a token expiring well in the future as not expired", () => {
    expect(isTokenExpired(new Date(Date.now() + 3600_000).toISOString())).toBe(false);
  });
});

describe("decodeEmailFromIdToken", () => {
  function fakeIdToken(payload: object): string {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64");
    return `${header}.${body}.fakesignature`;
  }

  it("extracts the email from a well-formed id_token payload", () => {
    const token = fakeIdToken({ email: "philip@kitchenrespray.com", sub: "123" });
    expect(decodeEmailFromIdToken(token)).toBe("philip@kitchenrespray.com");
  });

  it("returns null when there is no id_token", () => {
    expect(decodeEmailFromIdToken(undefined)).toBeNull();
  });

  it("returns null instead of throwing on a malformed token", () => {
    expect(decodeEmailFromIdToken("not-a-real-jwt")).toBeNull();
  });

  it("returns null when the payload has no email field", () => {
    const token = fakeIdToken({ sub: "123" });
    expect(decodeEmailFromIdToken(token)).toBeNull();
  });
});
