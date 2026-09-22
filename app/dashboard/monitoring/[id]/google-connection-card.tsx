"use client";

import { useCallback, useEffect, useState } from "react";
import type { GoogleConnection, GoogleService } from "@/lib/monitoring/types";

const LABELS: Record<GoogleService, string> = {
  analytics: "Google Analytics",
  search_console: "Google Search Console",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function GoogleConnectionCard({
  websiteId,
  service,
  canManage,
}: {
  websiteId: string;
  service: GoogleService;
  canManage: boolean;
}) {
  const [connection, setConnection] = useState<GoogleConnection | null | "loading">("loading");
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/google/connections/${websiteId}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load connection status");
        return;
      }
      const match = (data.connections as GoogleConnection[]).find((c) => c.service === service);
      setConnection(match || null);
    } catch (err: any) {
      setError(err.message);
    }
  }, [websiteId, service]);

  useEffect(() => {
    load();
  }, [load]);

  async function disconnect() {
    if (!confirm(`Disconnect ${LABELS[service]} for this site?`)) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/google/connections/${websiteId}?service=${service}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to disconnect");
      } else {
        setConnection(null);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setDisconnecting(false);
  }

  return (
    <div className="card">
      <h2>{LABELS[service]}</h2>

      {error && <p className="error-text">{error}</p>}

      {connection === "loading" && <p style={{ color: "var(--muted)" }}>Loading...</p>}

      {connection === null && (
        <>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
            Not connected. Metrics sync (traffic, clicks, impressions) arrives once connected and
            a sync job is built — this connects the account, it doesn't pull data yet.
          </p>
          {canManage ? (
            <a href={`/api/google/connect?websiteId=${websiteId}&service=${service}`} className="btn">
              Connect {LABELS[service]}
            </a>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Only Admins/Managers can connect this.</p>
          )}
        </>
      )}

      {connection && connection !== "loading" && (
        <>
          <p style={{ fontSize: "0.9rem" }}>
            Connected as: {connection.external_account_email || <span style={{ color: "var(--muted)" }}>Unknown account</span>}
          </p>
          <p style={{ fontSize: "0.9rem" }}>Connected: {formatDate(connection.connected_at)}</p>
          <p style={{ fontSize: "0.9rem" }}>
            Last synced: {connection.last_synced_at ? formatDate(connection.last_synced_at) : "Never — sync job not built yet"}
          </p>
          {canManage && (
            <button className="btn-secondary btn" onClick={disconnect} disabled={disconnecting} style={{ marginTop: "0.5rem" }}>
              {disconnecting ? "Disconnecting..." : "Disconnect"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
