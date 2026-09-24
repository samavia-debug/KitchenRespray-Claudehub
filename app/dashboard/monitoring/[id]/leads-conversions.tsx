"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import MetricTrendChart from "../metric-trend-chart";

type AnalyticsMetric = { date: string; conversions: number | null };

function sum(values: (number | null)[]): number {
  return values.reduce((total: number, v) => total + (v || 0), 0);
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const rounded = Math.round(value);
  const color = rounded > 0 ? "#2e7d32" : rounded < 0 ? "#b3261e" : "var(--muted)";
  const arrow = rounded > 0 ? "↑" : rounded < 0 ? "↓" : "→";
  return (
    <span style={{ fontSize: "0.85rem", fontWeight: 600, color, marginLeft: "0.5rem" }}>
      {arrow} {Math.abs(rounded)}%
    </span>
  );
}

export default function LeadsConversions({ websiteId }: { websiteId: string }) {
  const supabase = createClient();
  const [metrics, setMetrics] = useState<AnalyticsMetric[] | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    // "Connected" is inferred from whether analytics_metrics has any rows,
    // not from google_connections directly — that table has no RLS policy
    // for authenticated at all (service-role only, holds raw OAuth tokens),
    // same reasoning as the traffic-summary and Search Console cards.
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const { data: rows } = await supabase
      .from("analytics_metrics")
      .select("date, conversions")
      .eq("website_id", websiteId)
      .gte("date", since)
      .order("date", { ascending: false });

    setMetrics(rows || []);
    setConnected((rows || []).length > 0);
  }, [websiteId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (metrics === null) {
    return (
      <div className="card">
        <h2>Leads &amp; Conversions</h2>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="card">
        <h2>Leads &amp; Conversions</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          Connect Google Analytics (see the Google Analytics tab) and sync it to see conversion
          data here — this reads the same "conversions" figure GA4 reports, based on whatever
          events are marked as key events in that property's own settings.
        </p>
      </div>
    );
  }

  const last7 = metrics.slice(0, 7);
  const prev7 = metrics.slice(7, 14);
  const total7d = sum(last7.map((m) => m.conversions));
  const change = percentChange(total7d, sum(prev7.map((m) => m.conversions)));

  return (
    <div className="card">
      <h2>Leads &amp; Conversions</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
        From Google Analytics' "conversions" metric — counts whatever events are marked as key
        events in this site's GA4 property (e.g. form submissions, phone clicks, if configured
        there). Not a CRM or lead list, just the count GA4 reports.
      </p>

      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.2rem" }}>Conversions (last 7 days)</p>
      <p style={{ fontSize: "1.6rem", fontWeight: 700, margin: "0 0 1rem" }}>
        {total7d}
        <ChangeBadge value={change} />
      </p>

      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.4rem" }}>Last 30 days</p>
      <MetricTrendChart points={metrics.map((m) => ({ date: m.date, value: m.conversions || 0 }))} color="#b5502e" />

      <div className="table-wrap" style={{ marginTop: "1rem" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Conversions</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.date} style={{ cursor: "default" }}>
                <td>{m.date}</td>
                <td>{m.conversions ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
