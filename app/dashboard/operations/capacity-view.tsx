"use client";

import { useEffect, useState } from "react";
import { formatKey } from "@/lib/connecteam/time-clock-summary";
import { OPS_RULES } from "@/lib/connecteam/operations";
import { CAPACITY_RULES, type CapacityOverview, type CapacityWeek } from "@/lib/capacity/summary";

const AMBER = "#b98900";
const RED = "#b3261e";

const signed = (v: number | null) => (v === null ? null : `${v > 0 ? "+" : ""}${v}%`);

function Sub({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{children}</div>;
}

function Dash() {
  return <span style={{ color: "var(--muted)" }}>—</span>;
}

function RotaCell({ w }: { w: CapacityWeek }) {
  if (w.kind === "past") return <Dash />;
  const color = w.status === "light" ? RED : w.status === "unplanned" ? "var(--muted)" : undefined;
  return (
    <>
      <div style={{ fontWeight: 600, color }}>{w.rotaHours}h</div>
      {w.rotaVsUsualPct !== null && <Sub>{w.rotaVsUsualPct}% of usual</Sub>}
      {w.draftHours > 0 && <Sub>+{w.draftHours}h draft</Sub>}
      {w.openHours > 0 && <Sub>{w.openHours}h open shifts</Sub>}
    </>
  );
}

const STATUS_TEXT: Record<string, { text: string; color?: string }> = {
  unplanned: { text: "Not planned yet", color: "var(--muted)" },
  light: { text: "Light", color: RED },
  normal: { text: "Normal" },
  heavy: { text: "Heavy", color: AMBER },
};

export default function CapacityView() {
  const [data, setData] = useState<(CapacityOverview & { shiftsKnown: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/operations/capacity")
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body.error || "Could not build the comparison");
        else setData(body);
      })
      .catch((err) => !cancelled && setError(err.message || "Network error"));
    return () => {
      cancelled = true;
    };
  }, []);

  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);

  return (
    <>
      {error && (
        <div className="card">
          <p className="error-text" style={{ margin: 0 }}>
            {tableMissing ? "A table is missing. Run the Connecteam migrations (time clock, scheduled shifts, time off) in Supabase, then reload." : error}
          </p>
        </div>
      )}
      {!error && !data && <p style={{ color: "var(--muted)" }}>Working it out...</p>}

      {data && !data.shiftsKnown && (
        <div className="card">
          <p style={{ margin: 0 }}>No technician hours are synced yet. Run a sync on the Connecteam page, then reload.</p>
        </div>
      )}

      {data && data.shiftsKnown && (
        <>
          <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
            <div className="stat-card">
              <div className="stat-value">{data.usualWeeklyHours !== null ? `${data.usualWeeklyHours}h` : "—"}</div>
              <div className="stat-label">Usual technician hours a week</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{data.technicians.active}</div>
              <div className="stat-label">Active technicians</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ fontSize: "1.2rem" }}>
                {data.rotaPlannedThrough ? formatKey(data.rotaPlannedThrough) : "—"}
              </div>
              <div className="stat-label">Rota planned through</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>What stands out</h2>
            {data.findings.length === 0 ? (
              <p style={{ color: "var(--muted)", margin: 0 }}>
                Nothing stands out: website interest and technician hours are moving together, and the rota ahead looks in line with usual.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.92rem" }}>
                {data.findings.map((f, i) => (
                  <li key={i} style={{ marginBottom: "0.4rem", color: f.level === "attention" ? RED : undefined }}>
                    {f.text}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Week by week</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Week (Mon – Sun)</th>
                    <th>Website visits</th>
                    <th>Enquiries</th>
                    <th>Search clicks</th>
                    <th>Technician hours worked</th>
                    <th>Rota</th>
                    <th>Technician leave</th>
                    <th>Rota status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.weeks.map((w) => {
                    const d = w.demand;
                    const status = w.status ? STATUS_TEXT[w.status] : null;
                    const empty = w.kind === "future" && w.rotaHours === 0 && w.draftHours === 0;
                    return (
                      <tr key={w.from} style={{ background: w.kind === "current" ? "var(--accent-soft)" : undefined, opacity: empty ? 0.6 : 1 }}>
                        <td>
                          {formatKey(w.from)} – {formatKey(w.to)}
                          {w.kind === "current" && <Sub>this week</Sub>}
                        </td>
                        <td>
                          {d ? (
                            <>
                              <div style={{ fontWeight: 600 }}>{d.sessions.toLocaleString()}</div>
                              {w.sessionsVsUsualPct !== null && <Sub>{signed(w.sessionsVsUsualPct)} vs usual</Sub>}
                              {!d.complete && <Sub>{w.kind === "current" ? "so far" : "some days missing"}</Sub>}
                            </>
                          ) : (
                            <Dash />
                          )}
                        </td>
                        <td>{d ? d.conversions : <Dash />}</td>
                        <td>
                          {d ? (
                            <>
                              {d.clicks.toLocaleString()}
                              {!d.searchComplete && <Sub>still arriving</Sub>}
                            </>
                          ) : (
                            <Dash />
                          )}
                        </td>
                        <td>
                          {w.workedHours === null ? (
                            <Dash />
                          ) : (
                            <>
                              <div style={{ fontWeight: 600 }}>{w.workedHours}h</div>
                              {w.kind === "past" && w.hoursVsUsualPct !== null && <Sub>{signed(w.hoursVsUsualPct)} vs usual</Sub>}
                              {w.techniciansWorked > 0 && (
                                <Sub>
                                  {w.techniciansWorked} people{w.kind === "current" ? " so far" : ""}
                                </Sub>
                              )}
                            </>
                          )}
                        </td>
                        <td>
                          <RotaCell w={w} />
                        </td>
                        <td>
                          {w.leaveDays > 0 ? (
                            <>
                              {w.leaveDays} days
                              <Sub>
                                {w.leavePeople} {w.leavePeople === 1 ? "person" : "people"}
                              </Sub>
                            </>
                          ) : (
                            <Dash />
                          )}
                        </td>
                        <td style={{ color: status?.color, fontWeight: status ? 600 : undefined }}>{status ? status.text : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            How this is worked out: <strong>website visits, enquiries and search clicks</strong> are added up across all connected sites and only go back to{" "}
            {data.demandHistoryFrom ? formatKey(data.demandHistoryFrom) : "when syncing started"}. They show interest in the websites, not booked jobs, and there
            are few enquiries each week, so one busy or quiet week can swing a lot. Search Console runs a few days behind, so the latest clicks are incomplete.{" "}
            <strong>Technicians</strong> are staff whose Connecteam role or department says technician or spray ({data.technicians.active} active).{" "}
            <strong>Hours worked</strong> are completed clock-ins, leaving out any over {OPS_RULES.implausibleHours} hours (forgotten clock-outs).{" "}
            <strong>Rota</strong> counts published shifts assigned to technicians; drafts are shown separately. <strong>Usual</strong> is the average of the last{" "}
            {CAPACITY_RULES.baselineWeeks} full weeks. A rota under {CAPACITY_RULES.unplannedBelowPct}% of usual is shown as &ldquo;not planned yet&rdquo; rather than
            short, because the rota is normally filled in only a couple of weeks ahead; between {CAPACITY_RULES.unplannedBelowPct}% and{" "}
            {CAPACITY_RULES.lightRotaBelowPct}% is &ldquo;light&rdquo;. Visits and hours moving together or apart doesn&apos;t prove one caused the other, and
            enquiries usually turn into work some weeks later.
          </p>
        </>
      )}
    </>
  );
}
