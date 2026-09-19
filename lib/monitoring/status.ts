import type { HealthCheck, WebsiteStatus } from "./types";

const CRITICAL_RESPONSE_MS = 5000;
const ATTENTION_RESPONSE_MS = 2000;
const CRITICAL_SSL_DAYS = 7;
const ATTENTION_SSL_DAYS = 30;

export function sslDaysRemaining(sslExpiresAt: string | null): number | null {
  if (!sslExpiresAt) return null;
  const ms = new Date(sslExpiresAt).getTime() - Date.now();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Derives a single status from the latest health check. Deliberately simple
 * and transparent (no hidden scoring) so every status can be explained by
 * pointing at the specific measured value that triggered it.
 */
export function computeWebsiteStatus(latestCheck: HealthCheck | null): WebsiteStatus {
  if (!latestCheck) return "unknown";
  if (!latestCheck.is_up) return "offline";

  const sslDays = sslDaysRemaining(latestCheck.ssl_expires_at);

  if (latestCheck.ssl_valid === false) return "critical";
  if (sslDays !== null && sslDays <= CRITICAL_SSL_DAYS) return "critical";
  if (
    latestCheck.response_time_ms !== null &&
    latestCheck.response_time_ms > CRITICAL_RESPONSE_MS
  )
    return "critical";

  if (sslDays !== null && sslDays <= ATTENTION_SSL_DAYS) return "attention";
  if (
    latestCheck.response_time_ms !== null &&
    latestCheck.response_time_ms > ATTENTION_RESPONSE_MS
  )
    return "attention";

  return "healthy";
}

export const STATUS_LABEL: Record<WebsiteStatus, string> = {
  healthy: "Healthy",
  attention: "Needs attention",
  critical: "Critical",
  offline: "Offline",
  unknown: "Not yet checked",
};

export const STATUS_COLOR: Record<WebsiteStatus, string> = {
  healthy: "#2e7d32",
  attention: "#b98900",
  critical: "#b3261e",
  offline: "#6f6a63",
  unknown: "#9b968e",
};
