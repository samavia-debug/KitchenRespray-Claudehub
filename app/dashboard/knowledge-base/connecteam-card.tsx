"use client";

import { useCallback, useEffect, useState } from "react";

type Status = { configured: boolean; lastSyncedAt: string | null; current: number; former: number };

function timeAgo(iso: string): { text: string; hours: number } {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return { text: "less than an hour ago", hours };
  if (hours < 48) return { text: `${Math.round(hours)}h ago`, hours };
  return { text: `${Math.round(hours / 24)} days ago`, hours };
}

export default function ConnecteamCard({ onSynced }: { onSynced: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/connecteam/sync");
      if (res.ok) setStatus(await res.json());
    } catch {
      // Status is informational; the card just stays in its loading state.
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function syncNow() {
    setSyncing(true);
    setMessage(null);
    setFailed(false);
    try {
      const res = await fetch("/api/connecteam/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setFailed(true);
        setMessage(data.error || "Sync failed.");
      } else {
        setMessage(`Synced ${data.total} people (${data.current} current, ${data.former} former).`);
        await loadStatus();
        onSynced();
      }
    } catch (err: any) {
      setFailed(true);
      setMessage(err.message || "Network error.");
    }
    setSyncing(false);
  }

  if (!status) return null;

  const ago = status.lastSyncedAt ? timeAgo(status.lastSyncedAt) : null;
  const stale = !!ago && ago.hours > 48;

  return (
    <div className="card" style={{ marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Connecteam staff</h2>
          {!status.configured ? (
            <p style={{ color: "var(--muted)", margin: "0.35rem 0 0", fontSize: "0.9rem" }}>
              Not connected — add the Connecteam API key (CONNECTEAM_API_KEY) in Netlify to turn this on.
            </p>
          ) : (
            <p style={{ color: stale ? "#b3261e" : "var(--muted)", margin: "0.35rem 0 0", fontSize: "0.9rem" }}>
              {ago
                ? `${status.current} current and ${status.former} former staff · last synced ${ago.text}${stale ? " — check the key hasn't expired" : ""}`
                : "Connected — not synced yet."}
            </p>
          )}
        </div>
        {status.configured && (
          <button className="btn" onClick={syncNow} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync now"}
          </button>
        )}
      </div>
      {message && <p className={failed ? "error-text" : undefined} style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>{message}</p>}
    </div>
  );
}
