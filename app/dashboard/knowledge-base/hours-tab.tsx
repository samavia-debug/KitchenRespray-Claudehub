"use client";

import { useCallback, useEffect, useState } from "react";
import { CLOCK_RULES, dublinDateKey, formatKey, type ClockOverview, type PeriodKey } from "@/lib/connecteam/time-clock-summary";
import { ago } from "./ago";

type Payload = { configured: boolean; lastSyncedAt: string | null; count: number; overview: ClockOverview };

export default function HoursTab() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("thisWeek");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connecteam/time-clock");
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Could not load time clock data");
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
      const res = await fetch("/api/connecteam/time-clock", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${body.error}`);
      } else {
        setMessage(`Synced ${body.shifts} clock-ins${body.backfilled ? " (first load, all available history)" : ""}.`);
        await load();
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }
    setSyncing(false);
  }

  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);
  const o = data?.overview;
  const p = o?.periods.find((x) => x.key === period);

  return (
    <>
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Hours worked</h2>
            <p style={{ color: "var(--muted)", margin: "0.35rem 0 0", fontSize: "0.9rem" }}>
              {data
                ? data.count > 0
                  ? `${data.count} clock-ins from Connecteam's time clock${data.lastSyncedAt ? ` · last synced ${ago(data.lastSyncedAt)}` : ""}`
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
              ? "The time clock tables don't exist yet. Run the time_clock_and_time_off migration in Supabase, then come back and click Sync now."
              : error}
          </p>
        )}
      </div>

      {o && p && data && data.count > 0 && (
        <>
          <div className="tabs" style={{ marginBottom: "1rem" }}>
            {o.periods.map((x) => (
              <button key={x.key} className={period === x.key ? "active" : ""} onClick={() => setPeriod(x.key)}>
                {x.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 1rem" }}>
            {formatKey(p.from)} to {formatKey(p.to)} (Irish time)
          </p>

          <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
            <div className="stat-card">
              <div className="stat-value">{p.totalHours.toLocaleString("en-IE", { maximumFractionDigits: 1 })}</div>
              <div className="stat-label">Hours worked</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{p.people.filter((x) => x.shifts > 0).length}</div>
              <div className="stat-label">People who clocked in</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{o.clockedInNow.length}</div>
              <div className="stat-label">Clocked in right now</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={o.counts.implausible + o.counts.openTooLong > 0 ? { color: "#b98900" } : undefined}>
                {o.counts.implausible + o.counts.openTooLong}
              </div>
              <div className="stat-label">Forgotten clock-outs, last {CLOCK_RULES.flaggedWindowDays} days</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Hours per person</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role / team</th>
                    <th>Days</th>
                    <th>Shifts</th>
                    <th>Hours</th>
                    <th>Avg per day</th>
                    <th>Main job types</th>
                  </tr>
                </thead>
                <tbody>
                  {p.people.map((x) => (
                    <tr key={x.userId} style={x.former ? { opacity: 0.55 } : undefined}>
                      <td>
                        {x.name}
                        {x.former && <span style={{ marginLeft: "0.4rem", fontSize: "0.7rem", border: "1px solid var(--border)", borderRadius: "4px", padding: "0.05rem 0.35rem" }}>Former</span>}
                      </td>
                      <td>{[x.role, x.team].filter(Boolean).join(", ") || "—"}</td>
                      <td>{x.days}</td>
                      <td>{x.shifts}</td>
                      <td style={x.shifts === 0 ? { color: "var(--muted)" } : undefined}>{x.hours.toFixed(1)}</td>
                      <td>{x.days > 0 ? (x.hours / x.days).toFixed(1) : "—"}</td>
                      <td>{x.topJobs.map((j) => `${j.title} ${j.hours.toFixed(1)}h`).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Hours by job type</h2>
            {p.jobs.length === 0 ? (
              <p style={{ color: "var(--muted)", margin: 0 }}>No clock-ins in this period.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Job type</th>
                      <th>Hours</th>
                      <th>Shifts</th>
                      <th>People</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.jobs.map((j) => (
                      <tr key={j.title}>
                        <td>{j.title}</td>
                        <td>{j.hours.toFixed(1)}</td>
                        <td>{j.shifts}</td>
                        <td>{j.people}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Clocked in right now</h2>
            <p style={{ margin: 0, color: o.clockedInNow.length ? undefined : "var(--muted)" }}>
              {o.clockedInNow.length
                ? o.clockedInNow.map((c) => `${c.name}${c.job ? ` (${c.job})` : ""}`).join(", ")
                : "Nobody."}
            </p>
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Looks wrong — last {CLOCK_RULES.flaggedWindowDays} days</h2>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--muted)" }}>
              {o.counts.openTooLong} never clocked out · {o.counts.implausible} over {CLOCK_RULES.implausibleHours} hours · {o.counts.long} over{" "}
              {CLOCK_RULES.longShiftHours} hours · {o.counts.veryShort} under 15 minutes · {o.counts.adminEntered} added by an admin
            </p>
            {o.flagged.length === 0 ? (
              <p style={{ color: "var(--muted)", margin: 0 }}>Nothing unusual.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Person</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.flagged.map((f) => (
                      <tr key={f.shiftId}>
                        <td>{formatKey(dublinDateKey(new Date(f.startedAt).getTime()))}</td>
                        <td>{f.name}</td>
                        <td>{f.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            How this is worked out: hours run from clock-in to clock-out, in Irish time, and a shift counts on the day it started. Weeks run Monday
            to Sunday. A shift over {CLOCK_RULES.implausibleHours} hours is treated as a forgotten clock-out and left out of the totals. Regular
            staff (clocked in on {CLOCK_RULES.regularMinDays}+ days in the last {CLOCK_RULES.regularWindowDays}) are listed even with no hours. Job
            types are Connecteam time clock categories, not customer jobs, and this holds no pay data.
          </p>
        </>
      )}
    </>
  );
}
