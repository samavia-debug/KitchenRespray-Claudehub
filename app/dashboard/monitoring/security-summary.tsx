"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type FlaggedSite = {
  website_id: string;
  name: string;
  domain: string;
  risk_level: "suspicious" | "critical";
  final_url: string | null;
  flagged_keywords: string[];
  checked_at: string;
};

export default function SecuritySummary() {
  const supabase = createClient();
  const [flagged, setFlagged] = useState<FlaggedSite[] | null>(null);
  const [totalScanned, setTotalScanned] = useState(0);

  const load = useCallback(async () => {
    const [{ data: checks }, { data: websites }] = await Promise.all([
      supabase
        .from("website_security_checks")
        .select("website_id, risk_level, final_url, flagged_keywords, checked_at")
        .neq("risk_level", "none"),
      supabase.from("websites").select("id, name, domain"),
    ]);

    const { count } = await supabase.from("website_security_checks").select("website_id", { count: "exact", head: true });
    setTotalScanned(count || 0);

    const nameById = new Map((websites || []).map((w) => [w.id, w]));
    const merged = (checks || [])
      .map((c: any) => {
        const w = nameById.get(c.website_id);
        return w ? { website_id: c.website_id, name: w.name, domain: w.domain, ...c } : null;
      })
      .filter((r): r is FlaggedSite => r !== null)
      .sort((a, b) => (a.risk_level === b.risk_level ? 0 : a.risk_level === "critical" ? -1 : 1));

    setFlagged(merged);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (flagged === null) return null;
  if (flagged.length === 0) {
    return (
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <h2>Security</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          No hijacked or suspicious sites detected across {totalScanned} scanned site{totalScanned === 1 ? "" : "s"}.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: "1.25rem", border: "1px solid #b3261e" }}>
      <h2 style={{ color: "#b3261e" }}>
        ⚠ Security — {flagged.length} site{flagged.length === 1 ? "" : "s"} flagged
      </h2>
      {flagged.map((f) => (
        <div key={f.website_id} style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)" }}>
          <Link href={`/dashboard/monitoring/${f.website_id}`} style={{ fontWeight: 600 }}>
            {f.name}
          </Link>{" "}
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>({f.domain})</span>
          <p style={{ margin: "0.2rem 0 0", fontSize: "0.85rem", color: f.risk_level === "critical" ? "#b3261e" : "#b98900" }}>
            {f.risk_level === "critical"
              ? `Likely hijacked — redirects to ${f.final_url || "a different domain"}`
              : `Suspicious content flagged: ${f.flagged_keywords.join(", ")}`}
          </p>
        </div>
      ))}
    </div>
  );
}
