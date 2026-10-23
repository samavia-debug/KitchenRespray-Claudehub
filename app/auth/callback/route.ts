import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Where a link in an email may send the person on to. Anything else is ignored, so the link cannot be used to bounce them to another site.
const ALLOWED_NEXT = ["/reset-password"];

/** The page a password-reset email link opens: it swaps the one-off code for a sign-in and sends the person to choose a new password. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requested = searchParams.get("next") ?? "";
  const next = ALLOWED_NEXT.includes(requested) ? requested : "/dashboard";

  if (!code) return NextResponse.redirect(`${origin}/login?error=link`);

  const { error } = await createClient().auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth] could not use a sign-in link:", error.message);
    return NextResponse.redirect(`${origin}/login?error=link`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
