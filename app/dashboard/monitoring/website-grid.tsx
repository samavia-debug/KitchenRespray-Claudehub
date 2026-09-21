"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { WebsiteWithHealth, WebsiteStatus, HealthCheck, LinkCheck } from "@/lib/monitoring/types";
import { getFindings } from "@/lib/monitoring/recommendations";
import StatusBadge from "./status-badge";
import ResponseTimeChart from "./response-time-chart";

const STATUS_FILTERS: (WebsiteStatus | "all")[] = ["all", "healthy", "attention", "critical", "offline", "unknown"];

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type RowDetail = { checks: HealthCheck[]; linkChecks: LinkCheck[] };

export default function WebsiteGrid({ websites }: { websites: WebsiteWithHealth[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<WebsiteStatus | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, RowDetail | "loading" | "error">>({});

  const filtered = useMemo(() => {
    return websites.filter((w) => {
      if (statusFilter !== "all" && w.status !== statusFilter) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        w.name.toLowerCase().includes(q) ||
        w.domain.toLowerCase().includes(q) ||
        (w.category || "").toLowerCase().includes(q)
      );
    });
  }, [websites, query, statusFilter]);

  async function toggleRow(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!details[id]) {
      setDetails((prev) => ({ ...prev, [id]: "loading" }));
      try {
        const res = await fetch(`/api/monitoring/websites/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load");
        setDetails((prev) => ({ ...prev, [id]: { checks: data.checks || [], linkChecks: data.linkChecks || [] } }));
      } catch {
        setDetails((prev) => ({ ...prev, [id]: "error" }));
      }
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.1rem", flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, domain, or category..."
          style={{ maxWidth: "320px" }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as WebsiteStatus | "all")}
          style={{ maxWidth: "200px" }}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th></th>
              <th>Website</th>
              <th>Category</th>
              <th>Status</th>
              <th>Uptime (7d)</th>
              <th>Response</th>
              <th>SSL</th>
              <th>Priority</th>
              <th>Issues</th>
              <th>Last checked</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => {
              const issueCount =
                (w.status === "critical" || w.status === "attention" || w.status === "offline" ? 1 : 0) +
                w.brokenLinkCount;
              const isOpen = expandedId === w.id;
              const detail = details[w.id];

              return (
                <Fragment key={w.id}>
                  <tr onClick={() => toggleRow(w.id)}>
                    <td style={{ color: "var(--muted)", width: "1.5rem" }}>{isOpen ? "▾" : "▸"}</td>
                    <td>
                      <strong>{w.name}</strong>
                      <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{w.domain}</div>
                    </td>
                    <td style={{ color: "var(--muted)" }}>{w.category || "—"}</td>
                    <td>
                      <StatusBadge status={w.status} />
                    </td>
                    <td>{w.uptimePercent7d !== null ? `${w.uptimePercent7d}%` : "—"}</td>
                    <td>
                      {w.latestCheck?.response_time_ms !== null && w.latestCheck?.response_time_ms !== undefined
                        ? `${w.latestCheck.response_time_ms}ms`
                        : "—"}
                    </td>
                    <td>
                      {w.latestCheck?.ssl_valid === false
                        ? "Invalid"
                        : w.latestCheck?.ssl_valid
                        ? "Valid"
                        : "—"}
                    </td>
                    <td style={{ textTransform: "capitalize" }}>{w.priority}</td>
                    <td>
                      {issueCount > 0 ? (
                        <span style={{ color: "#b3261e", fontWeight: 600 }}>
                          {issueCount}
                          {w.latestCheck?.likely_blocked ? " · blocked?" : ""}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>0</span>
                      )}
                    </td>
                    <td style={{ color: "var(--muted)" }}>{timeAgo(w.latestCheck?.checked_at || null)}</td>
                  </tr>
                  {isOpen && (
                    <tr style={{ cursor: "default" }} onClick={(e) => e.stopPropagation()}>
                      <td colSpan={10} style={{ background: "var(--paper)", whiteSpace: "normal" }}>
                        <div style={{ padding: "1rem 0.5rem" }}>
                          {detail === "loading" && <p style={{ color: "var(--muted)" }}>Loading details...</p>}
                          {detail === "error" && <p className="error-text">Failed to load details.</p>}
                          {detail && detail !== "loading" && detail !== "error" && (
                            <div className="grid-2">
                              <div>
                                <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Findings &amp; recommended actions</h3>
                                {getFindings(w.status, w.latestCheck).map((f, i) => (
                                  <div key={i} style={{ marginBottom: "0.7rem" }}>
                                    <p style={{ margin: "0 0 0.25rem", fontSize: "0.85rem" }}>{f.finding}</p>
                                    {f.recommendedActions.length > 0 && (
                                      <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                                        {f.recommendedActions.map((a, j) => (
                                          <li key={j} style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                                            {a}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                ))}
                                {detail.linkChecks.filter((l) => l.is_broken).length > 0 && (
                                  <p style={{ fontSize: "0.85rem", color: "#b3261e", fontWeight: 600 }}>
                                    {detail.linkChecks.filter((l) => l.is_broken).length} broken link
                                    {detail.linkChecks.filter((l) => l.is_broken).length === 1 ? "" : "s"} on the homepage
                                  </p>
                                )}
                                <Link
                                  href={`/dashboard/monitoring/${w.id}`}
                                  style={{ fontSize: "0.85rem", color: "var(--accent)", fontWeight: 600 }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Open full details →
                                </Link>
                              </div>
                              <div>
                                <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Response time (recent checks)</h3>
                                <ResponseTimeChart checks={detail.checks} height={100} />
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", color: "var(--muted)" }}>
                  No websites match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
