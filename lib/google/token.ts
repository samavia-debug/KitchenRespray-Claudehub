import { createServiceClient } from "@/lib/supabase/service";
import { refreshAccessToken, computeExpiresAt, isTokenExpired, type GoogleService } from "./oauth";

/**
 * Returns a valid access token for one site's Google connection, refreshing
 * it first if it's expired (or about to be). Not called anywhere yet — this
 * is the piece a future metrics-sync job (GA4 Data API / Search Console
 * API calls) will use once that job exists; kept here now so the OAuth
 * architecture is complete rather than half-built.
 */
export async function getValidGoogleAccessToken(websiteId: string, service: GoogleService): Promise<string> {
  const supabase = createServiceClient();

  const { data: connection, error } = await supabase
    .from("google_connections")
    .select("*")
    .eq("website_id", websiteId)
    .eq("service", service)
    .single();

  if (error || !connection) {
    throw new Error(`No ${service} connection found for this website. Connect it first.`);
  }

  if (!isTokenExpired(connection.token_expires_at)) {
    return connection.access_token;
  }

  const refreshed = await refreshAccessToken(connection.refresh_token);

  await supabase
    .from("google_connections")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || connection.refresh_token,
      token_expires_at: computeExpiresAt(refreshed.expires_in),
    })
    .eq("id", connection.id);

  return refreshed.access_token;
}
