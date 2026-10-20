"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { addDays, dublinToday } from "@/lib/crm/followups";
import type { DrillRow, FunnelStep, MetricValue, ReportResult, TerritoryRow } from "@/lib/crm/reports";
import { api } from "./api";
import { useCrm } from "./crm-context";
import { fmtDate, fmtDateTime, fmtMoney, personName } from "./fmt";

export type Controls = { range: string; from: string; to: string; category: string; staff: string };

const STORE_KEY = "crm-report-controls";
const PRESETS: [string, string][] = [
  ["this_week", "This week"],
  ["last_week", "Last week"],
  ["this_month", "This month"],
  ["last_month", "Last month"],
  ["last_30", "Last 30 days"],
  ["custom", "Custom dates"],
];

export const pct = (share: number | null | undefined) => (share === null || share === undefined ? "—" : `${Math.round(share * 100)}%`);

/** What to show for the date range and the filters. Remembered for the tab, and Staff open on their own work. */
export function useControls(): [Controls | null, (c: Controls) => void] {
  const { meta } = useCrm();
  const [controls, setControls] = useState<Controls | null>(null);

  useEffect(() => {
    if (!meta || controls) return;
    let saved: Partial<Controls> = {};
    try {
      saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}");
    } catch {
      /* not remembered */
    }
    const today = dublinToday();
    setControls({
      range: saved.range ?? "this_week",
      from: saved.from ?? addDays(today, -29),
      to: saved.to ?? today,
      category: saved.category ?? "",
      staff: saved.staff !== undefined ? saved.staff : meta.role === "Staff" ? meta.me : "",
    });
  }, [meta, controls]);

  const set = (c: Controls) => {
    setControls(c);
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(c));
    } catch {
      /* not remembered */
    }
  };
  return [controls, set];
}

