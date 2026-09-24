"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sum, percentChange, sinceDaysAgo, splitLastNDays, getConnectedWebsiteIds } from "@/lib/monitoring/aggregate";
import ChangeBadge from "./change-badge";

export default function TrafficSummary({ canManage }: { canManage: boolean }) {
  const supabase = createClient();
  const [sessions7d, setSessions7d] = useState<number | null>(null);
  const [users7d, setUsers7d] = useState<number | null>(null);
  const [clicks7d, setClicks7d] = useState<number | null>(null);
  const [impressions7d, setImpressions7d] = useState<number | null>(null);
  const [sessionsChange, setSessionsChange] = useState<number | null>(null);
  const [clicksChange, setClicksChange] = useState<number | null>(null);
  const [connectedSites, setConnectedSites] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = sinceDaysAgo(13);

    // google_connections deliberately has no RLS policy for `authenticated`
    // at all (it holds raw OAuth tokens — service-role only, even for
    // Admins), so "how many sites are connected" is derived here from the
    // metrics tables instead, which do have an authenticated read policy.
    const [{ data: am, error: amError }, { data: scm, error: scmError }] = await Promise.all([
      supabase.from("analytics_metrics").select("website_id, date, sessions, users").gte("date", since),
      supabase.from("search_console_metrics").select("website_id, date, clicks, impressions").gte("date", since),
    ]);

    if (amError || scmError) {
      setMessage(
        `Failed to load metrics — analytics: ${amError?.message || "ok"}, search console: ${scmError?.message || "ok"}`
      );
    }

    const amRows = am || [];
    const scmRows = scm || [];
    const { current: amCurrent, previous: amPrevious } = splitLastNDays(amRows, 7);
    const { current: scmCurrent, previous: scmPrevious } = splitLastNDays(scmRows, 7);

    setSessions7d(sum(amCurrent.map((r: any) => r.sessions)));
    setUsers7d(sum(amCurrent.map((r: any) => r.users)));
    setClicks7d(sum(scmCurrent.map((r: any) => r.clicks)));
    setImpressions7d(sum(scmCurrent.map((r: any) => r.impressions)));
    setSessionsChange(percentChange(sum(amCurrent.map((r: any) => r.sessions)), sum(amPrevious.map((r: any) => r.sessions))));
    setClicksChange(percentChange(sum(scmCurrent.map((r: any) => r.clicks)), sum(scmPrevious.map((r: any) => r.clicks))));

    setConnectedSites(getConnectedWebsiteIds(amRows, scmRows).size);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function bulkApply() {
    setBulkApplying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/google/bulk-apply", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error}`);
      } else {
        const { analytics, search_console } = data.results;
        setMessage(`Matched Analytics: ${analytics.matched}/${analytics.total}, Search Console: ${search_console.matched}/${search_console.total}`);
        await load();
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }
    setBulkApplying(false);
  }

  async function syncAll() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/google/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error}`);
      } else {
        setMessage(`Synced ${data.synced}, failed ${data.failed}`);
        await load();
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }
    setSyncing(false);
  }

  return (
    <div className="card" style={{ gridColumn: "1 / -1", marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>Traffic &amp; Search — last 7 days, all sites</h2>
        {canManage && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn-secondary btn" style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }} onClick={bulkApply} disabled={bulkApplying}>
              {bulkApplying ? "Matching sites..." : "Connect Google account to all sites"}
            </button>
            <button className="btn" style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }} onClick={syncAll} disabled={syncing}>
              {syncing ? "Syncing..." : "Sync all now"}
            </button>
          </div>
        )}
      </div>

      {message && <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.5rem" }}>{message}</p>}

      {connectedSites === 0 ? (
        <p style={{ color: "var(--muted)", marginTop: "1rem" }}>
          No sites connected to Google yet — connect one site's Analytics/Search Console from its detail page,
          then use "Connect Google account to all sites" above to apply that same account across every other
          site it has access to.
        </p>
      ) : (
        <div className="stat-grid" style={{ marginTop: "1rem" }}>
          <div className="stat-card">
            <div className="stat-value">
              {sessions7d ?? "—"}
              <ChangeBadge value={sessionsChange} />
            </div>
            <div className="stat-label">Sessions</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{users7d ?? "—"}</div>
            <div className="stat-label">Users</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">
              {clicks7d ?? "—"}
              <ChangeBadge value={clicksChange} />
            </div>
            <div className="stat-label">Search clicks</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{impressions7d ?? "—"}</div>
            <div className="stat-label">Search impressions</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{connectedSites}</div>
            <div className="stat-label">Sites connected</div>
          </div>
        </div>
      )}
    </div>
  );
}
