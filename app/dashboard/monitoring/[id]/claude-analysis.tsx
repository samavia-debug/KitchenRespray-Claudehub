"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Analysis = { analysis: string; model: string; created_at: string };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function ClaudeAnalysis({ websiteId, canManage }: { websiteId: string; canManage: boolean }) {
  const supabase = createClient();
  const [record, setRecord] = useState<Analysis | null | "loading">("loading");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("claude_analyses")
      .select("analysis, model, created_at")
      .eq("website_id", websiteId)
      .maybeSingle();
    setRecord(data || null);
  }, [websiteId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`/api/monitoring/websites/${websiteId}/analyze`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Analysis failed");
      } else {
        await load();
      }
    } catch (err: any) {
      setError(err.message);
    }
    setAnalyzing(false);
  }

  return (
    <div className="card">
      <h2>Claude Analysis</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
        Claude reads this site's real monitoring data (health, SEO, Core Web Vitals, WordPress,
        incidents, Analytics/Search Console) and explains what it means — it doesn't collect data
        itself, only interprets what's already been gathered. Manually triggered, same as Core Web
        Vitals — each run is a real API call.
      </p>

      {error && <p className="error-text">{error}</p>}

      {canManage && (
        <div style={{ marginBottom: "1rem" }}>
          <button className="btn" onClick={analyze} disabled={analyzing}>
            {analyzing ? "Analysing... (a few seconds)" : record && record !== "loading" ? "Re-analyse" : "Analyse with Claude"}
          </button>
        </div>
      )}

      {record === "loading" ? (
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      ) : record ? (
        <>
          <div
            style={{
              whiteSpace: "pre-wrap",
              fontSize: "0.92rem",
              lineHeight: 1.6,
              background: "var(--paper)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "1rem",
            }}
          >
            {record.analysis}
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.75rem" }}>
            Analysed: {formatDate(record.created_at)}
          </p>
        </>
      ) : (
        <p style={{ color: "var(--muted)" }}>
          {canManage ? "No analysis yet — click Analyse with Claude above." : "No analysis yet."}
        </p>
      )}
    </div>
  );
}
