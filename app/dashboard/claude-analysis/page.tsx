"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Row = {
  website_id: string;
  name: string;
  domain: string;
  priority: string;
  analysis: string | null;
  created_at: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "Never analysed";
  return new Date(iso).toLocaleString();
}

function excerpt(text: string | null, maxLength: number = 220): string {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
}

export default function ClaudeAnalysisPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [{ data: websites, error: websitesError }, { data: analyses }] = await Promise.all([
      supabase.from("websites").select("id, name, domain, priority").order("name", { ascending: true }),
      supabase.from("claude_analyses").select("website_id, analysis, created_at"),
    ]);

    if (websitesError) {
      setError(websitesError.message);
      return;
    }

    const analysisByWebsite = new Map((analyses || []).map((a: any) => [a.website_id, a]));
    const merged: Row[] = (websites || []).map((w: any) => {
      const a = analysisByWebsite.get(w.id);
      return {
        website_id: w.id,
        name: w.name,
        domain: w.domain,
        priority: w.priority,
        analysis: a?.analysis || null,
        created_at: a?.created_at || null,
      };
    });

    // Never-analysed sites first (most actionable), then most recently analysed.
    merged.sort((a, b) => {
      if (!a.created_at && !b.created_at) return a.name.localeCompare(b.name);
      if (!a.created_at) return -1;
      if (!b.created_at) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
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
          <h1>Claude Analysis</h1>
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
          <h1>Claude Analysis</h1>
        </div>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </>
    );
  }

  const analysed = rows.filter((r) => r.created_at);
  const notAnalysed = rows.filter((r) => !r.created_at);

  return (
    <>
      <div className="page-header">
        <h1>Claude Analysis</h1>
        <p>
          Claude reads each site's real monitoring data and explains what it means — it doesn't
          collect data itself, only interprets what's already been gathered. Run or re-run from
          each site's own Claude Analysis tab.
        </p>
      </div>

      <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
        <div className="stat-card">
          <div className="stat-value">{rows.length}</div>
          <div className="stat-label">Total websites</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "#2e7d32" }}>{analysed.length}</div>
          <div className="stat-label">Analysed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: notAnalysed.length > 0 ? "#b98900" : undefined }}>
            {notAnalysed.length}
          </div>
          <div className="stat-label">Never analysed</div>
        </div>
      </div>

      <div className="card">
        <h2>All sites</h2>
        {rows.map((r) => (
          <div key={r.website_id} style={{ padding: "0.85rem 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                <Link href={`/dashboard/monitoring/${r.website_id}`} style={{ fontWeight: 600 }}>
                  {r.name}
                </Link>
                <span style={{ color: "var(--muted)", fontSize: "0.85rem", marginLeft: "0.5rem" }}>{r.domain}</span>
              </div>
              <span style={{ color: r.created_at ? "var(--muted)" : "#b98900", fontSize: "0.85rem", fontWeight: r.created_at ? undefined : 600 }}>
                {formatDate(r.created_at)}
              </span>
            </div>
            {r.analysis && (
              <p style={{ fontSize: "0.88rem", color: "var(--muted)", margin: "0.4rem 0 0" }}>{excerpt(r.analysis)}</p>
            )}
          </div>
        ))}
        {rows.length === 0 && <p style={{ color: "var(--muted)" }}>No websites yet.</p>}
      </div>
    </>
  );
}
