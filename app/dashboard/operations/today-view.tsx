"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { formatKey } from "@/lib/connecteam/time-clock-summary";
import { OPS_RULES, type TodayOverview } from "@/lib/connecteam/operations";
import PersonDetailPanel from "./person-detail";
import { ago, clockTime, STATUS_COLOR, STATUS_LABEL } from "./format";

type Payload = { configured: boolean; overview: TodayOverview; clockSyncedAt: string | null; scheduleSyncedAt: string | null };

const STALE_MINUTES = 15;
const POLL_MS = 60_000;

function Stat({ value, label, sub, tone }: { value: React.ReactNode; label: string; sub?: string; tone?: "warn" | "bad" }) {
  const color = tone === "bad" ? "#b3261e" : tone === "warn" ? "#b98900" : undefined;
  return (
    <div className="stat-card">
      <div className="stat-value" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
      {sub && <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.2rem" }}>{sub}</div>}
    </div>
  );
}

export default function TodayView() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openPerson, setOpenPerson] = useState<number | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const autoRefreshed = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/operations/today");
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Could not load today's overview");
        return null;
      }
      setError(null);
      setData(body);
      return body as Payload;
    } catch (err: any) {
      setError(err.message || "Network error");
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/operations/today", { method: "POST" });
      const body = await res.json();
      if (!res.ok) setMessage(`Couldn't update from Connecteam: ${body.error}`);
      await load();
    } catch (err: any) {
      setMessage(`Couldn't update from Connecteam: ${err.message}`);
    }
    setRefreshing(false);
  }, [load]);

  // On opening: show what we have straight away, and if it's stale, pull the latest once.
  useEffect(() => {
    load().then((payload) => {
      if (!payload || autoRefreshed.current) return;
      autoRefreshed.current = true;
      const age = payload.clockSyncedAt ? (Date.now() - new Date(payload.clockSyncedAt).getTime()) / 60_000 : Infinity;
      if (payload.configured && age > STALE_MINUTES) refresh();
    });
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load, refresh]);

  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);
  const o = data?.overview;
  const k = o?.kpis;

  return (
    <>
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Today{o ? `, ${formatKey(o.today)}` : ""}</h2>
            <p style={{ color: "var(--muted)", margin: "0.35rem 0 0", fontSize: "0.9rem" }}>
              {data
                ? `Clock-ins updated ${ago(data.clockSyncedAt)} · rota updated ${ago(data.scheduleSyncedAt)} · times are Irish time`
                : tableMissing
                ? "Not set up yet."
                : "Loading..."}
            </p>
          </div>
          <button className="btn" onClick={refresh} disabled={refreshing || tableMissing}>
            {refreshing ? "Updating..." : "Update from Connecteam"}
          </button>
        </div>
        {message && <p className="error-text" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>{message}</p>}
        {error && (
          <p className="error-text" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
            {tableMissing
              ? "A table is missing. Run the scheduled_shifts migration (and the time clock one) in Supabase, then reload this page."
              : error}
          </p>
        )}
      </div>

      {o && k && (
        <>
          <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
            <Stat value={k.employees} label="Current staff" sub={`${k.scheduledPeople} scheduled today · ${k.onLeave} on leave`} />
            <Stat value={k.workingNow} label="Working right now" />
            <Stat value={k.hoursToday.toFixed(1)} label="Hours worked today" sub="including time so far" />
            <Stat value={k.lateArrivals} label="Late arrivals" sub={`over ${OPS_RULES.lateGraceMinutes} min after start`} tone={k.lateArrivals > 0 ? "warn" : undefined} />
            <Stat value={k.notClockedIn} label="Due in, not clocked in" tone={k.notClockedIn > 0 ? "bad" : undefined} />
            <Stat value={k.missingClockOuts} label="Missing clock-outs" tone={k.missingClockOuts > 0 ? "bad" : undefined} />
            <Stat value={k.activeJobs} label="Job types in use" />
            <Stat
              value={`${k.tasksDone} / ${k.tasksTotal}`}
              label="Checklist items done"
              sub={k.checklistRate30d !== null ? `only ${k.checklistRate30d}% are ever ticked` : undefined}
            />
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Needs attention</h2>
            {k.lateArrivals + k.notClockedIn + k.missingClockOuts === 0 ? (
              <p style={{ color: "var(--muted)", margin: 0 }}>Nothing at the moment.</p>
            ) : (
              <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                <div>
                  <strong style={{ color: "#b3261e" }}>Due in, not clocked in ({o.notClockedIn.length})</strong>
                  {o.notClockedIn.length === 0 ? (
                    <p style={{ margin: "0.3rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>None</p>
                  ) : (
                    <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem", fontSize: "0.9rem" }}>
                      {o.notClockedIn.map((n) => (
                        <li key={n.userId}>
                          {n.name}: due {clockTime(n.scheduledStart)}, {n.shiftOver ? "shift is over: missed" : `${n.minutesOver} min ago`}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <strong style={{ color: "#b98900" }}>Late today ({o.lateArrivals.length})</strong>
                  {o.lateArrivals.length === 0 ? (
                    <p style={{ margin: "0.3rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>None</p>
                  ) : (
                    <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem", fontSize: "0.9rem" }}>
                      {o.lateArrivals.map((l) => (
                        <li key={l.userId}>
                          {l.name}: {l.minutes} min late (in at {clockTime(l.clockedInAt)})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <strong style={{ color: "#b3261e" }}>Missing clock-outs ({o.missingClockOuts.length})</strong>
                  {o.missingClockOuts.length === 0 ? (
                    <p style={{ margin: "0.3rem 0 0", color: "var(--muted)", fontSize: "0.9rem" }}>None</p>
                  ) : (
                    <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem", fontSize: "0.9rem" }}>
                      {o.missingClockOuts.map((m) => (
                        <li key={m.shiftId}>
                          {m.name}: in {formatKey(m.startedAt.slice(0, 10))} {clockTime(m.startedAt)}, open {m.openHours}h
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Who's where</h2>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--muted)" }}>Click a name for their last {OPS_RULES.detailDays} days.</p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role / team</th>
                    <th>Status</th>
                    <th>Scheduled</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Hours</th>
                    <th>Job type</th>
                    <th>Checklist</th>
                  </tr>
                </thead>
                <tbody>
                  {o.people.map((p) => (
                    <Fragment key={p.userId}>
                      <tr onClick={() => setOpenPerson(openPerson === p.userId ? null : p.userId)} style={{ cursor: "pointer" }}>
                        <td>
                          <strong>{p.name}</strong>
                        </td>
                        <td>{[p.role, p.team].filter(Boolean).join(", ") || "—"}</td>
                        <td>
                          <span style={{ color: STATUS_COLOR[p.status], fontWeight: 600 }}>{p.status === "on-leave" && p.leaveType ? p.leaveType : STATUS_LABEL[p.status]}</span>
                          {p.lateMinutes !== null && <span style={{ color: "#b98900", marginLeft: "0.4rem", fontSize: "0.8rem" }}>{p.lateMinutes} min late</span>}
                        </td>
                        <td>{p.scheduledStart ? clockTime(p.scheduledStart) : "—"}</td>
                        <td>{p.clockedInAt ? clockTime(p.clockedInAt) : "—"}</td>
                        <td>{p.clockedOutAt ? clockTime(p.clockedOutAt) : "—"}</td>
                        <td>{p.hoursToday > 0 ? p.hoursToday.toFixed(1) : "—"}</td>
                        <td>{p.job ?? "—"}</td>
                        <td>{p.tasksTotal > 0 ? `${p.tasksDone}/${p.tasksTotal}` : "—"}</td>
                      </tr>
                      {openPerson === p.userId && (
                        <tr>
                          <td colSpan={9} style={{ background: "var(--accent-soft)" }}>
                            <PersonDetailPanel userId={p.userId} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Job types today</h2>
            {o.jobs.length === 0 ? (
              <p style={{ color: "var(--muted)", margin: 0 }}>Nobody has clocked in yet and nothing is scheduled.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Job type</th>
                      <th>Working now</th>
                      <th>Hours</th>
                      <th>Scheduled</th>
                      <th>Checklist</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.jobs.map((j) => (
                      <Fragment key={j.title}>
                        <tr onClick={() => setOpenJob(openJob === j.title ? null : j.title)} style={{ cursor: "pointer" }}>
                          <td>
                            <strong>{j.title}</strong>
                          </td>
                          <td>{j.workingNow}</td>
                          <td>{j.hours.toFixed(1)}</td>
                          <td>{j.scheduledPeople}</td>
                          <td>{j.tasksTotal > 0 ? `${j.tasksDone}/${j.tasksTotal}` : "—"}</td>
                        </tr>
                        {openJob === j.title && (
                          <tr>
                            <td colSpan={5} style={{ background: "var(--accent-soft)" }}>
                              {j.people.length === 0 ? (
                                <span style={{ color: "var(--muted)" }}>Nobody has clocked in on this yet.</span>
                              ) : (
                                j.people.map((x) => (
                                  <div key={`${x.userId}-${x.since}`} style={{ fontSize: "0.9rem" }}>
                                    {x.name}: in at {clockTime(x.since)}, {x.hours.toFixed(1)}h {x.open ? "(still on)" : "(finished)"}
                                  </div>
                                ))
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            How this is worked out: <strong>late</strong> means clocked in more than {OPS_RULES.lateGraceMinutes} minutes after the scheduled
            start; <strong>not clocked in</strong> means the start passed more than {OPS_RULES.notClockedInGraceMinutes} minutes ago with no
            clock-in and no approved leave; <strong>missing clock-out</strong> means a shift still open after {OPS_RULES.implausibleHours} hours (
            {OPS_RULES.missingClockOutHours} for one that started today). People on approved leave aren't counted as expected. The clock
            stores no location, so the page can't say who is on a job site: job types show where people clocked in. Checklist items are the
            steps on each scheduled shift; because few are ever ticked, treat that figure as a minimum.
          </p>
        </>
      )}
    </>
  );
}
