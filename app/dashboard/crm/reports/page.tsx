"use client";

import { useState } from "react";
import { MIN_CLOSED, MIN_COHORT, METRIC_INFO, type CountRow, type MetricKey } from "@/lib/crm/reports";
import { OPPORTUNITY_STATUS_LABEL } from "@/lib/crm/types";
import { useCrm } from "../crm-context";
import { fmtMoney } from "../fmt";
import { Controls, DrillPanel, FunnelBars, pct, ReportControls, StatTile, TerritoryTable, TrendBars, useControls, useReport } from "../report-ui";

const th = { whiteSpace: "normal" as const };

function CountTable({ rows, first, people }: { rows: CountRow[]; first: string; people: boolean }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{first}</th>
            <th style={th}>Added</th>
            <th style={th}>Contacts made</th>
            <th style={th}>Companies contacted</th>
            {people && <th style={th}>Follow-ups completed</th>}
            <th style={th}>Opportunities</th>
            <th style={th}>Quotes sent</th>
            <th>Won</th>
            {!people && <th>Lost</th>}
            {!people && <th style={th}>Win rate</th>}
            <th style={th}>Confirmed sales</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} style={{ cursor: "default" }}>
              <td style={{ fontWeight: 600 }}>{r.label}</td>
              <td>{r.added}</td>
              <td>{r.contactsMade}</td>
              <td>{r.contacted}</td>
              {people && <td>{r.followUpsCompleted}</td>}
              <td>{r.opportunities}</td>
              <td>{r.quotesSent}</td>
              <td>{r.won}</td>
              {!people && <td>{r.lost}</td>}
              {!people && (
                <td title={r.winRate === null ? `Shown once there are at least ${MIN_CLOSED} closed deals` : undefined} style={{ color: r.winRate === null ? "var(--muted)" : undefined }}>
                  {r.winRate === null ? "Not enough yet" : pct(r.winRate)}
                </td>
              )}
              <td>{r.wonValue ? fmtMoney(r.wonValue) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const { meta } = useCrm();
  const isOverseer = meta?.role === "Admin" || meta?.role === "Manager";
  const [controls, setControls] = useControls();
  const { report, error, loading } = useReport(isOverseer ? controls : null);
  const [open, setOpen] = useState<MetricKey | null>(null);

  if (meta && !isOverseer) return <div className="card">Reports are for Admin and Manager. Your own numbers are on the Overview.</div>;
  if (!controls) return <p style={{ color: "var(--muted)" }}>Loading...</p>;

  const m = report?.metrics;
  const tile = (key: MetricKey) => {
    const metric = m?.[key];
    return (
      <StatTile
        key={key}
        label={METRIC_INFO[key].label}
        value={!metric ? "…" : key === "salesValue" ? fmtMoney(metric.money ?? 0) : String(metric.value)}
        hint={METRIC_INFO[key].hint}
        active={open === key}
        onClick={() => setOpen(open === key ? null : key)}
        note={metric?.note}
      />
    );
  };
  const sales = report?.sales;

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Reports{report ? `: ${report.range.label}` : ""}</h2>
        <ReportControls value={controls} onChange={(c: Controls) => { setControls(c); setOpen(null); }} />
        {error && <p className="error-text">{error}</p>}
        {report && (
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
            {report.range.from} to {report.range.to}. Every figure comes from what has been recorded in the CRM. Activity counts are things people logged, estimates are guesses, and confirmed sales are values recorded when a deal was marked Won.
          </p>
        )}
        {report?.notes.map((n, i) => (
          <p key={i} style={{ margin: "0.4rem 0 0", fontSize: "0.82rem", color: "#8a6700" }}>
            {n}
          </p>
        ))}
      </div>

      {open && m && <DrillPanel title={METRIC_INFO[open].label} hint={METRIC_INFO[open].hint} metric={m[open]} onClose={() => setOpen(null)} />}

      <div className="card" style={{ opacity: loading ? 0.6 : 1 }}>
        <h2>Activity</h2>
        <div className="stat-grid">{(["newProspects", "contactsMade", "companiesContacted", "followUpsCompleted", "becameInterested"] as MetricKey[]).map(tile)}</div>
        {report && (
          <>
            <div className="grid-2" style={{ margin: "1rem 0", alignItems: "start" }}>
              <TrendBars points={report.trend.points} field="added" label="Prospects added" bucket={report.trend.bucket} />
              <TrendBars points={report.trend.points} field="contacts" label="Contacts made" bucket={report.trend.bucket} />
            </div>
            <h3 style={{ fontSize: "0.9rem", margin: "1rem 0 0.5rem" }}>What was done</h3>
            {report.activityByType.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)" }}>No activity was recorded in this period.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    {report.activityByType.map((a) => (
                      <tr key={a.type} style={{ cursor: "default" }}>
                        <td style={{ width: 220 }}>{a.type}</td>
                        <td style={{ width: "100%" }}>
                          <span style={{ display: "block", background: "var(--accent-soft)", height: 12, borderRadius: 4 }} title={`${a.type}: ${a.count}`}>
                            <span style={{ display: "block", height: "100%", width: `${(a.count / report.activityByType[0].count) * 100}%`, background: "var(--accent)", borderRadius: 4 }} />
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{a.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card" style={{ opacity: loading ? 0.6 : 1 }}>
        <h2>Opportunities and sales</h2>
        <div className="stat-grid">{(["opportunities", "quotesRequested", "quotesSent", "dealsWon", "dealsLost", "salesValue"] as MetricKey[]).map(tile)}</div>

        <details style={{ margin: "0.5rem 0 1rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.88rem", fontWeight: 600 }}>How sales are counted</summary>
          <ul style={{ fontSize: "0.85rem", color: "var(--muted)", paddingLeft: "1.2rem", lineHeight: 1.5 }}>
            <li>
              <strong>Confirmed sales</strong> are values recorded when a deal was marked Won. They are the only thing added up as sales.
            </li>
            <li>
              <strong>Estimates</strong> (on companies and on open opportunities) are guesses at the size of a job. They are shown separately and never counted as sales.
            </li>
            <li>A win is counted once: a won opportunity, or a company marked Won that has no won opportunity of its own.</li>
            <li>A sale is credited to a source (such as direct prospecting) only if its opportunity says so. A company marked Won with no opportunity has no source, so it shows as Not recorded.</li>
            <li>A deal is counted in the period it was marked Won or Lost, and a quote in the period it was requested or sent.</li>
          </ul>
        </details>

        {sales && (
          <div className="grid-2" style={{ alignItems: "start" }}>
            <div>
              <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Confirmed sales: where each win came from</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Counted from</th>
                      <th>Deals</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ cursor: "default" }}>
                      <td>Won opportunities</td>
                      <td>{sales.fromOpportunities.count}</td>
                      <td>{fmtMoney(sales.fromOpportunities.value)}</td>
                    </tr>
                    <tr style={{ cursor: "default" }}>
                      <td style={{ whiteSpace: "normal" }}>Companies marked Won with no opportunity</td>
                      <td>{sales.fromCompanies.count}</td>
                      <td>{fmtMoney(sales.fromCompanies.value)}</td>
                    </tr>
                    <tr style={{ cursor: "default", fontWeight: 700 }}>
                      <td>Total</td>
                      <td>{sales.wonCount}</td>
                      <td>{fmtMoney(sales.confirmedValue)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <h3 style={{ fontSize: "0.9rem", margin: "1rem 0 0.5rem" }}>Confirmed sales by source</h3>
              {sales.bySource.length === 0 ? (
                <p style={{ margin: 0, color: "var(--muted)" }}>No deals were won in this period.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Deals</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.bySource.map((s) => (
                        <tr key={s.source} style={{ cursor: "default" }}>
                          <td>{s.source}</td>
                          <td>{s.count}</td>
                          <td>{fmtMoney(s.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div>
              <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.25rem" }}>Open opportunities (estimates, not sales)</h3>
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.78rem", color: "var(--muted)" }}>As things stand today, not just this period.</p>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Opportunities</th>
                      <th>Estimate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.openByStatus.map((s) => (
                      <tr key={s.status} style={{ cursor: "default" }}>
                        <td>{OPPORTUNITY_STATUS_LABEL[s.status]}</td>
                        <td>{s.count}</td>
                        <td>{s.estimate ? fmtMoney(s.estimate) : "—"}</td>
                      </tr>
                    ))}
                    <tr style={{ cursor: "default", fontWeight: 700 }}>
                      <td>All open</td>
                      <td>{sales.openEstimate.count}</td>
                      <td>{fmtMoney(sales.openEstimate.value)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ opacity: loading ? 0.6 : 1 }}>
        <h2>How far prospects get</h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.82rem", color: "var(--muted)" }}>
          Percentages appear once there are at least {MIN_COHORT} to base them on, so a handful of companies does not give a misleading rate. A company can skip a step, so each share is out of everything added, not out of the step before.
        </p>
        {report && (
          <div className="grid-2" style={{ alignItems: "start" }}>
            <div>
              <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Companies added in this period ({report.funnel.cohort})</h3>
              {report.funnel.cohort === 0 ? <p style={{ margin: 0, color: "var(--muted)" }}>No companies were added in this period.</p> : <FunnelBars steps={report.funnel.steps} enough={report.funnel.enough} cohortLabel="Companies added" />}
              {report.funnel.cohort > 0 && !report.funnel.enough && <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "#8a6700" }}>Not enough yet for percentages ({report.funnel.cohort} of {MIN_COHORT}).</p>}
            </div>
            <div>
              <h3 style={{ fontSize: "0.9rem", margin: "0 0 0.5rem" }}>Opportunities identified in this period ({report.opportunityFunnel.cohort})</h3>
              {report.opportunityFunnel.cohort === 0 ? <p style={{ margin: 0, color: "var(--muted)" }}>No opportunities were identified in this period.</p> : <FunnelBars steps={report.opportunityFunnel.steps} enough={report.opportunityFunnel.enough} cohortLabel="Opportunities identified" />}
              {report.opportunityFunnel.cohort > 0 && !report.opportunityFunnel.enough && <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "#8a6700" }}>Not enough yet for percentages ({report.opportunityFunnel.cohort} of {MIN_COHORT}).</p>}
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ opacity: loading ? 0.6 : 1 }}>
        <h2>By customer category</h2>
        {report ? <CountTable rows={report.byCategory} first="Category" people={false} /> : <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>}
        <p style={{ margin: "0.6rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>Win rate is wins out of wins plus losses, shown once there are at least {MIN_CLOSED} closed deals.</p>
      </div>

      <div className="card" style={{ opacity: loading ? 0.6 : 1 }}>
        <h2>By county</h2>
        {report ? <TerritoryTable rows={report.byCounty} /> : <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>}
        <p style={{ margin: "0.6rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
          A company counts under the county on its record. The first columns show how things stand now; the others are for the period above. The Territories tab has the same table for everyone.
        </p>
      </div>

      <div className="card" style={{ opacity: loading ? 0.6 : 1 }}>
        <h2>By person</h2>
        {report ? <CountTable rows={report.byStaff} first="Person" people /> : <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>}
        <p style={{ margin: "0.6rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
          Prospects added are counted for whoever added them, contacts for whoever did them, follow-ups for whoever completed them, and opportunities and deals for whoever handles them (or, if nobody is assigned, whoever added them).
        </p>
      </div>
    </>
  );
}
