"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDuration } from "@/lib/monitoring/incidents";

type IncidentRow = {
  id: string;
  website_id: string;
  severity: "critical" | "offline";
  started_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  detection_count: number;
  websites: { name: string; domain: string } | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function IncidentsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [incidents, setIncidents] = useState<IncidentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");

  const load = useCallback(async () => {
    setError(null);
    const { data, error: loadError } = await supabase
      .from("incidents")
      .select("*, websites(name, domain)")
      .order("started_at", { ascending: false })
      .limit(200);

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setIncidents(data as unknown as IncidentRow[]);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!incidents) return [];
    if (filter === "open") return incidents.filter((i) => !i.resolved_at);
    if (filter === "resolved") return incidents.filter((i) => i.resolved_at);
    return incidents;
  }, [incidents, filter]);

  const openCount = incidents?.filter((i) => !i.resolved_at).length ?? 0;

  return (
    <>
      <div className="page-header">
        <h1>Incidents</h1>
        <p>
          Every continuous critical/offline spell, one row per incident — opened on the first bad
          check, updated (not duplicated) while it continues, closed on the first check that
          recovers.
        </p>
      </div>

      {error && (
        <div className="card">
          <p className="error-text">Failed to load incidents: {error}</p>
        </div>
      )}

      {!incidents && !error && <p style={{ color: "var(--muted)" }}>Loading...</p>}

      {incidents && (
        <div className="card">
          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.1rem", alignItems: "center" }}>
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ maxWidth: "200px" }}>
              <option value="all">All incidents</option>
              <option value="open">Open ({openCount})</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Website</th>
                  <th>Severity</th>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Checks confirming</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((incident) => (
                  <tr key={incident.id} onClick={() => router.push(`/dashboard/monitoring/${incident.website_id}`)}>
                    <td>
                      <strong>{incident.websites?.name || "Unknown site"}</strong>
                      <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{incident.websites?.domain}</div>
                    </td>
                    <td style={{ textTransform: "capitalize", color: incident.severity === "offline" ? "#6f6a63" : "#b3261e", fontWeight: 600 }}>
                      {incident.severity}
                    </td>
                    <td>{formatDate(incident.started_at)}</td>
                    <td>
                      {incident.resolved_at ? (
                        <span style={{ color: "#2e7d32", fontWeight: 600 }}>Resolved {formatDate(incident.resolved_at)}</span>
                      ) : (
                        <span style={{ color: "#b3261e", fontWeight: 600 }}>Still open</span>
                      )}
                    </td>
                    <td>{formatDuration(incident.started_at, incident.resolved_at)}</td>
                    <td>{incident.detection_count}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)" }}>
                      No incidents recorded {filter !== "all" ? `(${filter})` : "yet"}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
