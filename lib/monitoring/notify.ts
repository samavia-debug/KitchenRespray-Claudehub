import type { IncidentSeverity } from "./types";

/**
 * Slack + WhatsApp for now — kept as its own module with pure message-
 * formatting functions so Email/Teams can be added later without touching
 * the formatting logic or the incident-sync call site. Slack and WhatsApp
 * both use the same `*bold*` markdown, so one formatter serves both — no
 * need for platform-specific message variants.
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

/**
 * Sends a WhatsApp message via the Twilio WhatsApp API to every number in
 * TWILIO_WHATSAPP_TO (comma-separated — supports alerting more than one
 * person). A no-op when any of the 4 required env vars is missing, same
 * reasoning as notifySlack: notifications are opt-in, never block a health
 * check from being recorded. Works with Twilio's free Sandbox number
 * (fast to set up, requires each recipient to opt in once by texting the
 * sandbox's join code) or a fully-approved WhatsApp Business sender —
 * same API either way, just a different TWILIO_WHATSAPP_FROM.
 */
export async function notifyWhatsApp(text: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const toList = (process.env.TWILIO_WHATSAPP_TO || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!accountSid || !authToken || !from || toList.length === 0) return;

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  await Promise.all(
    toList.map(async (to) => {
      try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ From: from, To: to, Body: text }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          console.error(`WhatsApp notification to ${to} failed: HTTP ${res.status}`, data?.message);
        }
      } catch (err) {
        console.error(`Failed to send WhatsApp notification to ${to}:`, err);
      }
    })
  );
}
