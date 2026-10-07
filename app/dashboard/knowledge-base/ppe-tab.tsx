"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { PPE_RULES, type OpenRequest, type PpeOverview } from "@/lib/connecteam/ppe-summary";
import { formatDate } from "@/lib/connecteam/vehicles-summary";

type Payload = { configured: boolean; lastSyncedAt: string | null; requests: number; overview: PpeOverview };

function ago(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function RequestTable({ rows }: { rows: OpenRequest[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Requested</th>
            <th>By</th>
            <th>Items</th>
            <th>Qty</th>
            <th>Suit size</th>
            <th>Details</th>
            <th>Status</th>
            <th>Manager note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {formatDate(r.submittedAt)}
                <span style={{ color: r.daysOld > PPE_RULES.staleAfterDays ? "#b3261e" : "var(--muted)", marginLeft: "0.35rem", fontSize: "0.8rem" }}>
                  {r.daysOld === 0 ? "today" : `${r.daysOld}d ago`}
                </span>
              </td>
              <td>{r.requester}</td>
              <td>{r.items.join(", ") || "—"}</td>
              <td>{r.quantity ?? "—"}</td>
              <td>{r.sizes.join(", ") || "—"}</td>
              <td>{r.other || "—"}</td>
              <td>{r.status ? <span style={{ color: "#b98900" }}>{r.status}</span> : <span style={{ color: "var(--muted)" }}>No status</span>}</td>
              <td>{r.note || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PpeTab() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connecteam/ppe");
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Could not load PPE data");
        return;
      }
      setError(null);
      setData(body);
    } catch (err: any) {
      setError(err.message || "Network error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function syncNow() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/connecteam/ppe", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${body.error}`);
      } else {
        setMessage(`Synced ${body.total} requests.`);
        await load();
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }
    setSyncing(false);
  }

  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);
  const o = data?.overview;

  return (
    <>
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Tools &amp; PPE requests</h2>
            <p style={{ color: "var(--muted)", margin: "0.35rem 0 0", fontSize: "0.9rem" }}>
              {data
                ? data.requests > 0
                  ? `${data.requests} requests from Connecteam's order form${data.lastSyncedAt ? ` · last synced ${ago(data.lastSyncedAt)}` : ""}`
                  : "Nothing synced yet — click Sync now."
                : tableMissing
                ? "Not set up yet."
                : "Loading..."}
            </p>
          </div>
          <button className="btn" onClick={syncNow} disabled={syncing || tableMissing}>
            {syncing ? "Syncing..." : "Sync now"}
          </button>
        </div>
        {message && <p style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>{message}</p>}
        {error && (
          <p className="error-text" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
            {tableMissing
              ? "The ppe_requests table doesn't exist yet. Run the ppe_requests migration in Supabase, then come back and click Sync now."
              : error}
          </p>
        )}
      </div>

      {o && data && data.requests > 0 && (
        <>
          <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
            <div className="stat-card">
              <div className="stat-value" style={o.openRecent.length > 0 ? { color: "#b98900" } : undefined}>
                {o.openRecent.length}
              </div>
              <div className="stat-label">Open (last {PPE_RULES.staleAfterDays} days)</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={o.openStale.length > 0 ? { color: "#b3261e" } : undefined}>
                {o.openStale.length}
              </div>
              <div className="stat-label">Older open, never closed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {o.totals.requests7} <span style={{ fontSize: "1rem", color: "var(--muted)" }}>/ {o.totals.requests30}</span>
              </div>
              <div className="stat-label">Requests: 7 days / 30 days</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {o.totals.done30} <span style={{ fontSize: "1rem", color: "var(--muted)" }}>of {o.totals.requests30}</span>
              </div>
              <div className="stat-label">Done in the last 30 days</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{o.medianHoursToDone !== null ? `${o.medianHoursToDone}h` : "—"}</div>
              <div className="stat-label">Typical time to Done</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Open requests — last {PPE_RULES.staleAfterDays} days</h2>
            {o.openRecent.length === 0 ? (
              <p style={{ color: "var(--muted)", margin: 0 }}>Nothing waiting. Every recent request has been marked Done.</p>
            ) : (
              <RequestTable rows={o.openRecent} />
            )}
          </div>

          {o.openStale.length > 0 && (
            <details className="card" style={{ marginBottom: "1.25rem" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                {o.openStale.length} older requests with no "Done" (probably forgotten — oldest first)
              </summary>
              <div style={{ marginTop: "0.75rem" }}>
                <RequestTable rows={o.openStale} />
              </div>
            </details>
          )}

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Most requested — last {PPE_RULES.popularWindowDays} days</h2>
            <p style={{ color: "var(--muted)", margin: "0 0 0.75rem", fontSize: "0.85rem" }}>Click an item to see who ordered it.</p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Requests</th>
                    <th>People</th>
                    <th>Units (single-item requests only)</th>
                    <th>Still open</th>
                    <th>Last asked</th>
                  </tr>
                </thead>
                <tbody>
                  {o.topItems.map((i) => (
                    <Fragment key={i.item}>
                      <tr onClick={() => setOpenItem(openItem === i.item ? null : i.item)} style={{ cursor: "pointer" }}>
                        <td>
                          <span style={{ color: "var(--muted)", marginRight: "0.35rem" }}>{openItem === i.item ? "▾" : "▸"}</span>
                          {i.item}
                        </td>
                        <td>{i.requests}</td>
                        <td>{i.orderers.length}</td>
                        <td>{i.units || "—"}</td>
                        <td style={i.openRequests > 0 ? { color: "#b98900" } : undefined}>{i.openRequests || "—"}</td>
                        <td>{formatDate(i.lastRequestedAt)}</td>
                      </tr>
                      {openItem === i.item && (
                        <tr>
                          <td colSpan={6} style={{ background: "var(--accent-soft)" }}>
                            <div className="table-wrap">
                              <table className="data-table">
                                <thead>
                                  <tr>
                                    <th>Who</th>
                                    <th>Requests</th>
                                    <th>Units</th>
                                    <th>Still open</th>
                                    <th>Last asked</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {i.orderers.map((p) => (
                                    <tr key={p.name}>
                                      <td>{p.name}</td>
                                      <td>{p.requests}</td>
                                      <td>{p.units || "—"}</td>
                                      <td style={p.open > 0 ? { color: "#b98900" } : undefined}>{p.open || "—"}</td>
                                      <td>{formatDate(p.lastRequestedAt)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {o.sizes.length > 0 && (
              <p style={{ margin: "0.9rem 0 0", fontSize: "0.9rem" }}>
                <strong>Spray suit sizes requested:</strong> {o.sizes.map((s) => `${s.size} (${s.requests})`).join(", ")}
              </p>
            )}
          </div>

          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            How this is worked out: a request counts as done only when a manager sets its status to <strong>Done</strong> in Connecteam;
            no status or "Working on it" means open, and open requests older than {PPE_RULES.staleAfterDays} days are shown separately.
            Each request has one quantity even when several items are ticked, so unit totals only include single-item requests (and
            ignore quantities over {PPE_RULES.maxPlausibleQuantity}, which look like typos).
          </p>
        </>
      )}
    </>
  );
}
