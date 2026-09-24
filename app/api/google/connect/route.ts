import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { buildAuthorizeUrl, isGoogleOAuthConfigured, type GoogleService } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

const VALID_SERVICES: GoogleService[] = ["analytics", "search_console"];

/**
 * Starts the OAuth flow for one site's GA4 or Search Console connection.
 * The redirect_uri is derived from the incoming request's own origin
 * rather than hardcoded — see the comment on buildAuthorizeUrl for why
 * that matters (the existing Canva integration hardcodes a now-stale
 * Vercel URL after the move to Netlify).
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(["Admin", "Manager"]);
  if ("error" in auth) return auth.error;

  const websiteId = request.nextUrl.searchParams.get("websiteId");
  const service = request.nextUrl.searchParams.get("service") as GoogleService | null;

  if (!websiteId || !service || !VALID_SERVICES.includes(service)) {
    return NextResponse.json({ error: "Missing or invalid websiteId/service" }, { status: 400 });
  }

  if (!isGoogleOAuthConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth isn't configured yet — GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not set." },
      { status: 501 }
    );
  }

  const redirectUri = `${request.nextUrl.origin}/api/google/callback`;
  const state = crypto.randomBytes(16).toString("hex");
  const authUrl = buildAuthorizeUrl({ service, redirectUri, state });

  const response = NextResponse.redirect(authUrl);
  // 30 minutes, not 10 — the same missing_params failure mode hit on the
  // Canva connect flow (a first-time OAuth grant often runs long, e.g.
  // clicking through Google's "unverified app" warning screen) applies
  // here too.
  const cookieOpts = { httpOnly: true, secure: true, sameSite: "lax", maxAge: 1800, path: "/" } as const;
  response.cookies.set("google_oauth_state", state, cookieOpts);
  response.cookies.set("google_oauth_website_id", websiteId, cookieOpts);
  response.cookies.set("google_oauth_service", service, cookieOpts);

  return response;
}
