import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { computeWebsiteStatus, sslDaysRemaining } from "@/lib/monitoring/status";
import { sum, sinceDaysAgo, splitLastNDays } from "@/lib/monitoring/aggregate";

/**
 * "Analyse with Claude" — gathers everything real this app has collected
 * for one site (uptime/SSL, SEO spot-check, Core Web Vitals, WordPress
 * fingerprint, open/recent incidents, GA4 + Search Console 7-day figures)
 * and asks Claude to explain what it means in plain English. Matches the
 * project's original design principle: every statement must be traceable
 * to real collected data — the prompt explicitly forbids inventing causes
 * or claiming certainty the data doesn't support, and any field this app
 * hasn't collected is marked "Not connected" rather than omitted, so
 * Claude never has to guess whether silence means "fine" or "unknown".
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(["Admin", "Manager"]);
  if ("error" in auth) return auth.error;

  const supabase = createServiceClient();

  const { data: website, error: websiteError } = await supabase
    .from("websites")
    .select("*")
    .eq("id", params.id)
    .single();

  if (websiteError || !website) {
    return NextResponse.json({ error: "Website not found" }, { status: 404 });
  }

  const [
    { data: latestCheck },
    { data: seoCheck },
    { data: vitalsCheck },
    { data: wordpressCheck },
    { data: incidents },
    { data: brokenLinks },
    { data: analyticsMetrics },
    { data: searchConsoleMetrics },
  ] = await Promise.all([
    supabase.from("website_health_checks").select("*").eq("website_id", params.id).order("checked_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("website_seo_checks").select("*").eq("website_id", params.id).maybeSingle(),
    supabase.from("core_web_vitals_checks").select("*").eq("website_id", params.id).maybeSingle(),
    supabase.from("website_wordpress_checks").select("*").eq("website_id", params.id).maybeSingle(),
    supabase.from("incidents").select("*").eq("website_id", params.id).order("started_at", { ascending: false }).limit(10),
    supabase.from("website_link_checks").select("id").eq("website_id", params.id).eq("is_broken", true),
    supabase.from("analytics_metrics").select("date, sessions, users, conversions").eq("website_id", params.id).gte("date", sinceDaysAgo(13)).order("date", { ascending: false }),
    supabase.from("search_console_metrics").select("date, clicks, impressions, avg_position").eq("website_id", params.id).gte("date", sinceDaysAgo(13)).order("date", { ascending: false }),
  ]);

  const status = computeWebsiteStatus(latestCheck || null);
  const sslDays = sslDaysRemaining(latestCheck?.ssl_expires_at || null);
  const openIncidents = (incidents || []).filter((i) => !i.resolved_at);

  const am = analyticsMetrics || [];
  const scm = searchConsoleMetrics || [];
  const { current: amLast7, previous: amPrev7 } = splitLastNDays(am, 7);
  const { current: scmLast7 } = splitLastNDays(scm, 7);

  const dataSummary = `
Site: ${website.name} (${website.domain})
Priority: ${website.priority}

AVAILABILITY
${latestCheck
  ? `Status: ${status}. Last check: HTTP ${latestCheck.http_status ?? "no response"}, response time ${latestCheck.response_time_ms ?? "—"}ms, up: ${latestCheck.is_up}, checked at ${latestCheck.checked_at}.${latestCheck.error_message ? ` Error: ${latestCheck.error_message}.` : ""}${latestCheck.likely_blocked ? " Flagged as a likely WAF/bot-protection block, not a real outage." : ""}`
  : "No health checks recorded yet."}

SSL
${latestCheck?.ssl_valid === null || latestCheck?.ssl_valid === undefined ? "Not checked." : `Valid: ${latestCheck.ssl_valid}. ${sslDays !== null ? `${sslDays} days remaining.` : ""}`}

BROKEN LINKS
${brokenLinks?.length ?? 0} broken links currently detected on the homepage scan.

SEO SPOT-CHECK
${seoCheck
  ? `Title: ${seoCheck.title || "missing"}. Meta description: ${seoCheck.meta_description ? "present" : "missing"}. Noindex tag present: ${seoCheck.has_noindex}. robots.txt: ${seoCheck.robots_txt_status}${seoCheck.robots_disallows_all ? " (disallows ALL crawlers)" : ""}. sitemap.xml: ${seoCheck.sitemap_status}.`
  : "Not checked yet."}

CORE WEB VITALS (mobile, PageSpeed Insights)
${vitalsCheck
  ? `Performance score: ${vitalsCheck.performance_score ?? "—"}/100. LCP: ${vitalsCheck.lcp_ms ?? "—"}ms. CLS: ${vitalsCheck.cls ?? "—"}. TBT: ${vitalsCheck.tbt_ms ?? "—"}ms.`
  : "Not checked yet."}

WORDPRESS
${wordpressCheck
  ? wordpressCheck.is_wordpress
    ? `Runs WordPress. Core version: ${wordpressCheck.core_version || "not visible"}. Theme: ${wordpressCheck.theme_slug || "not detected"}. ${(wordpressCheck.plugins || []).filter((p: any) => p.isOutdated).length} plugin(s) flagged as outdated out of ${(wordpressCheck.plugins || []).length} detected.`
    : "Does not appear to run WordPress."
  : "Not checked yet."}

INCIDENTS
${openIncidents.length} currently open. ${(incidents || []).length} total in the last 10 recorded (most recent first): ${
    (incidents || []).slice(0, 5).map((i) => `${i.severity} started ${i.started_at}${i.resolved_at ? `, resolved ${i.resolved_at}` : ", still open"}`).join("; ") || "none"
  }.

GOOGLE ANALYTICS (last 7 days vs previous 7 days)
${am.length > 0
  ? `Sessions: ${sum(amLast7.map((r) => r.sessions))} (previous 7 days: ${sum(amPrev7.map((r) => r.sessions))}). Users: ${sum(amLast7.map((r) => r.users))}. Conversions: ${sum(amLast7.map((r) => r.conversions))} (previous 7 days: ${sum(amPrev7.map((r) => r.conversions))}).`
  : "Not connected / not synced."}

GOOGLE SEARCH CONSOLE (last 7 days)
${scm.length > 0
  ? `Clicks: ${sum(scmLast7.map((r) => r.clicks))}. Impressions: ${sum(scmLast7.map((r) => r.impressions))}. Average position: ${
      scmLast7.length ? (scmLast7.reduce((t, r) => t + (r.avg_position || 0), 0) / scmLast7.length).toFixed(1) : "—"
    }.`
  : "Not connected / not synced."}
`.trim();

  const systemPrompt = `You are a technical analyst summarizing website monitoring data for a non-technical business team. You will be given real, actual monitoring data collected by their system — health checks, SEO, Core Web Vitals, WordPress fingerprinting, incidents, and Google Analytics/Search Console figures.

Critical rule: every statement you make must be directly traceable to the data given. Never invent a cause, never claim certainty the data doesn't support, and never assume something is fine just because it wasn't checked — if a section says "Not checked yet" or "Not connected", say that plainly rather than ignoring it or assuming health. Use wording like "may indicate" or "worth checking" rather than definitive causal claims when the data doesn't establish cause. If two things changed around the same time (e.g. a performance drop and a traffic drop), you may note the correlation but must not claim one caused the other.

Write a short, clear analysis (250-400 words) covering: (1) overall health in plain English, (2) anything that needs attention and why, (3) anything genuinely good/improving worth noting, (4) 2-4 concrete, specific next steps the team could take. No markdown headers, just clear paragraphs. Do not pad with generic advice not tied to this site's actual data.`;

  try {
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: "user", content: dataSummary }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      return NextResponse.json({ error: `Claude API error: ${errText}` }, { status: 500 });
    }

    const anthropicData = await anthropicResponse.json();
    const textBlock = anthropicData.content?.find((c: any) => c.type === "text");
    const analysis = textBlock?.text || "";

    if (!analysis) {
      return NextResponse.json({ error: "Claude returned an empty response" }, { status: 500 });
    }

    const { error: upsertError } = await supabase
      .from("claude_analyses")
      .upsert(
        { website_id: params.id, analysis, model: "claude-sonnet-5", created_at: new Date().toISOString() },
        { onConflict: "website_id" }
      );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, analysis, created_at: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}
