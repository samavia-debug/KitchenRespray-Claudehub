import { sslDaysRemaining } from "./status";
import type { HealthCheck, WebsitePriority, WebsiteStatus } from "./types";

export type Finding = {
  /** Short, specific statement of what was actually measured. */
  finding: string;
  /** What to do about it, in order of what to try first. */
  recommendedActions: string[];
};

/**
 * Deterministic, rule-based findings + recommended actions from the actual
 * measured values on a health check — no AI, no guessing at causes that
 * weren't measured. This is intentionally the same kind of transparent
 * thresholding as `status.ts`: every recommendation traces back to a
 * specific field on `check`, phrased as "this measurement suggests trying
 * X" rather than a confirmed diagnosis.
 */
export function getFindings(status: WebsiteStatus, check: HealthCheck | null): Finding[] {
  if (!check) {
    return [
      {
        finding: "No successful check has been recorded yet for this site.",
        recommendedActions: ["Run a manual check now to establish a baseline."],
      },
    ];
  }

  const findings: Finding[] = [];
  const sslDays = sslDaysRemaining(check.ssl_expires_at);

  if (!check.is_up) {
    findings.push({
      finding: check.error_message
        ? `Site did not respond: ${check.error_message}.`
        : `Site did not respond (HTTP ${check.http_status ?? "no response"}).`,
      recommendedActions: [
        "Confirm the domain is still registered and hasn't expired.",
        "Check DNS records resolve to the expected host (A/AAAA/CNAME).",
        "If DNS resolves, check hosting provider status and server logs for a crash or resource exhaustion.",
      ],
    });
  }

  if (check.http_status !== null && check.http_status >= 500) {
    findings.push({
      finding: `Server returned HTTP ${check.http_status} — the origin itself is failing, not just slow.`,
      recommendedActions: [
        "Check the hosting/server error logs for the timestamp of this check.",
        "Check recent deployments or plugin/theme updates around the same time.",
        "Contact the hosting provider if the server itself appears down or overloaded.",
      ],
    });
  }

  if (check.likely_blocked) {
    findings.push({
      finding: `HTTP ${check.http_status} response has the signature of a WAF/bot-protection block (e.g. Cloudflare, Sucuri) rather than a real site error.`,
      recommendedActions: [
        "Verify the site loads normally in a real browser before treating this as an outage.",
        "Allow-list the monitor's requests in the site's WAF/firewall/security-plugin rules.",
        "If real visitors are also seeing this, the bot-protection rule is too aggressive and needs loosening.",
      ],
    });
  } else if (check.http_status !== null && check.http_status >= 400 && check.http_status < 500) {
    findings.push({
      finding: `Server returned HTTP ${check.http_status}.`,
      recommendedActions: [
        "Load the homepage directly to confirm whether real visitors see the same error.",
        "Check for a recent redirect, permissions, or access-rule change on the server.",
      ],
    });
  }

  if (check.ssl_valid === false) {
    findings.push({
      finding: "SSL certificate is invalid (failed validation).",
      recommendedActions: [
        "Check the certificate chain is complete and matches the domain.",
        "Reissue/renew the certificate through the host or certificate authority.",
      ],
    });
  } else if (sslDays !== null && sslDays <= 30) {
    findings.push({
      finding:
        sslDays <= 0
          ? "SSL certificate has expired."
          : `SSL certificate expires in ${sslDays} day(s).`,
      recommendedActions:
        sslDays <= 7
          ? [
              "Renew the certificate immediately — this is urgent.",
              "Check auto-renewal is configured correctly if using Let's Encrypt/host-managed SSL.",
            ]
          : ["Schedule a certificate renewal before it expires.", "Verify auto-renewal is enabled for this domain."],
    });
  }

  if (check.response_time_ms !== null && check.response_time_ms > 2000) {
    const critical = check.response_time_ms > 5000;
    findings.push({
      finding: `Response time is ${check.response_time_ms}ms (${critical ? "critically slow" : "slower than the 2s threshold"}).`,
      recommendedActions: [
        "Compare against this site's usual baseline — a one-off spike may just be a transient load blip.",
        "Check hosting resource usage (CPU/memory) and enable caching if not already active.",
        "Run a page-speed audit to find the specific slow resource.",
      ],
    });
  }

  if (findings.length === 0) {
    findings.push({
      finding: "All checks passing — fast response, valid SSL well within expiry.",
      recommendedActions: [],
    });
  }

  return findings;
}

const STATUS_SEVERITY: Record<WebsiteStatus, number> = {
  offline: 4,
  critical: 3,
  attention: 2,
  unknown: 1,
  healthy: 0,
};

const PRIORITY_WEIGHT: Record<WebsitePriority, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

/**
 * Ranks "needs action now" — combines how bad the finding is with how much
 * the business has said this site matters, so a critical issue on a
 * priority site always outranks the same issue on a low-priority one.
 */
export function priorityScore(priority: WebsitePriority, status: WebsiteStatus): number {
  return STATUS_SEVERITY[status] * 10 + PRIORITY_WEIGHT[priority];
}
