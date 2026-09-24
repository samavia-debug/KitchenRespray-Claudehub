import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { domainCore, listGa4Properties, listSearchConsoleSites } from "@/lib/google/discovery";
import { getValidGoogleAccessToken } from "@/lib/google/token";
import type { GoogleService } from "@/lib/google/oauth";

/**
 * One Google account's OAuth grant covers every GA4 property / Search
 * Console site that account has access to — it isn't scoped to a single
 * website. So instead of making the team click "Connect" 26 separate
 * times (once per site, per service), this takes ONE already-connected
 * website+service, reuses its token to discover every property/site the
 * account can see, matches each to a monitored website by domain, and
 * upserts a google_connections row for every match — reusing the same
 * token pair rather than requiring 52 separate OAuth grants.
 */
export async function POST() {
  const auth = await requireRole(["Admin", "Manager"]);
  if ("error" in auth) return auth.error;

  const supabase = createServiceClient();

  const { data: websites, error: websitesError } = await supabase
    .from("websites")
    .select("id, domain");

  if (websitesError) {
    return NextResponse.json({ error: websitesError.message }, { status: 500 });
  }

  const results: Record<string, { matched: number; total: number; error?: string }> = {};

  for (const service of ["analytics", "search_console"] as GoogleService[]) {
    const { data: sourceConnection } = await supabase
      .from("google_connections")
      .select("website_id, external_account_email")
      .eq("service", service)
      .limit(1)
      .maybeSingle();

    if (!sourceConnection) {
      results[service] = { matched: 0, total: websites?.length || 0, error: "No existing connection to source a token from — connect one site first." };
      continue;
    }

    try {
      const accessToken = await getValidGoogleAccessToken(sourceConnection.website_id, service);
      const { data: sourceRow } = await supabase
        .from("google_connections")
        .select("access_token, refresh_token, token_expires_at, external_account_email")
        .eq("website_id", sourceConnection.website_id)
        .eq("service", service)
        .single();

      let matched = 0;

      if (service === "analytics") {
        const properties = await listGa4Properties(accessToken);
        const byCore = new Map(properties.map((p) => [domainCore(p.displayName), p]));

        const rows = (websites || [])
          .map((w) => {
            const property = byCore.get(domainCore(w.domain));
            if (!property) return null;
            return {
              website_id: w.id,
              service: "analytics" as const,
              external_account_email: sourceRow!.external_account_email,
              property_id: property.property,
              access_token: sourceRow!.access_token,
              refresh_token: sourceRow!.refresh_token,
              token_expires_at: sourceRow!.token_expires_at,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (rows.length) {
          const { error: upsertError } = await supabase
            .from("google_connections")
            .upsert(rows, { onConflict: "website_id,service" });
          if (upsertError) throw new Error(upsertError.message);
        }
        matched = rows.length;
      } else {
        const sites = await listSearchConsoleSites(accessToken);
        const byCore = new Map(sites.map((s) => [domainCore(s.siteUrl), s]));

        const rows = (websites || [])
          .map((w) => {
            const site = byCore.get(domainCore(w.domain));
            if (!site) return null;
            return {
              website_id: w.id,
              service: "search_console" as const,
              external_account_email: sourceRow!.external_account_email,
              site_url: site.siteUrl,
              access_token: sourceRow!.access_token,
              refresh_token: sourceRow!.refresh_token,
              token_expires_at: sourceRow!.token_expires_at,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (rows.length) {
          const { error: upsertError } = await supabase
            .from("google_connections")
            .upsert(rows, { onConflict: "website_id,service" });
          if (upsertError) throw new Error(upsertError.message);
        }
        matched = rows.length;
      }

      results[service] = { matched, total: websites?.length || 0 };
    } catch (err: any) {
      results[service] = { matched: 0, total: websites?.length || 0, error: err.message };
    }
  }

  return NextResponse.json({ success: true, results });
}
