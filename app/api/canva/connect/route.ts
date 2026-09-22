import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function base64url(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export async function GET(request: NextRequest) {
  const codeVerifier = base64url(crypto.randomBytes(64));
  const codeChallenge = base64url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );
  const state = base64url(crypto.randomBytes(16));

  const scope = [
    "design:content:read",
    "design:content:write",
    "design:meta:read",
    "asset:read",
    "asset:write",
    "folder:read",
    "folder:write",
  ].join(" ");

  const authUrl = new URL("https://www.canva.com/api/oauth/authorize");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "s256");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", process.env.CANVA_CLIENT_ID!);
  // Derived from the live request's own origin — was previously hardcoded
  // to a Vercel URL that broke when the app moved to Netlify.
  authUrl.searchParams.set("redirect_uri", `${request.nextUrl.origin}/api/canva/callback`);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl.toString());

  response.cookies.set("canva_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: true,
    maxAge: 600,
    path: "/",
  });
  response.cookies.set("canva_state", state, {
    httpOnly: true,
    secure: true,
    maxAge: 600,
    path: "/",
  });

  return response;
}
