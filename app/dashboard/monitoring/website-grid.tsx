"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { WebsiteWithHealth, WebsiteStatus } from "@/lib/monitoring/types";
import StatusBadge from "./status-badge";

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

export default function WebsiteGrid({ websites }: { websites: WebsiteWithHealth[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<WebsiteStatus | "all">("all");

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
              return (
                <tr key={w.id} onClick={() => router.push(`/dashboard/monitoring/${w.id}`)}>
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
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", color: "var(--muted)" }}>
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
