"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type RiskLevel = "none" | "suspicious" | "critical";

type SiteRow = {
  id: string;
  name: string;
  domain: string;
  check: {
    risk_level: RiskLevel;
    final_url: string | null;
    flagged_keywords: string[];
    checked_at: string;
  } | null;
};

const RISK_LABEL: Record<RiskLevel | "unscanned", string> = {
  none: "Clean",
  suspicious: "Suspicious",
  critical: "Likely hijacked",
  unscanned: "Not scanned yet",
};

const RISK_COLOR: Record<RiskLevel | "unscanned", string> = {
  none: "#2e7d32",
  suspicious: "#b98900",
  critical: "#b3261e",
  unscanned: "#6f6a63",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function SecurityPage() {
  const supabase = createClient();
  const router = useRouter();
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "flagged">("all");

  const load = useCallback(async () => {
    setError(null);
    const [{ data: websites, error: websitesError }, { data: checks }] = await Promise.all([
      supabase.from("websites").select("id, name, domain").order("name", { ascending: true }),
      supabase.from("website_security_checks").select("website_id, risk_level, final_url, flagged_keywords, checked_at"),
    ]);

    if (websitesError) {
      setError(websitesError.message);
      return;
    }

    const checkByWebsite = new Map((checks || []).map((c: any) => [c.website_id, c]));
    setSites((websites || []).map((w) => ({ ...w, check: checkByWebsite.get(w.id) || null })));
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!sites) return [];
    if (filter === "flagged") return sites.filter((s) => s.check && s.check.risk_level !== "none");
    return sites;
  }, [sites, filter]);

  const flaggedCount = sites?.filter((s) => s.check && s.check.risk_level !== "none").length ?? 0;
  const criticalCount = sites?.filter((s) => s.check?.risk_level === "critical").length ?? 0;
  const scannedCount = sites?.filter((s) => s.check).length ?? 0;

  return (
    <>
      <div className="page-header">
        <h1>Security</h1>
        <p>
          Site-hijack detection across every monitored website — does the homepage redirect to a different
          domain, and does it match known spam/gambling content. Runs automatically every 6 hours per site.
        </p>
      </div>

      {error && (
        <div className="card">
          <p className="error-text">Failed to load: {error}</p>
        </div>
      )}

      {!sites && !error && <p style={{ color: "var(--muted)" }}>Loading...</p>}

      {sites && (
        <>
          <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
            <div className="stat-card">
              <div className="stat-value">{sites.length}</div>
              <div className="stat-label">Total sites</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{scannedCount}</div>
              <div className="stat-label">Scanned so far</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: flaggedCount > 0 ? "#b98900" : "#2e7d32" }}>{flaggedCount}</div>
              <div className="stat-label">Flagged</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: criticalCount > 0 ? "#b3261e" : undefined }}>{criticalCount}</div>
              <div className="stat-label">Likely hijacked</div>
            </div>
          </div>

          <div className="card">
            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.1rem", alignItems: "center" }}>
              <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ maxWidth: "220px" }}>
                <option value="all">All sites</option>
                <option value="flagged">Flagged only ({flaggedCount})</option>
              </select>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Website</th>
                    <th>Status</th>
                    <th>Details</th>
                    <th>Last checked</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((site) => {
                    const level: RiskLevel | "unscanned" = site.check?.risk_level || "unscanned";
                    return (
                      <tr key={site.id} onClick={() => router.push(`/dashboard/monitoring/${site.id}`)}>
                        <td>
                          <strong>{site.name}</strong>
                          <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{site.domain}</div>
                        </td>
                        <td style={{ color: RISK_COLOR[level], fontWeight: 600 }}>{RISK_LABEL[level]}</td>
                        <td style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                          {site.check?.risk_level === "critical" && `Redirects to ${site.check.final_url || "a different domain"}`}
                          {site.check?.risk_level === "suspicious" && `Flagged: ${site.check.flagged_keywords.join(", ")}`}
                          {(!site.check || site.check.risk_level === "none") && "—"}
                        </td>
                        <td>{formatDate(site.check?.checked_at || null)}</td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", color: "var(--muted)" }}>
                        No sites {filter === "flagged" ? "currently flagged" : "found"}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
