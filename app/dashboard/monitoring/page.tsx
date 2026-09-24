"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { computeWebsiteStatus } from "@/lib/monitoring/status";
import type { Website, HealthCheck, Incident, WebsiteWithHealth } from "@/lib/monitoring/types";
import SummaryCards from "./summary-cards";
import WebsiteGrid from "./website-grid";
import AddWebsiteForm from "./add-website-form";
import AlertsPanel from "./alerts-panel";
import TrafficSummary from "./traffic-summary";
import MorningSummary from "./morning-summary";

const RECENT_INCIDENT_WINDOW_HOURS = 48;

export default function MonitoringCommandCentre() {
  const supabase = createClient();
  const [websites, setWebsites] = useState<WebsiteWithHealth[] | null>(null);
  const [recentIncidents, setRecentIncidents] = useState<Incident[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setCanManage(profile?.role === "Admin" || profile?.role === "Manager");
    }

    const recentCutoff = new Date(Date.now() - RECENT_INCIDENT_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    const [{ data: sites, error: sitesError }, { data: latest }, { data: uptime }, { data: brokenLinks }, { data: incidentRows }] =
      await Promise.all([
        supabase.from("websites").select("*").order("name", { ascending: true }),
        supabase.from("website_latest_check").select("*"),
        supabase.from("website_uptime_7d").select("*"),
        supabase.from("website_broken_links_count").select("*"),
        // Every still-open incident (regardless of age) plus anything that
        // started within the recent window (whether resolved or not) — one
        // query covers both "what's open right now" and "what happened
        // overnight" for the morning summary.
        supabase.from("incidents").select("*").or(`resolved_at.is.null,started_at.gte.${recentCutoff}`),
      ]);

    if (sitesError) {
      setError(sitesError.message);
      return;
    }

    const latestMap = new Map<string, HealthCheck>((latest || []).map((c: any) => [c.website_id, c]));
    const uptimeMap = new Map<string, { uptime_percent: number; checks_count: number }>(
      (uptime || []).map((u: any) => [u.website_id, u])
    );
    const brokenLinksMap = new Map<string, number>(
      (brokenLinks || []).map((b: any) => [b.website_id, b.broken_count])
    );
    const allIncidents = (incidentRows || []) as Incident[];
    const openIncidentMap = new Map<string, Incident>(
      allIncidents.filter((i) => !i.resolved_at).map((i) => [i.website_id, i])
    );
    setRecentIncidents(allIncidents);

    const merged: WebsiteWithHealth[] = (sites as Website[]).map((w) => {
      const latestCheck = latestMap.get(w.id) || null;
      const uptimeRow = uptimeMap.get(w.id);
      return {
        ...w,
        latestCheck,
        uptimePercent7d: uptimeRow ? uptimeRow.uptime_percent : null,
        checksCount7d: uptimeRow ? uptimeRow.checks_count : 0,
        status: computeWebsiteStatus(latestCheck),
        brokenLinkCount: brokenLinksMap.get(w.id) || 0,
        openIncident: openIncidentMap.get(w.id) || null,
      };
    });

    setWebsites(merged);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <>
        <div className="page-header">
          <h1>Website Command Centre</h1>
        </div>
        <div className="card">
          <p className="error-text">Failed to load websites: {error}</p>
        </div>
      </>
    );
  }

  if (!websites) {
    return (
      <>
        <div className="page-header">
          <h1>Website Command Centre</h1>
        </div>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Website Command Centre</h1>
        <p>Health, performance, and Claude-analysed status across every monitored website.</p>
      </div>

      <MorningSummary websites={websites} recentIncidents={recentIncidents} canManage={canManage} onChecked={load} />

      <SummaryCards websites={websites} />

      <TrafficSummary canManage={canManage} />

      <AlertsPanel websites={websites} />

      {canManage && <AddWebsiteForm onAdded={load} />}

      <WebsiteGrid websites={websites} />
    </>
  );
}
