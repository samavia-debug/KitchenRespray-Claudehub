"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { computeWebsiteStatus, sslDaysRemaining } from "@/lib/monitoring/status";
import { getFindings } from "@/lib/monitoring/recommendations";
import { formatDuration } from "@/lib/monitoring/incidents";
import { rateCls, rateLcp, rateTbt } from "@/lib/monitoring/vitals";
import type { Website, HealthCheck, LinkCheck, SeoCheck, Incident, CoreWebVitalsCheck } from "@/lib/monitoring/types";
import StatusBadge from "../status-badge";
import NotConnectedCard from "../not-connected-card";
import ResponseTimeChart from "../response-time-chart";
import RunCheckButton from "./run-check-button";
import GoogleConnectionCard from "./google-connection-card";

const RANGES = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
] as const;

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

const RATING_COLOR: Record<string, string> = {
  good: "#2e7d32",
  "needs-improvement": "#b98900",
  poor: "#b3261e",
};

function VitalMetricRow({
  label,
  value,
  unit,
  rating,
  decimals = 0,
}: {
  label: string;
  value: number | null;
  unit: string;
  rating: "good" | "needs-improvement" | "poor" | null;
  decimals?: number;
}) {
  return (
    <p style={{ fontSize: "0.9rem" }}>
      <strong>{label}:</strong>{" "}
      {value !== null ? (
        <span style={{ color: rating ? RATING_COLOR[rating] : undefined, fontWeight: rating ? 600 : undefined }}>
          {value.toFixed(decimals)}
          {unit} {rating && `(${rating.replace("-", " ")})`}
        </span>
      ) : (
        "—"
      )}
    </p>
  );
}

const GOOGLE_STATUS_MESSAGE: Record<string, string> = {
  connected: "Connected successfully.",
  denied: "Connection was denied or cancelled.",
  missing_params: "Connection failed — missing parameters. Try again.",
  state_mismatch: "Connection failed — security check mismatch. Try again.",
  token_error: "Connection failed while exchanging the authorization code.",
  save_error: "Connected to Google, but saving the connection failed.",
};

