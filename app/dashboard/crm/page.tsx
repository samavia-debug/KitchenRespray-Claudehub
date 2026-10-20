"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { METRIC_INFO, type MetricKey } from "@/lib/crm/reports";
import { useCrm } from "./crm-context";
import { StageBadge } from "./badges";
import { fmtDate, fmtMoney } from "./fmt";
import { Controls, DrillPanel, ReportControls, StatTile, useControls, useReport } from "./report-ui";

/** The ten figures asked for, in the order they are read: how big, how busy, what is due, and what it is worth. */
const TILES: MetricKey[] = ["totalCompanies", "newProspects", "awaitingContact", "contactsMade", "dueToday", "overdue", "interested", "opportunities", "dealsWon", "salesValue"];

export default function OverviewPage() {
  const router = useRouter();
  const { meta } = useCrm();
  const [controls, setControls] = useControls();
  const { report, error, loading } = useReport(controls);
  const [open, setOpen] = useState<MetricKey | null>(null);
  const isOverseer = meta?.role === "Admin" || meta?.role === "Manager";

  if (!controls) return <p style={{ color: "var(--muted)" }}>Loading...</p>;

  const m = report?.metrics;
  const tile = (key: MetricKey) => {
    const metric = m?.[key];
    const value = !metric ? "…" : key === "salesValue" ? fmtMoney(metric.money ?? 0) : String(metric.value);
    const sub =
      key === "contactsMade" && m ? `${m.companiesContacted.value} compan${m.companiesContacted.value === 1 ? "y" : "ies"}` :
      key === "opportunities" && m ? `${m.quotesSent.value} quote${m.quotesSent.value === 1 ? "" : "s"} sent` :
      key === "dealsWon" && m ? `${m.dealsLost.value} lost` :
      key === "salesValue" && report ? (report.sales.wonWithoutValue ? `${report.sales.wonWithoutValue} won without a value` : "recorded values only") :
      undefined;
    return (
      <StatTile
        key={key}
        label={key === "newProspects" ? "New prospects added" : METRIC_INFO[key].label}
        value={value}
        sub={sub}
        hint={METRIC_INFO[key].hint}
        tone={key === "overdue" && (metric?.value ?? 0) > 0 ? "bad" : undefined}
        active={open === key}
        onClick={() => setOpen(open === key ? null : key)}
        note={metric?.note}
      />
    );
  };

  function showStage(stageId: string) {
    try {
      sessionStorage.setItem("crm-company-filters", JSON.stringify({ stage_id: stageId, category_id: controls!.category && controls!.category !== "none" ? controls!.category : "", assigned_to: controls!.staff }));
    } catch {
      /* the list just opens unfiltered */
    }
    router.push("/dashboard/crm/companies");
  }

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "baseline", marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0 }}>Overview{report ? `: ${report.range.label}` : ""}</h2>
          {isOverseer && (
            <Link href="/dashboard/crm/reports" style={{ fontSize: "0.88rem" }}>
              Full reports →
            </Link>
          )}
        </div>
        <ReportControls value={controls} onChange={(c: Controls) => { setControls(c); setOpen(null); }} />
        {error && <p className="error-text">{error}</p>}
        <div className="stat-grid" style={{ opacity: loading ? 0.6 : 1, marginBottom: 0 }}>
          {TILES.map(tile)}
        </div>
        <p style={{ margin: "0.9rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
          Follow-ups due, overdue and interested are as of today. The rest are for {report ? report.range.label.toLowerCase() : "the period"}. Confirmed sales are only values recorded when a deal was marked Won; estimates are never included. Click any figure to see the records.
        </p>
        {report?.notes.map((n, i) => (
          <p key={i} style={{ margin: "0.4rem 0 0", fontSize: "0.8rem", color: "#8a6700" }}>
            {n}
          </p>
        ))}
      </div>

      {open && m && <DrillPanel title={METRIC_INFO[open].label} hint={METRIC_INFO[open].hint} metric={m[open]} onClose={() => setOpen(null)} />}

      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="card">
          <h2>Sales pipeline</h2>
          {!report ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Companies</th>
                    <th>Estimate (a guess)</th>
                  </tr>
                </thead>
                <tbody>
                  {report.pipeline.map((s) => (
                    <tr key={s.stageId} onClick={() => showStage(s.stageId)}>
                      <td>
                        <StageBadge name={s.name} kind={s.kind} />
                      </td>
                      <td>{s.count}</td>
                      <td>{s.kind === "open" && s.estimate ? fmtMoney(s.estimate) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ margin: "0.6rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>Click a stage to see its companies.</p>
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2>Next follow-ups</h2>
            <Link href="/dashboard/crm/follow-ups" style={{ fontSize: "0.85rem" }}>
              All follow-ups →
            </Link>
          </div>
          {!report ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>
          ) : report.nextFollowUps.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>Nothing is waiting to be followed up.</p>
          ) : (
            report.nextFollowUps.map((f) => (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", padding: "0.55rem 0", borderTop: "1px solid var(--border)", fontSize: "0.88rem" }}>
                <div style={{ minWidth: 0 }}>
                  <Link href={`/dashboard/crm/companies/${f.companyId}`} style={{ fontWeight: 600, color: "inherit" }}>
                    {f.company}
                  </Link>
                  <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
                    {f.title}
                    {f.assignee ? ` · ${f.assignee}` : ""}
                  </div>
                </div>
                <div style={{ whiteSpace: "nowrap", color: f.overdue ? "#b3261e" : undefined, fontWeight: f.overdue ? 600 : undefined }}>
                  {fmtDate(f.due)}
                  {f.overdue ? " (overdue)" : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
