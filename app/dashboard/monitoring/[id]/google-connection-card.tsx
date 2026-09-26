"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GoogleConnection, GoogleService } from "@/lib/monitoring/types";
import MetricTrendChart from "../metric-trend-chart";
import ChangeBadge from "../change-badge";
import { sum, avg, percentChange, sinceDaysAgo, splitLastNDays } from "@/lib/monitoring/aggregate";

const LABELS: Record<GoogleService, string> = {
  analytics: "Google Analytics",
  search_console: "Google Search Console",
};

type AnalyticsMetric = { date: string; users: number | null; sessions: number | null; conversions: number | null };
type SearchConsoleMetric = { date: string; clicks: number | null; impressions: number | null; ctr: number | null; avg_position: number | null };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatAvg(value: number | null, decimals: number = 1, suffix: string = ""): string {
  return value === null ? "—" : `${value.toFixed(decimals)}${suffix}`;
}

export default function GoogleConnectionCard({
  websiteId,
  service,
  canManage,
}: {
  websiteId: string;
  service: GoogleService;
  canManage: boolean;
}) {
  const supabase = createClient();
  const [connection, setConnection] = useState<GoogleConnection | null | "loading">("loading");
  const [analyticsMetrics, setAnalyticsMetrics] = useState<AnalyticsMetric[]>([]);
  const [searchConsoleMetrics, setSearchConsoleMetrics] = useState<SearchConsoleMetric[]>([]);
  const [channelBreakdown, setChannelBreakdown] = useState<{ channel: string; sessions: number; conversions: number }[] | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/google/connections/${websiteId}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load connection status");
        return;
      }
      const match = (data.connections as GoogleConnection[]).find((c) => c.service === service);
      setConnection(match || null);

      if (match) {
        const since = sinceDaysAgo(30);
        if (service === "analytics") {
          const { data: rows } = await supabase
            .from("analytics_metrics")
            .select("date, users, sessions, conversions")
            .eq("website_id", websiteId)
            .gte("date", since)
            .order("date", { ascending: false });
          setAnalyticsMetrics(rows || []);

          fetch(`/api/google/channel-breakdown/${websiteId}`)
            .then((r) => r.json())
            .then((d) => setChannelBreakdown(d.breakdown || null))
            .catch(() => setChannelBreakdown(null));
        } else {
          const { data: rows } = await supabase
            .from("search_console_metrics")
            .select("date, clicks, impressions, ctr, avg_position")
            .eq("website_id", websiteId)
            .gte("date", since)
            .order("date", { ascending: false });
          setSearchConsoleMetrics(rows || []);
        }
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, [websiteId, service, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function disconnect() {
    if (!confirm(`Disconnect ${LABELS[service]} for this site?`)) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/google/connections/${websiteId}?service=${service}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to disconnect");
      } else {
        setConnection(null);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setDisconnecting(false);
  }

  async function syncNow() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/google/sync?websiteId=${websiteId}&service=${service}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sync failed");
      } else {
        await load();
      }
    } catch (err: any) {
      setError(err.message);
    }
    setSyncing(false);
  }

  const { current: last7Analytics, previous: prev7Analytics } = splitLastNDays(analyticsMetrics, 7);
  const { current: last7SearchConsole, previous: prev7SearchConsole } = splitLastNDays(searchConsoleMetrics, 7);

  const sessionsChange = percentChange(sum(last7Analytics.map((m) => m.sessions)), sum(prev7Analytics.map((m) => m.sessions)));
  const clicksChange = percentChange(sum(last7SearchConsole.map((m) => m.clicks)), sum(prev7SearchConsole.map((m) => m.clicks)));

  return (
    <div className="card">
      <h2>{LABELS[service]}</h2>

      {error && <p className="error-text">{error}</p>}

      {connection === "loading" && <p style={{ color: "var(--muted)" }}>Loading...</p>}

      {connection === null && (
        <>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
            Not connected.
          </p>
          {canManage ? (
            <a href={`/api/google/connect?websiteId=${websiteId}&service=${service}`} className="btn">
              Connect {LABELS[service]}
            </a>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Only Admins/Managers can connect this.</p>
          )}
        </>
      )}

      {connection && connection !== "loading" && (
        <>
          <p style={{ fontSize: "0.9rem" }}>
            Connected as: {connection.external_account_email || <span style={{ color: "var(--muted)" }}>Unknown account</span>}
          </p>
          <p style={{ fontSize: "0.9rem" }}>Connected: {formatDate(connection.connected_at)}</p>
          <p style={{ fontSize: "0.9rem" }}>
            Last synced: {connection.last_synced_at ? formatDate(connection.last_synced_at) : "Never — click Sync now"}
          </p>

          {canManage && (
            <div style={{ display: "flex", gap: "0.6rem", margin: "0.75rem 0" }}>
              <button className="btn" onClick={syncNow} disabled={syncing}>
                {syncing ? "Syncing..." : "Sync now"}
              </button>
              <button className="btn-secondary btn" onClick={disconnect} disabled={disconnecting}>
                {disconnecting ? "Disconnecting..." : "Disconnect"}
              </button>
            </div>
          )}

          {service === "analytics" && (
            analyticsMetrics.length > 0 ? (
              <>
                <div className="grid-2" style={{ marginTop: "1rem" }}>
                  <div>
                    <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.2rem" }}>Sessions (last 7 days)</p>
                    <p style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0 }}>
                      {sum(last7Analytics.map((m) => m.sessions))}
                      <ChangeBadge value={sessionsChange} />
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.2rem" }}>Users (last 7 days)</p>
                    <p style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0 }}>{sum(last7Analytics.map((m) => m.users))}</p>
                  </div>
                </div>
                <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "1rem 0 0.4rem" }}>Sessions — last 30 days</p>
                <MetricTrendChart
                  points={analyticsMetrics.map((m) => ({ date: m.date, value: m.sessions || 0 }))}
                  color="#b5502e"
                />

                {channelBreakdown && channelBreakdown.length > 0 && (
                  <>
                    <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "1rem 0 0.4rem" }}>
                      Traffic by channel — last 30 days (does this include paid ad clicks?)
                    </p>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Channel</th>
                            <th>Sessions</th>
                            <th>Conversions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {channelBreakdown.map((c) => (
                            <tr key={c.channel} style={{ cursor: "default" }}>
                              <td style={c.channel.toLowerCase().includes("paid") ? { fontWeight: 700, color: "#2e7d32" } : undefined}>
                                {c.channel}
                                {c.channel.toLowerCase().includes("paid") ? " (ads)" : ""}
                              </td>
                              <td>{c.sessions}</td>
                              <td>{c.conversions}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                <div className="table-wrap" style={{ marginTop: "1rem" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Sessions</th>
                        <th>Users</th>
                        <th>Conversions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsMetrics.map((m) => (
                        <tr key={m.date} style={{ cursor: "default" }}>
                          <td>{m.date}</td>
                          <td>{m.sessions ?? "—"}</td>
                          <td>{m.users ?? "—"}</td>
                          <td>{m.conversions ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "1rem" }}>
                No metrics synced yet — click Sync now.
              </p>
            )
          )}

          {service === "search_console" && (
            searchConsoleMetrics.length > 0 ? (
              <>
                <div className="grid-2" style={{ marginTop: "1rem" }}>
                  <div>
                    <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.2rem" }}>Clicks (last 7 days)</p>
                    <p style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0 }}>
                      {sum(last7SearchConsole.map((m) => m.clicks))}
                      <ChangeBadge value={clicksChange} />
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.2rem" }}>Impressions (last 7 days)</p>
                    <p style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0 }}>{sum(last7SearchConsole.map((m) => m.impressions))}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.2rem" }}>Avg CTR</p>
                    <p style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0 }}>
                      {(() => {
                        const ctr = avg(last7SearchConsole.map((m) => m.ctr));
                        return ctr === null ? "—" : formatAvg(ctr * 100, 1, "%");
                      })()}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.2rem" }}>Avg position</p>
                    <p style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0 }}>
                      {formatAvg(avg(last7SearchConsole.map((m) => m.avg_position)))}
                    </p>
                  </div>
                </div>
                <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "1rem 0 0.4rem" }}>Clicks — last 30 days</p>
                <MetricTrendChart
                  points={searchConsoleMetrics.map((m) => ({ date: m.date, value: m.clicks || 0 }))}
                  color="#b5502e"
                />
                <div className="table-wrap" style={{ marginTop: "1rem" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Clicks</th>
                        <th>Impressions</th>
                        <th>CTR</th>
                        <th>Avg position</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchConsoleMetrics.map((m) => (
                        <tr key={m.date} style={{ cursor: "default" }}>
                          <td>{m.date}</td>
                          <td>{m.clicks ?? "—"}</td>
                          <td>{m.impressions ?? "—"}</td>
                          <td>{m.ctr !== null ? `${(m.ctr * 100).toFixed(1)}%` : "—"}</td>
                          <td>{m.avg_position !== null ? m.avg_position.toFixed(1) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginTop: "1rem" }}>
                No metrics synced yet — click Sync now.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}
