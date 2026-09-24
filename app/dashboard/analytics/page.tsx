"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Row = {
  website_id: string;
  name: string;
  domain: string;
  sessions: number;
  users: number;
  conversions: number;
  clicks: number;
  impressions: number;
};

type SortKey = "sessions" | "users" | "conversions" | "clicks" | "impressions";

function sum(values: (number | null)[]): number {
  return values.reduce((total: number, v) => total + (v || 0), 0);
}

export default function AnalyticsPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("sessions");

  const load = useCallback(async () => {
    setError(null);
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    const [{ data: websites, error: websitesError }, { data: am }, { data: scm }] = await Promise.all([
      supabase.from("websites").select("id, name, domain").order("name", { ascending: true }),
      supabase.from("analytics_metrics").select("website_id, sessions, users, conversions").gte("date", since),
      supabase.from("search_console_metrics").select("website_id, clicks, impressions").gte("date", since),
    ]);

    if (websitesError) {
      setError(websitesError.message);
      return;
    }

    const amByWebsite = new Map<string, typeof am>();
    (am || []).forEach((r: any) => {
      const list = amByWebsite.get(r.website_id) || [];
      list.push(r);
      amByWebsite.set(r.website_id, list);
    });
    const scmByWebsite = new Map<string, typeof scm>();
    (scm || []).forEach((r: any) => {
      const list = scmByWebsite.get(r.website_id) || [];
      list.push(r);
      scmByWebsite.set(r.website_id, list);
    });

    const merged: Row[] = (websites || []).map((w: any) => {
      const amRows = amByWebsite.get(w.id) || [];
      const scmRows = scmByWebsite.get(w.id) || [];
      return {
        website_id: w.id,
        name: w.name,
        domain: w.domain,
        sessions: sum(amRows.map((r: any) => r.sessions)),
        users: sum(amRows.map((r: any) => r.users)),
        conversions: sum(amRows.map((r: any) => r.conversions)),
        clicks: sum(scmRows.map((r: any) => r.clicks)),
        impressions: sum(scmRows.map((r: any) => r.impressions)),
      };
    });

    setRows(merged);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <>
        <div className="page-header">
          <h1>Analytics</h1>
        </div>
        <div className="card">
          <p className="error-text">Failed to load: {error}</p>
        </div>
      </>
    );
  }

  if (!rows) {
    return (
      <>
        <div className="page-header">
          <h1>Analytics</h1>
        </div>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </>
    );
  }

  const connectedRows = rows.filter((r) => r.sessions > 0 || r.users > 0 || r.clicks > 0 || r.impressions > 0);
  const sorted = [...connectedRows].sort((a, b) => b[sortKey] - a[sortKey]);

  const totals = {
    sessions: sum(connectedRows.map((r) => r.sessions)),
    users: sum(connectedRows.map((r) => r.users)),
    conversions: sum(connectedRows.map((r) => r.conversions)),
    clicks: sum(connectedRows.map((r) => r.clicks)),
    impressions: sum(connectedRows.map((r) => r.impressions)),
  };

  const columns: { key: SortKey; label: string }[] = [
    { key: "sessions", label: "Sessions" },
    { key: "users", label: "Users" },
    { key: "conversions", label: "Conversions" },
    { key: "clicks", label: "Search clicks" },
    { key: "impressions", label: "Search impressions" },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Analytics</h1>
        <p>Google Analytics &amp; Search Console — last 7 days, across every connected site.</p>
      </div>

      <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
        <div className="stat-card">
          <div className="stat-value">{connectedRows.length}</div>
          <div className="stat-label">Sites connected</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totals.sessions}</div>
          <div className="stat-label">Total sessions</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totals.conversions}</div>
          <div className="stat-label">Total conversions</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totals.clicks}</div>
          <div className="stat-label">Total search clicks</div>
        </div>
      </div>

      <div className="card">
        <h2>Per-site breakdown</h2>
        {connectedRows.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            No sites connected to Google yet — connect and sync from the Monitoring dashboard's
            "Traffic &amp; Search" card, or from an individual site's detail page.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Site</th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => setSortKey(c.key)}
                      style={{ cursor: "pointer", fontWeight: sortKey === c.key ? 700 : undefined }}
                    >
                      {c.label} {sortKey === c.key ? "▼" : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.website_id} style={{ cursor: "default" }}>
                    <td>
                      <Link href={`/dashboard/monitoring/${r.website_id}`}>{r.name}</Link>
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{r.domain}</div>
                    </td>
                    <td>{r.sessions}</td>
                    <td>{r.users}</td>
                    <td>{r.conversions}</td>
                    <td>{r.clicks}</td>
                    <td>{r.impressions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