/** Loads the report for the chosen controls, ignoring an answer that arrives after a newer request. */
export function useReport(controls: Controls | null) {
  const [report, setReport] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const key = controls ? JSON.stringify(controls) : "";
  useEffect(() => {
    if (!controls) return;
    if (controls.range === "custom" && (!controls.from || !controls.to)) return;
    const id = ++requestId.current;
    setLoading(true);
    const p = new URLSearchParams({ range: controls.range });
    if (controls.range === "custom") {
      p.set("from", controls.from);
      p.set("to", controls.to);
    }
    if (controls.category) p.set("category_id", controls.category);
    if (controls.staff) p.set("staff_id", controls.staff);
    api(`/api/crm/report?${p}`).then((res) => {
      if (id !== requestId.current) return;
      setLoading(false);
      if (!res.ok) return setError(res.body.error || "Could not load the figures");
      setError(null);
      setReport(res.body);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { report, error, loading };
}

export function ReportControls({ value, onChange }: { value: Controls; onChange: (c: Controls) => void }) {
  const { meta } = useCrm();
  const set = (patch: Partial<Controls>) => onChange({ ...value, ...patch });
  return (
    <div className="crm-filters" style={{ marginBottom: "1rem" }}>
      <div className="field">
        <label>Period</label>
        <select value={value.range} onChange={(e) => set({ range: e.target.value })}>
          {PRESETS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {value.range === "custom" && (
        <>
          <div className="field">
            <label>From</label>
            <input type="date" value={value.from} max={value.to || undefined} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={value.to} min={value.from || undefined} onChange={(e) => set({ to: e.target.value })} />
          </div>
        </>
      )}
      <div className="field">
        <label>Category</label>
        <select value={value.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">All</option>
          {meta?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="none">No category</option>
        </select>
      </div>
      <div className="field">
        <label>Person</label>
        <select value={value.staff} onChange={(e) => set({ staff: e.target.value })}>
          <option value="">Everyone</option>
          {meta?.assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {personName(a.email)}
              {a.id === meta.me ? " (me)" : ""}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function StatTile({ label, value, sub, hint, tone, active, onClick, note }: { label: string; value: string; sub?: string; hint: string; tone?: "bad" | "good"; active: boolean; onClick: () => void; note?: string }) {
  return (
    <button
      type="button"
      className="stat-card"
      onClick={onClick}
      title={`${hint} Click to see the records.`}
      aria-pressed={active}
      style={{ textAlign: "left", cursor: "pointer", outline: active ? "2px solid var(--accent)" : undefined, font: "inherit", color: "inherit", background: "var(--card)" }}
    >
      <div className="stat-value" style={{ color: tone === "bad" ? "#b3261e" : tone === "good" ? "#2e7d32" : undefined }}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
      {sub && <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
      {note && <div style={{ fontSize: "0.72rem", color: "#b98900", marginTop: 2 }}>{note}</div>}
    </button>
  );
}

/** The records behind a figure: who, what and when, each linking to the company. */
export function DrillPanel({ title, hint, metric, onClose }: { title: string; hint: string; metric: MetricValue; onClose: () => void }) {
  const when = (r: DrillRow) => (!r.at ? "—" : r.at.length === 10 ? fmtDate(r.at) : fmtDateTime(r.at));
  return (
    <div className="card" style={{ borderColor: "var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <p style={{ margin: "0.2rem 0 0.75rem", fontSize: "0.82rem", color: "var(--muted)" }}>{hint}</p>
        </div>
        <button className="btn btn-secondary" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={onClose}>
          Close
        </button>
      </div>
      {metric.note && <p style={{ fontSize: "0.82rem", color: "#b98900" }}>{metric.note}</p>}
      {metric.rows.length === 0 ? (
        <p style={{ margin: 0, color: "var(--muted)" }}>Nothing to show for this period.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>What</th>
                <th>Who</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {metric.rows.map((r, i) => (
                <tr key={`${r.companyId}-${i}`} style={{ cursor: "default" }}>
                  <td style={{ fontWeight: 600 }}>
                    <Link href={`/dashboard/crm/companies/${r.companyId}`} style={{ color: "inherit" }}>
                      {r.company}
                    </Link>
                  </td>
                  <td style={{ whiteSpace: "normal" }}>{r.detail || "—"}</td>
                  <td>{r.who ?? "—"}</td>
                  <td>{when(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {metric.total > metric.rows.length && <p style={{ margin: "0.6rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>Showing the {metric.rows.length} most recent of {metric.total}.</p>}
    </div>
  );
}

/** A horizontal bar for each step: one hue, the count and share written beside it, and the zero line at the left. */
export function FunnelBars({ steps, enough, cohortLabel }: { steps: FunnelStep[]; enough: boolean; cohortLabel: string }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <div role="group" aria-label={`${cohortLabel}: ${steps.map((s) => `${s.label} ${s.count}`).join(", ")}`}>
      {steps.map((s) => (
        <div key={s.key} style={{ display: "grid", gridTemplateColumns: "150px 1fr 120px", gap: "0.6rem", alignItems: "center", marginBottom: "0.4rem", fontSize: "0.85rem" }}>
          <span>{s.label}</span>
          <span style={{ background: "var(--accent-soft)", borderRadius: 4, height: 14, display: "block" }} title={`${s.label}: ${s.count}${s.share !== null ? ` (${pct(s.share)})` : ""}`}>
            <span style={{ display: "block", height: "100%", width: `${(s.count / max) * 100}%`, minWidth: s.count > 0 ? 3 : 0, background: "var(--accent)", borderRadius: 4 }} />
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            <strong>{s.count}</strong>
            {enough && s.share !== null ? <span style={{ color: "var(--muted)" }}> · {pct(s.share)}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Columns for each day (or week), starting at zero, with the busiest value written on the chart. */
export function TrendBars({ points, field, label, bucket }: { points: { date: string; added: number; contacts: number }[]; field: "added" | "contacts"; label: string; bucket: "day" | "week" }) {
  const max = Math.max(1, ...points.map((p) => p[field]));
  const total = points.reduce((n, p) => n + p[field], 0);
  const fmt = (d: string) => fmtDate(d);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: 4 }}>
        <strong>{label}</strong>
        <span style={{ color: "var(--muted)" }}>
          {total} in total{bucket === "week" ? ", by week" : ""}
        </span>
      </div>
      <div role="img" aria-label={`${label} by ${bucket}: ${points.map((p) => `${fmt(p.date)} ${p[field]}`).join(", ")}`} style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 90, borderBottom: "1px solid var(--border)" }}>
        {points.map((p) => (
          <div key={p.date} style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end" }} title={`${bucket === "week" ? "Week of " : ""}${fmt(p.date)}: ${p[field]}`}>
            <div style={{ width: "100%", height: `${(p[field] / max) * 100}%`, minHeight: p[field] > 0 ? 2 : 0, background: "var(--accent)", borderRadius: "3px 3px 0 0" }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--muted)", marginTop: 3 }}>
        <span>{fmt(points[0]?.date)}</span>
        <span>peak {max === 1 && total === 0 ? 0 : max}</span>
        <span>{fmt(points[points.length - 1]?.date)}</span>
      </div>
    </div>
  );
}

/**
 * One row per county. The first columns are how things stand now (whatever the period); the last four are for the period
 * chosen above. A county's name opens the company list for that county.
 */
export function TerritoryTable({ rows, linked = true }: { rows: TerritoryRow[]; linked?: boolean }) {
  const total = (f: (r: TerritoryRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const wrap = { whiteSpace: "normal" as const };
  const dim = (r: TerritoryRow) => (r.companies === 0 ? { color: "var(--muted)" } : undefined);
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>County</th>
            <th style={wrap}>Companies</th>
            <th style={wrap}>Not contacted yet</th>
            <th style={wrap}>Follow-ups overdue</th>
            <th style={wrap}>Due today</th>
            <th style={wrap}>Open opportunities</th>
            <th style={wrap}>Contacts made</th>
            <th style={wrap}>Added</th>
            <th>Won</th>
            <th style={wrap}>Confirmed sales</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} style={{ cursor: "default", ...dim(r) }}>
              <td style={{ fontWeight: 600 }}>
                {linked && r.companies > 0 ? (
                  <Link href={`/dashboard/crm/companies?county=${encodeURIComponent(r.key)}`} title={`See the companies in ${r.label}`}>
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
              </td>
              <td>{r.companies}</td>
              <td>{r.awaitingContact}</td>
              <td style={{ color: r.overdue > 0 ? "var(--critical)" : undefined, fontWeight: r.overdue > 0 ? 600 : undefined }}>{r.overdue}</td>
              <td>{r.dueToday}</td>
              <td title={r.openOpportunities ? `Estimated ${fmtMoney(r.openEstimate)}. An estimate is a guess, not sales.` : undefined}>
                {r.openOpportunities}
                {r.openEstimate > 0 && <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}> ({fmtMoney(r.openEstimate)})</span>}
              </td>
              <td>{r.contactsMade}</td>
              <td>{r.added}</td>
              <td>{r.won}</td>
              <td>{r.wonValue ? fmtMoney(r.wonValue) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
            <td>All counties</td>
            <td>{total((r) => r.companies)}</td>
            <td>{total((r) => r.awaitingContact)}</td>
            <td>{total((r) => r.overdue)}</td>
            <td>{total((r) => r.dueToday)}</td>
            <td>{total((r) => r.openOpportunities)}</td>
            <td>{total((r) => r.contactsMade)}</td>
            <td>{total((r) => r.added)}</td>
            <td>{total((r) => r.won)}</td>
            <td>{total((r) => r.wonValue) ? fmtMoney(total((r) => r.wonValue)) : "—"}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
