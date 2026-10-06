"use client";

import { Fragment, useEffect, useState } from "react";
import { formatKey } from "@/lib/connecteam/time-clock-summary";
import { OPS_RULES } from "@/lib/connecteam/operations";
import { levelFor, SCORE_RULES, type GroupBy, type GroupScorecard, type Level, type ScorecardOverview, type WeekMetrics } from "@/lib/connecteam/scorecard";

const GROUPINGS: { key: GroupBy; label: string }[] = [
  { key: "branch", label: "By branch" },
  { key: "team", label: "By team" },
  { key: "department", label: "By department" },
];

const COLOR: Record<Level, string | undefined> = { good: undefined, amber: "#b98900", red: "#b3261e" };

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

function Fig({ main, sub, level }: { main: React.ReactNode; sub?: string; level?: Level }) {
  return (
    <>
      <div style={{ fontWeight: 600, color: level ? COLOR[level] : undefined }}>{main}</div>
      {sub && <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{sub}</div>}
    </>
  );
}

function forgottenLevel(n: number): Level {
  return n >= 3 ? "red" : n >= 1 ? "amber" : "good";
}

// The same row of figures is used for the headline table and the week-by-week history.
function MetricCells({ w, prev }: { w: WeekMetrics; prev?: WeekMetrics }) {
  const was = (fmt: string | null) => (prev && fmt ? `week before: ${fmt}` : undefined);
  return (
    <>
      <td>
        <Fig main={w.hours.toFixed(1)} sub={w.hoursPerPerson !== null ? `${w.hoursPerPerson.toFixed(1)}h each` : undefined} />
      </td>
      <td>
        <Fig
          main={pct(w.latePct)}
          level={levelFor("latePct", w.latePct)}
          sub={w.linkedClockIns > 0 ? `${w.late} of ${w.linkedClockIns} scheduled${prev ? ` · ${was(pct(prev.latePct))}` : ""}` : "none scheduled"}
        />
      </td>
      <td>
        <Fig main={w.forgottenClockOuts} level={forgottenLevel(w.forgottenClockOuts)} sub={prev ? was(String(prev.forgottenClockOuts)) : undefined} />
      </td>
      <td>
        <Fig
          main={w.drivers > 0 ? `${w.inspected} of ${w.drivers}` : "—"}
          level={levelFor("inspectionPct", w.inspectionPct)}
          sub={w.drivers > 0 ? `${pct(w.inspectionPct)}${prev ? ` · ${was(pct(prev.inspectionPct))}` : ""}` : "no drivers worked"}
        />
      </td>
      <td>
        <Fig
          main={pct(w.safetyMissingPct)}
          level={levelFor("safetyMissingPct", w.safetyMissingPct)}
          sub={w.reports > 0 ? `${w.safetyMissing} of ${w.reports} reports` : "no reports"}
        />
      </td>
      <td>
        <Fig
          main={pct(w.ppeDonePct)}
          level={levelFor("ppeDonePct", w.ppeDonePct)}
          sub={w.ppeSettled > 0 ? `${w.ppeDoneFast} of ${w.ppeSettled}${prev ? ` · ${was(pct(prev.ppeDonePct))}` : ""}` : "no requests"}
        />
      </td>
      <td>
        <Fig main={w.ppeOpen} level={w.ppeOpen > 2 ? "amber" : "good"} />
      </td>
    </>
  );
}

const HEAD = (
  <>
    <th>Hours</th>
    <th>Late arrivals</th>
    <th>Forgotten clock-outs</th>
    <th>Vehicle checks done</th>
    <th>Safety equipment missing</th>
    <th>PPE closed in {SCORE_RULES.ppeFastHours}h</th>
    <th>PPE still open</th>
  </>
);

