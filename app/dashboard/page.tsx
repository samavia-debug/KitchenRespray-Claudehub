"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { computeWebsiteStatus } from "@/lib/monitoring/status";
import type { HealthCheck, Incident, Website } from "@/lib/monitoring/types";
import { sum, sinceDaysAgo, getConnectedWebsiteIds } from "@/lib/monitoring/aggregate";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

type Summary = {
  totalSites: number;
  healthy: number;
  attention: number;
  critical: number;
  offline: number;
  openIncidents: Incident[];
  websiteNameById: Map<string, string>;
  sessions7d: number;
  clicks7d: number;
  analyticsSitesConnected: number;
  analysedCount: number;
};

export default function OverviewPage() {
  const supabase = createClient();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    // 6, not 7: sinceDaysAgo(6) through today inclusive is exactly 7
    // calendar days — sinceDaysAgo(7) would silently include an 8th.
    const since7 = sinceDaysAgo(6);

    const [
      { data: websites, error: websitesError },
      { data: latestChecks },
      { data: openIncidents },
      { data: am },
      { data: scm },
      { count: analysedCount },
      { data: securityChecks },
    ] = await Promise.all([
      supabase.from("websites").select("*").eq("is_active", true),
      supabase.from("website_latest_check").select("*"),
      supabase.from("incidents").select("*").is("resolved_at", null).order("started_at", { ascending: false }),
      supabase.from("analytics_metrics").select("website_id, sessions").gte("date", since7),
      supabase.from("search_console_metrics").select("website_id, clicks").gte("date", since7),
      supabase.from("claude_analyses").select("website_id", { count: "exact", head: true }),
      supabase.from("website_security_checks").select("website_id, risk_level"),
    ]);

    if (websitesError) {
      setError(websitesError.message);
      return;
    }

    const sites = (websites || []) as Website[];
    const checksByWebsite = new Map<string, HealthCheck>((latestChecks || []).map((c: any) => [c.website_id, c]));
    const securityRiskMap = new Map<string, string>((securityChecks || []).map((s: any) => [s.website_id, s.risk_level]));

    let healthy = 0, attention = 0, critical = 0, offline = 0;
    sites.forEach((w) => {
      const status = computeWebsiteStatus(checksByWebsite.get(w.id) || null, securityRiskMap.get(w.id) as any);
      if (status === "healthy") healthy++;
      else if (status === "attention") attention++;
      else if (status === "critical") critical++;
      else if (status === "offline") offline++;
    });

    const analyticsSiteIds = getConnectedWebsiteIds(am || [], scm || []);

    setSummary({
      totalSites: sites.length,
      healthy,
      attention,
      critical,
      offline,
      openIncidents: (openIncidents || []) as Incident[],
      websiteNameById: new Map(sites.map((w) => [w.id, w.name])),
      sessions7d: sum((am || []).map((r: any) => r.sessions)),
      clicks7d: sum((scm || []).map((r: any) => r.clicks)),
      analyticsSitesConnected: analyticsSiteIds.size,
      analysedCount: analysedCount || 0,
    });
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <>
        <div className="page-header">
          <h1>Overview</h1>
        </div>
        <div className="card">
          <p className="error-text">Failed to load: {error}</p>
        </div>
      </>
    );
  }

  if (!summary) {
    return (
      <>
        <div className="page-header">
          <h1>Overview</h1>
        </div>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </>
    );
  }

  const needsAction = summary.critical + summary.offline;

  return (
    <>
      <div className="page-header">
        <h1>{greeting()}</h1>
        <p>
          {summary.totalSites} website{summary.totalSites === 1 ? "" : "s"} monitored.{" "}
          {needsAction > 0
            ? `${needsAction} need${needsAction === 1 ? "s" : ""} attention right now.`
            : "Everything's healthy."}
        </p>
      </div>

      <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
        <div className="stat-card">
          <div className="stat-value">{summary.totalSites}</div>
          <div className="stat-label">Total websites</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "#2e7d32" }}>{summary.healthy}</div>
          <div className="stat-label">Healthy</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "#b98900" }}>{summary.attention}</div>
          <div className="stat-label">Needs attention</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: needsAction > 0 ? "#b3261e" : undefined }}>{needsAction}</div>
          <div className="stat-label">Critical / offline</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: "1.25rem" }}>
        <div className="card">
          <h2>Needs action now</h2>
          {summary.openIncidents.length > 0 ? (
            <>
              {summary.openIncidents.slice(0, 5).map((i) => (
                <div key={i.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: i.severity === "offline" ? "#6f6a63" : "#b3261e", fontWeight: 600, fontSize: "0.85rem", textTransform: "capitalize" }}>
                    {i.severity}
                  </span>
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.9rem" }}>
                    {summary.websiteNameById.get(i.website_id) || "Unknown site"}
                  </span>
                  <span style={{ marginLeft: "0.5rem", color: "var(--muted)", fontSize: "0.8rem" }}>
                    since {new Date(i.started_at).toLocaleString()}
                  </span>
                </div>
              ))}
              {summary.openIncidents.length > 5 && (
                <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                  +{summary.openIncidents.length - 5} more.
                </p>
              )}
              <Link href="/dashboard/incidents" className="btn-secondary btn" style={{ marginTop: "0.75rem", display: "inline-block", fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}>
                View all incidents
              </Link>
            </>
          ) : (
            <p style={{ color: "var(--muted)" }}>No open incidents — nothing needs action right now.</p>
          )}
        </div>

        <div className="card">
          <h2>Traffic — last 7 days</h2>
          {summary.analyticsSitesConnected > 0 ? (
            <>
              <div className="grid-2">
                <div>
                  <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.2rem" }}>Sessions</p>
                  <p style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0 }}>{summary.sessions7d}</p>
                </div>
                <div>
                  <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.2rem" }}>Search clicks</p>
                  <p style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0 }}>{summary.clicks7d}</p>
                </div>
              </div>
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.75rem 0 0" }}>
                Across {summary.analyticsSitesConnected} connected site{summary.analyticsSitesConnected === 1 ? "" : "s"}.
              </p>
              <Link href="/dashboard/analytics" className="btn-secondary btn" style={{ marginTop: "0.75rem", display: "inline-block", fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}>
                View full breakdown
              </Link>
            </>
          ) : (
            <p style={{ color: "var(--muted)" }}>
              No sites connected to Google yet — connect from the Monitoring dashboard.
            </p>
          )}
        </div>
      </div>

      <div className="page-header" style={{ marginTop: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Quick links</h2>
      </div>
      <div className="grid-2">
        <Link href="/dashboard/monitoring" className="card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <h2>Monitoring</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            Website health, SSL, performance, and priority alerts across every site.
          </p>
        </Link>
        <Link href="/dashboard/claude-analysis" className="card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <h2>Claude Analysis</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            {summary.analysedCount} of {summary.totalSites} sites analysed — see what Claude found.
          </p>
        </Link>
        <Link href="/dashboard/claude-design" className="card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <h2>Claude Design</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            Submit a design brief and generate on-brand social posts.
          </p>
        </Link>
        <Link href="/dashboard/knowledge" className="card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <h2>Company Knowledge</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            Manage brand voice, service lines, and content rules.
          </p>
        </Link>
      </div>
    </>
  );
}
