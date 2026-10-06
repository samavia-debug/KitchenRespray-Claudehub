"use client";

import { useCallback, useEffect, useState } from "react";
import { formatKey } from "@/lib/connecteam/time-clock-summary";
import { LEAVE_RULES, type LeaveEntry, type TimeOffOverview } from "@/lib/connecteam/time-off-summary";
import { ago } from "./ago";

type Payload = { configured: boolean; lastSyncedAt: string | null; count: number; overview: TimeOffOverview };

function LeaveTable({ rows, empty }: { rows: LeaveEntry[]; empty: string }) {
  if (rows.length === 0) return <p style={{ color: "var(--muted)", margin: 0 }}>{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Type</th>
            <th>From</th>
            <th>To</th>
            <th>Length</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.requestId}>
              <td>{e.name}</td>
              <td>{e.leaveType}</td>
              <td>{formatKey(e.startDate)}</td>
              <td>{e.startDate === e.endDate ? "" : formatKey(e.endDate)}</td>
              <td>
                {e.partDay ? `Part day${e.times ? ` ${e.times}` : ""}` : e.days !== null ? `${e.days} day${e.days === 1 ? "" : "s"}` : "—"}
              </td>
              <td style={e.status === "approved" ? undefined : { color: "#b98900" }}>{e.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TimeOffTab() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connecteam/time-off");
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Could not load time off data");
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
      const res = await fetch("/api/connecteam/time-off", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${body.error}`);
      } else {
        setMessage(`Synced ${body.requests} requests${body.removed ? ` (${body.removed} cancelled ones removed)` : ""}.`);
        await load();
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }
    setSyncing(false);
  }

  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);
  const o = data?.overview;
  const daysThisYear = o ? Math.round(o.yearPeople.reduce((n, p) => n + p.total, 0) * 10) / 10 : 0;

  return (
    <>
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Time off</h2>
            <p style={{ color: "var(--muted)", margin: "0.35rem 0 0", fontSize: "0.9rem" }}>
              {data
                ? data.count > 0
                  ? `${data.count} leave requests from Connecteam${data.lastSyncedAt ? ` · last synced ${ago(data.lastSyncedAt)}` : ""}`
                  : "Nothing synced yet. Click Sync now."
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
              ? "The time_off_requests table doesn't exist yet. Run the time_clock_and_time_off migration in Supabase, then come back and click Sync now."
              : error}
          </p>
        )}
      </div>

      {o && data && data.count > 0 && (
        <>
          <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
            <div className="stat-card">
              <div className="stat-value">{o.offToday.length}</div>
              <div className="stat-label">Off today</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{o.startingSoon.length}</div>
              <div className="stat-label">Starting in the next {LEAVE_RULES.soonDays} days</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={o.notApproved.length > 0 ? { color: "#b98900" } : undefined}>
                {o.notApproved.length}
              </div>
              <div className="stat-label">Not approved</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{daysThisYear}</div>
              <div className="stat-label">Days taken in {o.year}</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Off today</h2>
            <LeaveTable rows={o.offToday} empty="Nobody is off today." />
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Starting in the next {LEAVE_RULES.soonDays} days</h2>
            <LeaveTable rows={o.startingSoon} empty="Nothing booked." />
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Later — up to {LEAVE_RULES.upcomingDays} days ahead</h2>
            <LeaveTable rows={o.upcoming} empty="Nothing booked." />
          </div>

          {o.notApproved.length > 0 && (
            <div className="card" style={{ marginBottom: "1.25rem" }}>
              <h2 style={{ marginTop: 0 }}>Not approved</h2>
              <LeaveTable rows={o.notApproved} empty="" />
            </div>
          )}

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Days taken in {o.year}, by person</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    {o.yearTypes.map((t) => (
                      <th key={t}>{t}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {o.yearPeople.map((p) => (
                    <tr key={p.userId} style={p.former ? { opacity: 0.55 } : undefined}>
                      <td>{p.name}</td>
                      {o.yearTypes.map((t) => (
                        <td key={t}>{p.byType[t] ?? "—"}</td>
                      ))}
                      <td>
                        <strong>{p.total}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            How this is worked out: only approved requests count as time off, using Connecteam's own day counts (a half day is 0.5). Year to date
            counts requests that start in {o.year}. Bank Holidays are shown as their own type, separate from Holidays. The note an employee can
            add to a request is deliberately not copied, because on sick leave it can contain health details.
          </p>
        </>
      )}
    </>
  );
}
