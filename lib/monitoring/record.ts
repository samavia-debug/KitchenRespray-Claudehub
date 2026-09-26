import { createServiceClient } from "@/lib/supabase/service";
import { checkWebsiteHealth, checkBrokenLinks } from "./checker";
import { checkSeo, checkDomainExpiry } from "./seo";
import { checkCoreWebVitals } from "./vitals";
import { checkWordPress } from "./wordpress";
import { checkWebsiteSecurity } from "./security";
import { computeWebsiteStatus } from "./status";
import { decideIncidentAction, formatDuration } from "./incidents";
import { notifySlack, notifyWhatsApp, formatIncidentOpenedMessage, formatIncidentResolvedMessage } from "./notify";
import type { HealthCheck } from "./types";

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

  await syncIncidentState(service, websiteId, domain, data as HealthCheck);

  return data;
}

/**
 * Opens, continues, or resolves this website's incident record based on
 * the status just computed from the new check — see decideIncidentAction
 * for the actual open/continue/resolve rules — and sends the corresponding
 * Slack + WhatsApp notifications on open/resolve only (never on
 * "continue", which is exactly the dedup this table exists for). Never
 * lets a health-check failure here block the check itself from being
 * recorded; a failure to sync incident state or notify is logged, not
 * thrown.
 */
async function syncIncidentState(
  service: ReturnType<typeof createServiceClient>,
  websiteId: string,
  domain: string,
  check: HealthCheck
) {
  try {
    const status = computeWebsiteStatus(check);

    const { data: openIncident } = await service
      .from("incidents")
      .select("id, started_at, detection_count")
      .eq("website_id", websiteId)
      .is("resolved_at", null)
      .maybeSingle();

    const action = decideIncidentAction(status, !!openIncident);

    if (action.type === "open") {
      await service.from("incidents").insert({
        website_id: websiteId,
        severity: action.severity,
        started_at: check.checked_at,
        last_seen_at: check.checked_at,
        detection_count: 1,
      });

      const { data: website } = await service.from("websites").select("name").eq("id", websiteId).single();
      const openedMessage = formatIncidentOpenedMessage(website?.name || domain, domain, action.severity);
      await Promise.all([notifySlack(openedMessage), notifyWhatsApp(openedMessage)]);
    } else if (action.type === "continue" && openIncident) {
      await service
        .from("incidents")
        .update({ last_seen_at: check.checked_at, detection_count: openIncident.detection_count + 1 })
        .eq("id", openIncident.id);
    } else if (action.type === "resolve" && openIncident) {
      await service.from("incidents").update({ resolved_at: check.checked_at }).eq("id", openIncident.id);

      const { data: website } = await service.from("websites").select("name").eq("id", websiteId).single();
      const duration = formatDuration(openIncident.started_at, check.checked_at);
      const resolvedMessage = formatIncidentResolvedMessage(website?.name || domain, domain, duration);
      await Promise.all([notifySlack(resolvedMessage), notifyWhatsApp(resolvedMessage)]);
    }
  } catch (err) {
    console.error(`Failed to sync incident state for website ${websiteId}:`, err);
  }
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

/** Runs a technical-SEO spot-check (homepage + robots.txt + sitemap.xml) and upserts the result. */
export async function runAndRecordSeoCheck(websiteId: string, domain: string) {
  const result = await checkSeo(domain);
  const service = createServiceClient();

  const { data, error } = await service
    .from("website_seo_checks")
    .upsert(
      {
        website_id: websiteId,
        title: result.title,
        meta_description: result.metaDescription,
        canonical_url: result.canonicalUrl,
        has_noindex: result.hasNoindex,
        robots_txt_status: result.robotsTxtStatus,
        robots_disallows_all: result.robotsDisallowsAll,
        sitemap_status: result.sitemapStatus,
        sitemap_in_robots: result.sitemapInRobots,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "website_id" }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to record SEO check: ${error.message}`);

  return data;
}

/**
 * Looks up domain expiry via RDAP and stores it on the website row.
 * Meant to be run occasionally (weekly-ish), not on the health-check
 * cadence — see the comment on checkDomainExpiry for why.
 */
export async function runAndRecordDomainExpiryCheck(websiteId: string, domain: string) {
  const result = await checkDomainExpiry(domain);
  const service = createServiceClient();

  const { data, error } = await service
    .from("websites")
    .update({
      domain_expires_at: result.expiresAt,
      domain_expiry_checked_at: new Date().toISOString(),
      domain_expiry_unavailable: result.unavailable,
    })
    .eq("id", websiteId)
    .select()
    .single();

  if (error) throw new Error(`Failed to record domain expiry check: ${error.message}`);

  return { website: data, errorMessage: result.errorMessage };
}

/**
 * Runs a PageSpeed Insights (mobile) audit and upserts the result. Manual
 * only — see the comment on the core_web_vitals_checks table migration for
 * why this isn't on the health-check cadence (slow, quota-limited).
 */
export async function runAndRecordVitalsCheck(websiteId: string, domain: string) {
  const result = await checkCoreWebVitals(domain);

  if (result.errorMessage) {
    throw new Error(result.errorMessage);
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("core_web_vitals_checks")
    .upsert(
      {
        website_id: websiteId,
        performance_score: result.performanceScore,
        lcp_ms: result.lcpMs,
        cls: result.cls,
        tbt_ms: result.tbtMs,
        has_field_data: result.hasFieldData,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "website_id" }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to record Core Web Vitals check: ${error.message}`);

  return data;
}

/**
 * Runs the site-hijack security scan and upserts the result. Alerts via
 * Slack/WhatsApp only on a fresh transition into "critical" (the site
 * wasn't already flagged), same dedup reasoning as incident open/resolve —
 * otherwise every 30-minute cron tick would re-alert for a site still
 * compromised from the last check.
 */
export async function runAndRecordSecurityCheck(websiteId: string, domain: string) {
  const result = await checkWebsiteSecurity(domain);
  const service = createServiceClient();

  const { data: previous } = await service
    .from("website_security_checks")
    .select("risk_level")
    .eq("website_id", websiteId)
    .maybeSingle();

  const { data, error } = await service
    .from("website_security_checks")
    .upsert(
      {
        website_id: websiteId,
        final_url: result.finalUrl,
        domain_mismatch: result.domainMismatch,
        flagged_keywords: result.flaggedKeywords,
        risk_level: result.riskLevel,
        error_message: result.errorMessage,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "website_id" }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to record security check: ${error.message}`);

  if (result.riskLevel === "critical" && previous?.risk_level !== "critical") {
    const { data: website } = await service.from("websites").select("name").eq("id", websiteId).single();
    const message = `🔴 *Security risk detected* — ${website?.name || domain} (${domain}) appears to be redirecting to a different, unrelated domain (${result.finalUrl || "unknown"}). This matches the pattern of a hijacked/compromised site, not an expired domain. Check it now.`;
    await Promise.all([notifySlack(message), notifyWhatsApp(message)]);
  }

  return data;
}

/** Runs the passive WordPress fingerprint check and upserts the result. */
export async function runAndRecordWordPressCheck(websiteId: string, domain: string) {
  const result = await checkWordPress(domain);
  const service = createServiceClient();

  const { data, error } = await service
    .from("website_wordpress_checks")
    .upsert(
      {
        website_id: websiteId,
        is_wordpress: result.isWordPress,
        core_version: result.coreVersion,
        theme_slug: result.themeSlug,
        plugins: result.plugins,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "website_id" }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to record WordPress check: ${error.message}`);

  return data;
}
