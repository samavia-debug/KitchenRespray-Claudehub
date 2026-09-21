import { createServiceClient } from "@/lib/supabase/service";
import { checkWebsiteHealth, checkBrokenLinks } from "./checker";

/** Runs a health probe for one website and persists the result. Service-role write. */
export async function runAndRecordCheck(websiteId: string, domain: string) {
  const result = await checkWebsiteHealth(domain);
  const service = createServiceClient();

  const { data, error } = await service
    .from("website_health_checks")
    .insert({
      website_id: websiteId,
      is_up: result.isUp,
      http_status: result.httpStatus,
      response_time_ms: result.responseTimeMs,
      ssl_valid: result.sslValid,
      ssl_expires_at: result.sslExpiresAt,
      error_message: result.errorMessage,
      likely_blocked: result.likelyBlocked,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to record health check: ${error.message}`);

  return data;
}

/**
 * Runs a homepage broken-link scan for one website and upserts the results.
 * Each link is keyed by (website_id, target_url) so first_detected_at is
 * preserved across runs and re-running only updates last_checked_at / status.
 */
export async function runAndRecordLinkCheck(websiteId: string, domain: string) {
  const results = await checkBrokenLinks(domain);
  const service = createServiceClient();
  const now = new Date().toISOString();

  if (results.length === 0) {
    return [];
  }

  const { data, error } = await service
    .from("website_link_checks")
    .upsert(
      results.map((r) => ({
        website_id: websiteId,
        source_url: r.sourceUrl,
        target_url: r.targetUrl,
        link_type: r.linkType,
        http_status: r.httpStatus,
        is_broken: r.isBroken,
        error_message: r.errorMessage,
        last_checked_at: now,
      })),
      { onConflict: "website_id,target_url", ignoreDuplicates: false }
    )
    .select();

  if (error) throw new Error(`Failed to record link checks: ${error.message}`);

  return data;
}
