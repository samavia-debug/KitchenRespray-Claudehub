"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { computeWebsiteStatus, sslDaysRemaining } from "@/lib/monitoring/status";
import { getFindings } from "@/lib/monitoring/recommendations";
import type { Website, HealthCheck, LinkCheck } from "@/lib/monitoring/types";
import StatusBadge from "../status-badge";
import NotConnectedCard from "../not-connected-card";
import RunCheckButton from "./run-check-button";

const TABS = [
  "Overview",
  "Website Health",
  "Broken Links",
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
  const [linkChecks, setLinkChecks] = useState<LinkCheck[]>([]);
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
    setLinkChecks(data.linkChecks || []);
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
            <h2>Findings &amp; recommended actions</h2>
            {getFindings(status, latestCheck).map((f, i) => (
              <div key={i} style={{ marginBottom: i === 0 ? "0" : "0.9rem" }}>
                <p style={{ fontSize: "0.9rem", margin: "0 0 0.3rem" }}>{f.finding}</p>
                {f.recommendedActions.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                    {f.recommendedActions.map((a, j) => (
                      <li key={j} style={{ fontSize: "0.83rem", color: "var(--muted)" }}>
                        {a}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.9rem" }}>
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
            <p style={{ fontSize: "0.9rem" }}>
              Broken links: {linkChecks.filter((l) => l.is_broken).length} of {linkChecks.length} checked
            </p>
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
                    <td style={{ color: "var(--muted)" }}>
                      {c.likely_blocked
                        ? "Likely WAF/bot-protection block"
                        : c.error_message || "—"}
                    </td>
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

      {tab === "Broken Links" && (
        <div className="card">
          <h2>Broken link scan (homepage)</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
            Checks every link found on the homepage (up to 25), internal and external. Not a
            full-site crawl — deeper crawling is a later phase.
          </p>
          {canManage && (
            <div style={{ marginBottom: "1rem" }}>
              <RunCheckButton
                websiteId={website.id}
                onChecked={load}
                action="check-links"
                label="Check links now"
                runningLabel="Checking links..."
              />
            </div>
          )}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Link</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>First detected</th>
                  <th>Last checked</th>
                </tr>
              </thead>
              <tbody>
                {linkChecks.map((l) => (
                  <tr key={l.id} style={{ cursor: "default" }}>
                    <td style={{ maxWidth: "360px", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <a href={l.target_url} target="_blank" rel="noreferrer">
                        {l.target_url}
                      </a>
                    </td>
                    <td style={{ textTransform: "capitalize" }}>{l.link_type}</td>
                    <td style={{ color: l.is_broken ? "#b3261e" : undefined, fontWeight: l.is_broken ? 600 : undefined }}>
                      {l.http_status ?? "No response"}
                      {l.error_message ? ` — ${l.error_message}` : ""}
                    </td>
                    <td>{formatDate(l.first_detected_at)}</td>
                    <td>{formatDate(l.last_checked_at)}</td>
                  </tr>
                ))}
                {linkChecks.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>
                      No link scan recorded yet.
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
        <NotConnectedCard
          title="Alerts"
          phaseNote="persisted incidents with assignment & resolution notes, and per-channel notification rules, arrive in a later phase. The Command Centre's Priority Alerts panel already ranks this site's open findings by priority x severity today — see the Overview tab for this site's specific findings and recommended actions."
        />
      )}

      {tab === "Claude Analysis" && (
        <NotConnectedCard title="Claude Analysis" phaseNote="the 'Analyse with Claude' action arrives in Phase 8, once enough metrics (GA4, GSC, SEO) are flowing in to give Claude something real to interpret." />
      )}
    </>
  );
}
