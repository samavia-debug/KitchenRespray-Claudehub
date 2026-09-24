"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Row = {
  website_id: string;
  name: string;
  domain: string;
  conversions7d: number;
  conversionsPrev7d: number;
  hasData: boolean;
};

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
    <span style={{ fontSize: "0.8rem", fontWeight: 600, color, marginLeft: "0.4rem" }}>
      {arrow} {Math.abs(rounded)}%
    </span>
  );
}

export default function LeadsPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const since14 = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

    const [{ data: websites, error: websitesError }, { data: am }] = await Promise.all([
      supabase.from("websites").select("id, name, domain").order("name", { ascending: true }),
      supabase.from("analytics_metrics").select("website_id, date, conversions").gte("date", since14),
    ]);

    if (websitesError) {
      setError(websitesError.message);
      return;
    }

    const byWebsite = new Map<string, typeof am>();
    (am || []).forEach((r: any) => {
      const list = byWebsite.get(r.website_id) || [];
      list.push(r);
      byWebsite.set(r.website_id, list);
    });

    const merged: Row[] = (websites || []).map((w: any) => {
      const wRows = byWebsite.get(w.id) || [];
      const last7 = wRows.filter((r: any) => r.date >= since7);
      const prev7 = wRows.filter((r: any) => r.date < since7);
      return {
        website_id: w.id,
        name: w.name,
        domain: w.domain,
        conversions7d: sum(last7.map((r: any) => r.conversions)),
        conversionsPrev7d: sum(prev7.map((r: any) => r.conversions)),
        // Connected/synced iff any analytics_metrics rows exist at all —
        // NOT conversions > 0, since a site with real zero leads is exactly
        // what this page should surface, not hide as "not connected".
        hasData: wRows.length > 0,
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
          <h1>Leads</h1>
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
          <h1>Leads</h1>
        </div>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </>
    );
  }

  // "Connected" means analytics data exists at all in the last 14 days,
  // not that conversions are non-zero — a site with real zero leads is
  // exactly the kind of thing this page should surface, not hide.
  const connectedRows = rows.filter((r) => r.hasData);
  const zeroLeadRows = connectedRows.filter((r) => r.conversions7d === 0);
  const sorted = [...connectedRows].sort((a, b) => b.conversions7d - a.conversions7d);

  const total7d = sum(connectedRows.map((r) => r.conversions7d));
  const totalPrev7d = sum(connectedRows.map((r) => r.conversionsPrev7d));
  const totalChange = percentChange(total7d, totalPrev7d);

  return (
    <>
      <div className="page-header">
        <h1>Leads</h1>
        <p>
          Google Analytics conversions — whatever events are marked as key events in each site's
          GA4 property (e.g. form submissions, phone clicks, if configured there). Not a CRM or
          lead list, just what GA4 reports, across every connected site.
        </p>
      </div>

      <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
        <div className="stat-card">
          <div className="stat-value">
            {total7d}
            <ChangeBadge value={totalChange} />
          </div>
          <div className="stat-label">Total conversions (7 days)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{connectedRows.length}</div>
          <div className="stat-label">Sites with Analytics data</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: zeroLeadRows.length > 0 ? "#b98900" : undefined }}>
            {zeroLeadRows.length}
          </div>
          <div className="stat-label">Sites with zero leads this week</div>
        </div>
      </div>

      <div className="card">
        <h2>Per-site breakdown</h2>
        {connectedRows.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            No sites connected to Google Analytics yet — connect and sync from the Monitoring
            dashboard's "Traffic &amp; Search" card, or from an individual site's detail page.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Conversions (7 days)</th>
                  <th>Previous 7 days</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.website_id} style={{ cursor: "default" }}>
                    <td>
                      <Link href={`/dashboard/monitoring/${r.website_id}`}>{r.name}</Link>
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{r.domain}</div>
                    </td>
                    <td style={{ color: r.conversions7d === 0 ? "#b98900" : undefined, fontWeight: r.conversions7d === 0 ? 600 : undefined }}>
                      {r.conversions7d}
                      <ChangeBadge value={percentChange(r.conversions7d, r.conversionsPrev7d)} />
                    </td>
                    <td>{r.conversionsPrev7d}</td>
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