export default function SiteDashboard({ websiteId }: { websiteId: string }) {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const googleStatus = searchParams.get("google");
  const googleMsg = searchParams.get("msg");
  const [website, setWebsite] = useState<Website | null>(null);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [linkChecks, setLinkChecks] = useState<LinkCheck[]>([]);
  const [seoCheck, setSeoCheck] = useState<SeoCheck | null>(null);
  const [vitalsCheck, setVitalsCheck] = useState<CoreWebVitalsCheck | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [rangeHours, setRangeHours] = useState<number>(RANGES[1].hours);

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
    setSeoCheck(data.seoCheck || null);
    setVitalsCheck(data.vitalsCheck || null);

    const { data: incidentRows } = await supabase
      .from("incidents")
      .select("*")
      .eq("website_id", websiteId)
      .order("started_at", { ascending: false })
      .limit(50);
    setIncidents(incidentRows || []);
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
  const rangeCutoff = Date.now() - rangeHours * 60 * 60 * 1000;
  const checksInRange = checks.filter((c) => new Date(c.checked_at).getTime() >= rangeCutoff);

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

      {googleStatus && (
        <div
          className="card"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
          }}
        >
          {GOOGLE_STATUS_MESSAGE[googleStatus] || `Google connection status: ${googleStatus}`}
          {googleMsg ? ` (${googleMsg})` : ""}
        </div>
      )}

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
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h2>Response time — last 7 days</h2>
            <ResponseTimeChart checks={checks.filter((c) => new Date(c.checked_at).getTime() >= Date.now() - 7 * 86_400_000)} height={110} />
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.75rem" }}>
            <h2 style={{ margin: 0 }}>Response time history</h2>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {RANGES.map((r) => (
                <button
                  key={r.hours}
                  className={rangeHours === r.hours ? "btn" : "btn-secondary btn"}
                  style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem" }}
                  onClick={() => setRangeHours(r.hours)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.5rem 0 1rem" }}>
            {checksInRange.length} check{checksInRange.length === 1 ? "" : "s"} in this range (of the last {checks.length}
            {checks.length === 100 ? "+" : ""} stored).
          </p>
          <ResponseTimeChart checks={checksInRange} height={180} />
          <div className="table-wrap" style={{ marginTop: "1.25rem" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Checked</th>
                  <th>Response time</th>
                </tr>
              </thead>
              <tbody>
                {checksInRange.map((c) => (
                  <tr key={c.id} style={{ cursor: "default" }}>
                    <td>{formatDate(c.checked_at)}</td>
                    <td>{c.response_time_ms !== null ? `${c.response_time_ms}ms` : "—"}</td>
                  </tr>
                ))}
                {checksInRange.length === 0 && (
                  <tr>
                    <td colSpan={2} style={{ textAlign: "center", color: "var(--muted)" }}>
                      No data in this range.
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
          <h2>Core Web Vitals (mobile)</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
            Google PageSpeed Insights, mobile strategy. Manually triggered — a real Lighthouse
            audit takes 15-30+ seconds and PageSpeed's free quota is limited, so this isn't run on
            the automatic monitoring schedule.
          </p>
          {canManage && (
            <div style={{ marginBottom: "1rem" }}>
              <RunCheckButton
                websiteId={website.id}
                onChecked={load}
                action="check-vitals"
                label="Check Core Web Vitals now"
                runningLabel="Running Lighthouse audit... (up to 30s)"
              />
            </div>
          )}
          {vitalsCheck ? (
            <div className="grid-2">
              <div>
                <p style={{ fontSize: "0.9rem" }}>
                  <strong>Performance score:</strong>{" "}
                  {vitalsCheck.performance_score !== null ? `${vitalsCheck.performance_score}/100` : "—"}
                </p>
                <VitalMetricRow label="LCP (Largest Contentful Paint)" value={vitalsCheck.lcp_ms} unit="ms" rating={rateLcp(vitalsCheck.lcp_ms)} />
                <VitalMetricRow label="CLS (Cumulative Layout Shift)" value={vitalsCheck.cls} unit="" rating={rateCls(vitalsCheck.cls)} decimals={3} />
                <VitalMetricRow label="TBT (Total Blocking Time, lab proxy for INP)" value={vitalsCheck.tbt_ms} unit="ms" rating={rateTbt(vitalsCheck.tbt_ms)} />
              </div>
              <div>
                <p style={{ fontSize: "0.9rem" }}>
                  Real-user field data: {vitalsCheck.has_field_data ? "available" : "not available (site doesn't have enough Chrome traffic to report)"}
                </p>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "1rem" }}>
                  Last checked: {formatDate(vitalsCheck.checked_at)}
                </p>
              </div>
            </div>
          ) : (
            <p style={{ color: "var(--muted)" }}>No Core Web Vitals check recorded yet.</p>
          )}
        </div>
      )}

      {tab === "Google Analytics" && (
        <GoogleConnectionCard websiteId={website.id} service="analytics" canManage={canManage} />
      )}

      {tab === "Search Console" && (
        <GoogleConnectionCard websiteId={website.id} service="search_console" canManage={canManage} />
      )}

      {tab === "SEO" && (
        <div className="card">
          <h2>Technical SEO spot-check</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
            Homepage + robots.txt + sitemap.xml only — a technical spot-check, not a full crawl
            or a replacement for Google Search Console (arrives separately once connected).
          </p>
          {canManage && (
            <div style={{ marginBottom: "1rem" }}>
              <RunCheckButton
                websiteId={website.id}
                onChecked={load}
                action="check-seo"
                label="Check SEO now"
                runningLabel="Checking..."
              />
            </div>
          )}
          {seoCheck ? (
            <div className="grid-2">
              <div>
                <p style={{ fontSize: "0.9rem" }}>
                  <strong>Title:</strong> {seoCheck.title || <span style={{ color: "var(--muted)" }}>Not found</span>}
                </p>
                <p style={{ fontSize: "0.9rem" }}>
                  <strong>Meta description:</strong>{" "}
                  {seoCheck.meta_description || <span style={{ color: "var(--muted)" }}>Not found</span>}
                </p>
                <p style={{ fontSize: "0.9rem" }}>
                  <strong>Canonical URL:</strong>{" "}
                  {seoCheck.canonical_url || <span style={{ color: "var(--muted)" }}>Not found</span>}
                </p>
                <p style={{ fontSize: "0.9rem", color: seoCheck.has_noindex ? "#b3261e" : undefined, fontWeight: seoCheck.has_noindex ? 600 : undefined }}>
                  <strong>Noindex:</strong> {seoCheck.has_noindex ? "Yes — this page is telling search engines not to index it" : "No"}
                </p>
              </div>
              <div>
                <p style={{ fontSize: "0.9rem", color: seoCheck.robots_txt_status !== "found" ? "#b98900" : undefined }}>
                  <strong>robots.txt:</strong> {seoCheck.robots_txt_status}
                  {seoCheck.robots_disallows_all && " — disallows all crawlers (Disallow: /)"}
                </p>
                <p style={{ fontSize: "0.9rem", color: seoCheck.sitemap_status !== "found" ? "#b98900" : undefined }}>
                  <strong>sitemap.xml:</strong> {seoCheck.sitemap_status}
                </p>
                <p style={{ fontSize: "0.9rem" }}>
                  <strong>Sitemap referenced in robots.txt:</strong> {seoCheck.sitemap_in_robots ? "Yes" : "No"}
                </p>
                <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "1rem" }}>
                  Last checked: {formatDate(seoCheck.checked_at)}
                </p>
              </div>
            </div>
          ) : (
            <p style={{ color: "var(--muted)" }}>No SEO check recorded yet.</p>
          )}
        </div>
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
            </>
          ) : (
            <p style={{ color: "var(--muted)" }}>No checks recorded yet.</p>
          )}

          <h2 style={{ marginTop: "1.5rem" }}>Domain expiry</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
            Looked up via RDAP (free, no account needed) — not every registry publishes this data,
            particularly some ccTLDs, so "not available" is an expected outcome for some domains,
            not an error.
          </p>
          {canManage && (
            <div style={{ marginBottom: "1rem" }}>
              <RunCheckButton
                websiteId={website.id}
                onChecked={load}
                action="check-domain"
                label="Check domain expiry now"
                runningLabel="Checking..."
              />
            </div>
          )}
          {website.domain_expiry_checked_at ? (
            website.domain_expiry_unavailable ? (
              <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
                Not available for this domain's registry.
              </p>
            ) : (
              <p style={{ fontSize: "0.9rem" }}>
                Domain expires: {formatDate(website.domain_expires_at)}
                {(() => {
                  const days = website.domain_expires_at
                    ? Math.floor((new Date(website.domain_expires_at).getTime() - Date.now()) / 86_400_000)
                    : null;
                  return days !== null ? ` (${days} day${days === 1 ? "" : "s"} remaining)` : "";
                })()}
              </p>
            )
          ) : (
            <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Not checked yet.</p>
          )}
        </div>
      )}

      {tab === "Alerts" && (
        <div className="card">
          <h2>Incident history</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
            Per-channel notification rules (Slack/email/Teams) and manual assignment arrive in a
            later phase — this is the real incident timeline for this site today.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Checks confirming</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((i) => (
                  <tr key={i.id} style={{ cursor: "default" }}>
                    <td style={{ textTransform: "capitalize", color: i.severity === "offline" ? "#6f6a63" : "#b3261e", fontWeight: 600 }}>
                      {i.severity}
                    </td>
                    <td>{formatDate(i.started_at)}</td>
                    <td>
                      {i.resolved_at ? (
                        <span style={{ color: "#2e7d32", fontWeight: 600 }}>Resolved {formatDate(i.resolved_at)}</span>
                      ) : (
                        <span style={{ color: "#b3261e", fontWeight: 600 }}>Still open</span>
                      )}
                    </td>
                    <td>{formatDuration(i.started_at, i.resolved_at)}</td>
                    <td>{i.detection_count}</td>
                  </tr>
                ))}
                {incidents.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)" }}>
                      No incidents recorded for this site yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "Claude Analysis" && (
        <NotConnectedCard title="Claude Analysis" phaseNote="the 'Analyse with Claude' action arrives in Phase 8, once enough metrics (GA4, GSC, SEO) are flowing in to give Claude something real to interpret." />
      )}
    </>
  );
}
