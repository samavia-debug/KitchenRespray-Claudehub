import { sslDaysRemaining } from "./status";
import type { HealthCheck, WebsiteStatus } from "./types";

/** Human-readable explanation of why a website has the status it has. */
export function describeStatus(status: WebsiteStatus, check: HealthCheck | null): string {
  if (!check) return "No successful check yet.";
  if (status === "offline") {
    return check.error_message
      ? `Unreachable: ${check.error_message}`
      : `Server returned HTTP ${check.http_status ?? "error"}.`;
  }

  const sslDays = sslDaysRemaining(check.ssl_expires_at);

  if (check.likely_blocked)
    return `HTTP ${check.http_status} looks like a WAF/bot-protection block, not a confirmed site error.`;
  if (check.ssl_valid === false) return "SSL certificate is invalid.";
  if (sslDays !== null && sslDays <= 7) return `SSL certificate expires in ${sslDays} day(s).`;
  if (check.response_time_ms !== null && check.response_time_ms > 5000)
    return `Response time is ${check.response_time_ms}ms (critically slow).`;
  if (sslDays !== null && sslDays <= 30) return `SSL certificate expires in ${sslDays} day(s).`;
  if (check.response_time_ms !== null && check.response_time_ms > 2000)
    return `Response time is ${check.response_time_ms}ms (slower than usual).`;

  return "All checks passing.";
}
