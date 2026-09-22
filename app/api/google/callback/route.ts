import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { exchangeCodeForTokens, decodeEmailFromIdToken, computeExpiresAt, type GoogleService } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");

  const savedState = request.cookies.get("google_oauth_state")?.value;
  const websiteId = request.cookies.get("google_oauth_website_id")?.value;
  const service = request.cookies.get("google_oauth_service")?.value as GoogleService | undefined;

  const redirectTo = (status: string, msg?: string) => {
    const url = new URL(websiteId ? `/dashboard/monitoring/${websiteId}` : "/dashboard/monitoring", request.url);
    url.searchParams.set("google", status);
    if (msg) url.searchParams.set("msg", msg);
    const res = NextResponse.redirect(url);
    res.cookies.delete("google_oauth_state");
    res.cookies.delete("google_oauth_website_id");
    res.cookies.delete("google_oauth_service");
    return res;
  };

  if (oauthError) return redirectTo("denied", oauthError);
  if (!code || !returnedState || !savedState || !websiteId || !service) {
    return redirectTo("missing_params");
  }
  if (returnedState !== savedState) {
    return redirectTo("state_mismatch");
  }

  try {
    const redirectUri = `${request.nextUrl.origin}/api/google/callback`;
    const tokenData = await exchangeCodeForTokens(code, redirectUri);
    const email = decodeEmailFromIdToken(tokenData.id_token);

    const supabase = createServiceClient();

    // prompt=consent should always yield a refresh_token, but if Google
    // ever omits it on a re-connect, keep the existing one rather than
    // overwrite it with null (which would break future silent refreshes).
    let refreshToken = tokenData.refresh_token;
    if (!refreshToken) {
      const { data: existing } = await supabase
        .from("google_connections")
        .select("refresh_token")
        .eq("website_id", websiteId)
        .eq("service", service)
        .maybeSingle();
      refreshToken = existing?.refresh_token;
    }

    if (!refreshToken) {
      return redirectTo("token_error", "Google did not return a refresh token");
    }

    const { error } = await supabase.from("google_connections").upsert(
      {
        website_id: websiteId,
        service,
        external_account_email: email,
        access_token: tokenData.access_token,
        refresh_token: refreshToken,
        token_expires_at: computeExpiresAt(tokenData.expires_in),
        connected_at: new Date().toISOString(),
      },
      { onConflict: "website_id,service" }
    );

    if (error) return redirectTo("save_error", error.message);

    return redirectTo("connected");
  } catch (err: any) {
    return redirectTo("token_error", err?.message || "unknown");
  }
}
