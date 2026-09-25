import { NextResponse } from "next/server";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { sum, percentChange, sinceDaysAgo, splitLastNDays } from "@/lib/monitoring/aggregate";

/**
 * "Ask the Business Brain" — answers a natural-language question using
 * everything recorded in knowledge_entries, the monitored websites/brands
 * list, today's dashboard activity, and each site's real Analytics/Search
 * Console performance (last 7 days vs previous 7) — the "cross-module"
 * piece, so questions like "which services are performing best" or "which
 * brands have growing traffic" can be answered from real numbers, not just
 * manually-written knowledge. Social Media isn't built yet, so it's not a
 * source here — nothing to pull from until that module exists.
 *
 * Retrieval for v1: the whole knowledge base is included directly in the
 * prompt rather than a keyword/vector search narrowing it first — at this
 * scale (a company knowledge base, not a document warehouse) that's more
 * reliable than literal keyword matching missing a relevant entry that
 * happens to use different wording. Capped at 300 entries as a safety
 * bound; if the knowledge base outgrows what comfortably fits in context,
 * this is the point to add real keyword/semantic retrieval on top.
 */
export async function POST(request: Request) {
  const session = await getSessionProfile();
  if (!session?.profile) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { question } = await request.json();
  if (!question || typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "A question is required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const [
    { data: entries },
    { data: websites },
    { data: incidentsToday },
    { data: openIncidents },
    { data: analysesToday },
    { data: documentsToday },
    { data: analyticsMetrics },
    { data: searchConsoleMetrics },
  ] = await Promise.all([
    supabase
      .from("knowledge_entries")
      .select("id, entry_type, title, content, tags, status, owner_name, website_id, source, updated_at")
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase.from("websites").select("id, name, domain, category").order("name", { ascending: true }),
    supabase
      .from("incidents")
      .select("website_id, severity, started_at, resolved_at")
      .or(`started_at.gte.${todayIso},resolved_at.gte.${todayIso}`),
    supabase.from("incidents").select("website_id, severity, started_at").is("resolved_at", null),
    supabase.from("claude_analyses").select("website_id, created_at").gte("created_at", todayIso),
    supabase.from("knowledge_documents").select("title, website_id").gte("created_at", todayIso),
    supabase.from("analytics_metrics").select("website_id, date, sessions, users, conversions").gte("date", sinceDaysAgo(13)),
    supabase.from("search_console_metrics").select("website_id, date, clicks, impressions").gte("date", sinceDaysAgo(13)),
  ]);

  const websiteNameById = new Map((websites || []).map((w) => [w.id, w.name]));
  const siteName = (id: string | null) => (id ? websiteNameById.get(id) || "an unknown site" : "company-wide");

  const knowledgeBlock = (entries || []).length
    ? (entries || [])
        .map(
          (e) =>
            `[id:${e.id}] [${e.entry_type}]${e.website_id ? ` [${websiteNameById.get(e.website_id) || "site"}]` : " [company-wide]"} ${e.title}\n${e.content}${e.owner_name ? `\nOwner: ${e.owner_name}` : ""}${e.tags?.length ? `\nTags: ${e.tags.join(", ")}` : ""}`
        )
        .join("\n\n")
    : "No knowledge entries recorded yet.";

  const websitesBlock = (websites || []).length
    ? (websites || []).map((w) => `${w.name} (${w.domain})${w.category ? ` — ${w.category}` : ""}`).join("\n")
    : "No websites recorded.";

  const entriesAddedToday = (entries || []).filter((e) => e.updated_at >= todayIso);
  const opened = (incidentsToday || []).filter((i) => i.started_at >= todayIso);
  const resolved = (incidentsToday || []).filter((i) => i.resolved_at && i.resolved_at >= todayIso);

  const activityBlock = `Today's date: ${todayStart.toISOString().slice(0, 10)}.

Incidents opened today: ${opened.length ? opened.map((i) => `${siteName(i.website_id)} (${i.severity})`).join("; ") : "None."}
Incidents resolved today: ${resolved.length ? resolved.map((i) => `${siteName(i.website_id)} (${i.severity})`).join("; ") : "None."}
Currently open incidents (as of now, any date): ${
    (openIncidents || []).length
      ? (openIncidents || []).map((i) => `${siteName(i.website_id)} — ${i.severity}, open since ${i.started_at}`).join("; ")
      : "None — nothing currently open."
  }
Knowledge entries added/updated today: ${
    entriesAddedToday.length ? entriesAddedToday.map((e) => `${e.title} (${e.entry_type})`).join("; ") : "None."
  }
Documents uploaded today: ${(documentsToday || []).length ? (documentsToday || []).map((d) => `${d.title} (${siteName(d.website_id)})`).join("; ") : "None."}
Sites analysed by Claude today: ${
    (analysesToday || []).length ? (analysesToday || []).map((a) => siteName(a.website_id)).join(", ") : "None."
  }`;

  // Cross-module: real Analytics/Search Console numbers per site, last 7
  // days vs the 7 before that — lets the Brain answer performance/ranking
  // questions ("which services are performing best") from actual data
  // instead of only the manually-written knowledge base.
  const siteIds = new Set<string>([
    ...(analyticsMetrics || []).map((r) => r.website_id),
    ...(searchConsoleMetrics || []).map((r) => r.website_id),
  ]);

  const performanceLines = Array.from(siteIds).map((id) => {
    const amRows = (analyticsMetrics || []).filter((r) => r.website_id === id);
    const scmRows = (searchConsoleMetrics || []).filter((r) => r.website_id === id);
    const am = splitLastNDays(amRows, 7);
    const scm = splitLastNDays(scmRows, 7);

    const sessions = sum(am.current.map((r) => r.sessions));
    const sessionsPrev = sum(am.previous.map((r) => r.sessions));
    const conversions = sum(am.current.map((r) => r.conversions));
    const conversionsPrev = sum(am.previous.map((r) => r.conversions));
    const clicks = sum(scm.current.map((r) => r.clicks));
    const clicksPrev = sum(scm.previous.map((r) => r.clicks));

    const pct = (cur: number, prev: number) => {
      const c = percentChange(cur, prev);
      return c === null ? "n/a — no prior period" : `${c >= 0 ? "+" : ""}${c.toFixed(0)}%`;
    };

    return `${siteName(id)}: sessions ${sessions} (${pct(sessions, sessionsPrev)} vs prior 7 days), conversions ${conversions} (${pct(conversions, conversionsPrev)}), search clicks ${clicks} (${pct(clicks, clicksPrev)})`;
  });

  const performanceBlock = performanceLines.length
    ? performanceLines.join("\n")
    : "No sites have connected Analytics/Search Console data yet.";

  const systemPrompt = `You are the "Business Brain" for a company's internal dashboard — you answer staff questions using ONLY the company's own recorded knowledge base, website/brand list, today's real dashboard activity, and real site performance data given below. You are not a general assistant; you have no other knowledge of this specific company beyond what's provided here.

Critical rules:
- Every claim must be traceable to a specific knowledge entry, website record, activity line, or performance line given below. Never invent facts, people, prices, decisions, events, or numbers not present in the data.
- If the data doesn't contain enough information to answer, say so plainly (e.g. "I don't have recorded information about X") rather than guessing.
- For questions about "today", "updates", "what's new", or "what happened" — answer directly from the TODAY'S ACTIVITY section. If every line in it says "None", say plainly that nothing notable happened today rather than padding the answer.
- For questions comparing or ranking sites/brands/services by performance ("which is performing best", "which is growing") — use the SITE PERFORMANCE section's real sessions/conversions/clicks figures and % changes. Combine with knowledge entries where a site's knowledge entries describe what service(s) it offers, so you can name the service, not just the site, when the knowledge base makes that connection explicit — don't guess which service drove a number if it isn't recorded.
- After your answer, list the sources you actually used as a "Sources:" section, citing each by its [id:...] tag and title exactly as given for knowledge entries. Activity/performance/website records don't have [id:...] tags — describe them in the answer itself but don't fabricate a source tag for them.
- Keep the answer itself concise and directly responsive to the question.

TODAY'S ACTIVITY:
${activityBlock}

SITE PERFORMANCE (last 7 days vs previous 7 days, from Google Analytics / Search Console):
${performanceBlock}

KNOWLEDGE BASE ENTRIES:
${knowledgeBlock}

WEBSITES / BRANDS:
${websitesBlock}`;

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
        messages: [{ role: "user", content: question.trim() }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      return NextResponse.json({ error: `Claude API error: ${errText}` }, { status: 500 });
    }

    const anthropicData = await anthropicResponse.json();
    const textBlock = anthropicData.content?.find((c: any) => c.type === "text");
    const fullText: string = textBlock?.text || "";

    if (!fullText) {
      return NextResponse.json({ error: "Claude returned an empty response" }, { status: 500 });
    }

    // Split the "Sources:" section back out so the UI can render clickable
    // citations instead of plain trailing text.
    const sourcesSplit = fullText.split(/\n?Sources:\n?/i);
    const answer = sourcesSplit[0].trim();
    const citedIds = new Set(
      Array.from((sourcesSplit[1] || "").matchAll(/\[id:([a-f0-9-]+)\]/gi)).map((m) => m[1])
    );
    const sources = (entries || [])
      .filter((e) => citedIds.has(e.id))
      .map((e) => ({ id: e.id, title: e.title, entry_type: e.entry_type }));

    return NextResponse.json({ answer, sources });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}
