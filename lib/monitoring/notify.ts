import type { IncidentSeverity } from "./types";

/**
 * Slack only for now (per the team's choice) — kept as its own module with
 * pure message-formatting functions so Email/Teams can be added later
 * without touching the formatting logic or the incident-sync call site.
 *
 * Scope: immediate notification on incident open/resolve only (critical +
 * offline — the "needs action now" tier). A daily digest for attention-
 * level findings is a deliberately separate, later addition — bundling it
 * in here now would mean guessing at a digest schedule/format nobody asked
 * for yet.
 */

function severityEmoji(severity: IncidentSeverity): string {
  return severity === "offline" ? "🔴" : "🟠";
}

export function formatIncidentOpenedMessage(siteName: string, domain: string, severity: IncidentSeverity): string {
  return `${severityEmoji(severity)} *${siteName}* (${domain}) is now *${severity}* — needs attention.`;
}

export function formatIncidentResolvedMessage(siteName: string, domain: string, duration: string): string {
  return `✅ *${siteName}* (${domain}) recovered — was down for ${duration}.`;
}

/**
 * Posts to the configured Slack Incoming Webhook. A no-op (not an error)
 * when SLACK_WEBHOOK_URL isn't set — notifications are opt-in, and a health
 * check should never fail just because notifications aren't configured
 * yet. Failures are logged, never thrown, for the same reason.
 */
export async function notifySlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`Slack notification failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error("Failed to send Slack notification:", err);
  }
}
