"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { computeWebsiteStatus, sslDaysRemaining } from "@/lib/monitoring/status";
import { describeStatus } from "@/lib/monitoring/alerts";
import type { Website, HealthCheck } from "@/lib/monitoring/types";
import StatusBadge from "../status-badge";
import NotConnectedCard from "../not-connected-card";
import RunCheckButton from "./run-check-button";

const TABS = [
  "Overview",
  "Website Health",
  "Performance",
  "Google Analytics",
  "Search Console",
  "SEO",
  "Leads & Conversions",
  "WordPress",
  "SSL & Domain",
  "Alerts",
  "Claude Analysis",
] as const;

type Tab = (typeof TABS)[number];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function SiteDashboard({ websiteId }: { websiteId: string }) {
  const supabase = createClient();
  const [website, setWebsite] = useState<Website | null>(null);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");

  const load = useCallback(async () => {
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setCanManage(profile?.role === "Admin" || profile?.role === "Manager");
    }

    const res = await fetch(`/api/monitoring/websites/${websiteId}`);
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Failed to load website");
      return;
    }

    setWebsite(data.website);
    setChecks(data.checks || []);
  }, [supabase, websiteId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="card">
        <p className="error-text">{error}</p>
        <Link href="/dashboard/monitoring" className="btn-secondary btn">
          Back to Command Centre
        </Link>
      </div>
    );
  }

  if (!website) {
    return <p style={{ color: "var(--muted)" }}>Loading...</p>;
  }

  const latestCheck = checks[0] || null;
  const status = computeWebsiteStatus(latestCheck);
  const sslDays = sslDaysRemaining(latestCheck?.ssl_expires_at || null);

  return (
    <>
      <div className="page-header">
        <Link href="/dashboard/monitoring" style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          ← Command Centre
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.4rem" }}>
          <h1 style={{ margin: 0 }}>{website.name}</h1>
          <StatusBadge status={status} />
        </div>
        <p>
          <a href={`https://${website.domain}`} target="_blank" rel="noreferrer">
            {website.domain}
          </a>
          {website.category ? ` · ${website.category}` : ""}
        </p>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid-2">
          <div className="card">
            <h2>Status</h2>
            <p style={{ fontSize: "0.9rem" }}>{describeStatus(status, latestCheck)}</p>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              Last checked: {formatDate(latestCheck?.checked_at || null)}
            </p>
            {canManage && <RunCheckButton websiteId={website.id} onChecked={load} />}
          </div>
          <div className="card">
            <h2>Details</h2>
            <p style={{ fontSize: "0.9rem" }}>Priority: <span style={{ textTransform: "capitalize" }}>{website.priority}</span></p>
            <p style={{ fontSize: "0.9rem" }}>
              Monitoring interval: every {website.monitoring_interval_minutes} minutes
            </p>
            <p style={{ fontSize: "0.9rem" }}>Active: {website.is_active ? "Yes" : "No"}</p>
          </div>
        </div>
      )}

      {tab === "Website Health" && (
        <div className="card">
          <h2>Health check history</h2>
          {canManage && (
            <div style={{ marginBottom: "1rem" }}>
              <RunCheckButton websiteId={website.id} onChecked={load} />
            </div>
          )}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Checked</th>
                  <th>Status</th>
                  <th>HTTP</th>
                  <th>Response</th>
                  <th>SSL valid</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id} style={{ cursor: "default" }}>
                    <td>{formatDate(c.checked_at)}</td>
                    <td>{c.is_up ? "Up" : "Down"}</td>
                    <td>{c.http_status ?? "—"}</td>
                    <td>{c.response_time_ms !== null ? `${c.response_time_ms}ms` : "—"}</td>
                    <td>{c.ssl_valid === null ? "—" : c.ssl_valid ? "Yes" : "No"}</td>
                    <td style={{ color: "var(--muted)" }}>{c.error_message || "—"}</td>
                  </tr>
                ))}
                {checks.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)" }}>
                      No checks recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "Performance" && (
        <div className="card">
          <h2>Response time history</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
            Trailing {checks.length} checks. Core Web Vitals arrive with a dedicated performance
            provider in a later phase.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Checked</th>
                  <th>Response time</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id} style={{ cursor: "default" }}>
                    <td>{formatDate(c.checked_at)}</td>
                    <td>{c.response_time_ms !== null ? `${c.response_time_ms}ms` : "—"}</td>
                  </tr>
                ))}
                {checks.length === 0 && (
                  <tr>
                    <td colSpan={2} style={{ textAlign: "center", color: "var(--muted)" }}>
                      No data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "Google Analytics" && (
        <NotConnectedCard title="Google Analytics" phaseNote="arrives in Phase 3 (GA4 integration)." />
      )}

      {tab === "Search Console" && (
        <NotConnectedCard title="Google Search Console" phaseNote="arrives in Phase 4 (Search Console integration)." />
      )}

      {tab === "SEO" && (
        <NotConnectedCard title="SEO" phaseNote="arrives in Phase 5 (SEO provider integration layer)." />
      )}

      {tab === "Leads & Conversions" && (
        <NotConnectedCard title="Leads & Conversions" phaseNote="arrives in Phase 6." />
      )}

      {tab === "WordPress" && (
        <NotConnectedCard title="WordPress" phaseNote="arrives once read-only WordPress credentials are connected for this site." />
      )}

      {tab === "SSL & Domain" && (
        <div className="card">
          <h2>SSL & Domain</h2>
          {latestCheck ? (
            <>
              <p style={{ fontSize: "0.9rem" }}>SSL valid: {latestCheck.ssl_valid ? "Yes" : "No"}</p>
              <p style={{ fontSize: "0.9rem" }}>
                SSL expires: {formatDate(latestCheck.ssl_expires_at)}
                {sslDays !== null ? ` (${sslDays} day${sslDays === 1 ? "" : "s"} remaining)` : ""}
              </p>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "1rem" }}>
                Domain expiry tracking requires a connected registrar/WHOIS provider — not yet
                connected.
              </p>
            </>
          ) : (
            <p style={{ color: "var(--muted)" }}>No checks recorded yet.</p>
          )}
        </div>
      )}

      {tab === "Alerts" && (
        <NotConnectedCard title="Alerts" phaseNote="the centralized alert system (with assignment & resolution notes) arrives in Phase 7. The Command Centre already surfaces critical/offline status for this site today." />
      )}

      {tab === "Claude Analysis" && (
        <NotConnectedCard title="Claude Analysis" phaseNote="the 'Analyse with Claude' action arrives in Phase 8, once enough metrics (GA4, GSC, SEO) are flowing in to give Claude something real to interpret." />
      )}
    </>
  );
}
