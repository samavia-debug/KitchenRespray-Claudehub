export type GoogleService = "analytics" | "search_console";

const SCOPES: Record<GoogleService, string> = {
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  search_console: "https://www.googleapis.com/auth/webmasters.readonly",
};

export function isGoogleOAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Builds the Google consent-screen URL for one site's GA4-or-Search-Console
 * connection. `redirectUri` is passed in (derived from the live request's
 * own origin by the caller) rather than hardcoded, so this keeps working
 * across hosting moves — unlike the existing Canva integration, whose
 * redirect_uri is hardcoded to a Vercel URL that's now stale since the move
 * to Netlify (a pre-existing issue, not fixed here — separate from this
 * work, flagged in ARCHITECTURE.md).
 */
export function buildAuthorizeUrl(params: { service: GoogleService; redirectUri: string; state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", `openid email ${SCOPES[params.service]}`);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  return url.toString();
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
};

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: redirectUri,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "Google token exchange failed");
  }
  return data;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "Google token refresh failed");
  }
  return data;
}

/** Decodes the email out of a Google ID token's payload — no signature verification (not a trust boundary; only used for display, e.g. "connected as x@gmail.com"). */
export function decodeEmailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return typeof decoded.email === "string" ? decoded.email : null;
  } catch {
    return null;
  }
}

export function computeExpiresAt(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

export function isTokenExpired(expiresAtIso: string): boolean {
  return Date.now() >= new Date(expiresAtIso).getTime() - 60_000;
}