function History({ group }: { group: GroupScorecard }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Week</th>
            <th>Worked</th>
            {HEAD}
          </tr>
        </thead>
        <tbody>
          {group.weeks.map((w) => (
            <tr key={w.from} style={w.partial ? { opacity: 0.75 } : undefined}>
              <td>
                {formatKey(w.from)} – {formatKey(w.to)}
                {w.partial && <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>so far this week</div>}
              </td>
              <td>
                {w.worked} of {group.headcount}
              </td>
              <MetricCells w={w} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ScorecardView() {
  const [groupBy, setGroupBy] = useState<GroupBy>("branch");
  const [data, setData] = useState<ScorecardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setOpen(null);
    fetch(`/api/operations/scorecard?groupBy=${groupBy}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body.error || "Could not build the scorecard");
        else setData(body);
      })
      .catch((err) => !cancelled && setError(err.message || "Network error"));
    return () => {
      cancelled = true;
    };
  }, [groupBy]);

  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);
  const latest = data?.weeks[1];
  const rows = data ? [data.everyone, ...data.groups] : [];

  return (
    <>
      <div className="tabs" style={{ marginBottom: "1rem" }}>
        {GROUPINGS.map((g) => (
          <button key={g.key} className={groupBy === g.key ? "active" : ""} onClick={() => setGroupBy(g.key)}>
            {g.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="card">
          <p className="error-text" style={{ margin: 0 }}>
            {tableMissing ? "A table is missing. Run the scheduled_shifts migration (and the earlier Connecteam ones) in Supabase, then reload." : error}
          </p>
        </div>
      )}
      {!error && !data && <p style={{ color: "var(--muted)" }}>Working it out...</p>}

      {data && latest && (
        <>
          <p style={{ fontSize: "0.9rem", color: "var(--muted)", margin: "0 0 1rem" }}>
            Latest full week: <strong style={{ color: "var(--ink)" }}>{formatKey(latest.from)} to {formatKey(latest.to)}</strong> (Monday to Sunday, Irish time), compared with the week before. Click a row for the last
            {" "}{SCORE_RULES.weeks} weeks.
          </p>
          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{groupBy === "branch" ? "Branch" : groupBy === "team" ? "Team" : "Department"}</th>
                    <th>Worked</th>
                    {HEAD}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((g) => {
                    const w = g.weeks[1];
                    const prev = g.weeks[2];
                    return (
                      <Fragment key={g.name}>
                        <tr onClick={() => setOpen(open === g.name ? null : g.name)} style={{ cursor: "pointer", background: g === data.everyone ? "var(--accent-soft)" : undefined }}>
                          <td>
                            <strong>{g.name}</strong>
                            <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{g.headcount} staff</div>
                          </td>
                          <td>
                            <Fig main={`${w.worked} of ${g.headcount}`} />
                          </td>
                          <MetricCells w={w} prev={prev} />
                        </tr>
                        {open === g.name && (
                          <tr>
                            <td colSpan={9} style={{ background: "var(--accent-soft)" }}>
                              <History group={g} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            How this is worked out: people are grouped by the {groupBy} set against them in Connecteam (someone in two teams counts in both; "Not set" is
            anyone with none). <strong>Late</strong> is the share of scheduled clock-ins more than {OPS_RULES.lateGraceMinutes} minutes after the
            scheduled start. <strong>Vehicle checks</strong> compares the people who worked that week and have done a vehicle inspection in the last{" "}
            {SCORE_RULES.driverWindowDays} days with how many of them did one that week. <strong>Safety equipment missing</strong> is the share of vehicle
            inspection reports that said the extinguisher or first aid kit was missing. <strong>PPE</strong> counts requests at least{" "}
            {SCORE_RULES.ppeFastHours} hours old and how many a manager marked Done within {SCORE_RULES.ppeFastHours} hours. Forgotten clock-outs are
            shifts open or recorded over {OPS_RULES.implausibleHours} hours, left out of the hours. Amber and red mark figures that need attention
            (late from {SCORE_RULES.amber.latePct}% / {SCORE_RULES.red.latePct}%, vehicle checks below {SCORE_RULES.amber.inspectionPct}% /{" "}
            {SCORE_RULES.red.inspectionPct}%, safety equipment missing from {SCORE_RULES.amber.safetyMissingPct}% / {SCORE_RULES.red.safetyMissingPct}%,
            PPE closed in time below {SCORE_RULES.amber.ppeDonePct}% / {SCORE_RULES.red.ppeDonePct}%). A rate from a very small group, such as 1 of 1,
            moves a lot week to week, so read it with the numbers underneath.
          </p>
        </>
      )}
    </>
  );
}
