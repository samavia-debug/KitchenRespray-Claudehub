import { createServiceClient } from "@/lib/supabase/service";
import { checkWebsiteHealth } from "./checker";

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
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to record health check: ${error.message}`);

  return data;
}
