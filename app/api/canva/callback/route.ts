import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
   export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");

  const codeVerifier = request.cookies.get("canva_code_verifier")?.value;
  const savedState = request.cookies.get("canva_state")?.value;

  if (!code || !returnedState || !codeVerifier || !savedState) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?canva=missing_params", request.url)
    );
  }

  if (returnedState !== savedState) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?canva=state_mismatch", request.url)
    );
  }

  const basicAuth = Buffer.from(
    `${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`
  ).toString("base64");

  const tokenResponse = await fetch(
    "https://api.canva.com/rest/v1/oauth/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
        code: code,
        // Must exactly match what /api/canva/connect sent — derived from
        // the live request's own origin, not hardcoded.
        redirect_uri: `${request.nextUrl.origin}/api/canva/callback`,
      }),
    }
  );

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    return NextResponse.redirect(
      new URL(
        `/dashboard/settings?canva=token_error&msg=${encodeURIComponent(
          tokenData.error_description || tokenData.error || "unknown"
        )}`,
        request.url
      )
    );
  }

  const expiresAt = new Date(
    Date.now() + tokenData.expires_in * 1000
  ).toISOString();

  const supabase = createServiceClient();

  const { error } = await supabase.from("canva_tokens").insert({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: expiresAt,
  });

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/dashboard/settings?canva=save_error&msg=${encodeURIComponent(
          error.message
        )}`,
        request.url
      )
    );
  }

  const response = NextResponse.redirect(
    new URL("/dashboard/settings?canva=connected", request.url)
  );
  response.cookies.delete("canva_code_verifier");
  response.cookies.delete("canva_state");

  return response;
}
