"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanyRow, StageSummary } from "@/lib/crm/service";
import { CLOSING_KINDS, type Stage } from "@/lib/crm/types";
import { api } from "../api";
import { StageBadge } from "../badges";
import { useCrm } from "../crm-context";
import { FOLLOW_UP_COLOR, PRIORITY_COLOR, fmtDate, fmtMoney, followUpState, personName } from "../fmt";
import StageDialog from "../stage-dialog";

const COLUMN_SIZE = 20;

type Column = { rows: CompanyRow[]; total: number; page: number; loading: boolean };

export default function PipelinePage() {
  const router = useRouter();
  const { meta } = useCrm();
  const [assigned, setAssigned] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [summary, setSummary] = useState<StageSummary[] | null>(null);
  const [columns, setColumns] = useState<Record<string, Column>>({});
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const [pending, setPending] = useState<{ company: CompanyRow; stage: Stage } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const runId = useRef(0);

  const stages = meta?.stages.filter((s) => s.active) ?? [];

  // The search box waits for a pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQApplied(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filterParams = useCallback(() => {
    const p = new URLSearchParams();
    if (assigned) p.set("assigned_to", assigned);
    if (category) p.set("category_id", category);
    return p;
  }, [assigned, category]);

  const loadColumn = useCallback(
    async (stageId: string, page: number, append: boolean) => {
      const p = filterParams();
      p.set("stage_id", stageId);
      p.set("pageSize", String(COLUMN_SIZE));
      p.set("page", String(page));
      p.set("sort", "updated_at");
      p.set("dir", "desc");
      if (qApplied) p.set("q", qApplied);
      setColumns((c) => ({ ...c, [stageId]: { ...(c[stageId] ?? { rows: [], total: 0, page: 1 }), loading: true } }));
      const res = await api(`/api/crm/companies?${p}`);
      if (!res.ok) {
        setError(res.body.error || "Could not load the pipeline");
        setColumns((c) => ({ ...c, [stageId]: { ...(c[stageId] ?? { rows: [], total: 0, page: 1 }), loading: false } }));
        return;
      }
      setColumns((c) => ({
        ...c,
        [stageId]: { rows: append ? [...(c[stageId]?.rows ?? []), ...res.body.companies] : res.body.companies, total: res.body.total, page, loading: false },
      }));
    },
    [filterParams, qApplied]
  );

  const loadAll = useCallback(async () => {
    if (!meta) return;
    const id = ++runId.current;
    setError(null);
    const [sum] = await Promise.all([api(`/api/crm/pipeline?${filterParams()}`), ...meta.stages.filter((s) => s.active).map((s) => loadColumn(s.id, 1, false))]);
    if (id !== runId.current) return;
    if (sum.ok) setSummary(sum.body.stages);
    else setError(sum.body.error || "Could not load the pipeline");
  }, [meta, filterParams, loadColumn]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function move(company: CompanyRow, stage: Stage, extra?: { outcome_note: string; won_value: string }) {
    setBusy(true);
    setDialogError(null);
    const res = await api(`/api/crm/companies/${company.id}/stage`, {
      method: "POST",
      body: { stage_id: stage.id, confirmed: CLOSING_KINDS.includes(stage.kind), outcome_note: extra?.outcome_note, won_value: extra?.won_value },
    });
    setBusy(false);
    if (!res.ok) {
      if (pending) setDialogError(res.body.error || "Could not change the stage");
      else setMessage(res.body.error || "Could not change the stage");
      return;
    }
    setPending(null);
    setMessage(`${company.name} moved to ${stage.name}.`);
    loadAll();
  }

  function requestMove(company: CompanyRow, stageId: string) {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage || stage.id === company.stage_id) return;
    setMessage(null);
    if (CLOSING_KINDS.includes(stage.kind)) {
      setDialogError(null);
      setPending({ company, stage });
    } else move(company, stage);
  }

  function showList(stageId: string) {
    try {
      sessionStorage.setItem("crm-company-filters", JSON.stringify({ stage_id: stageId, assigned_to: assigned, category_id: category }));
    } catch {
      /* the list just opens unfiltered */
    }
    router.push("/dashboard/crm/companies");
  }

  const find = (id: string | null) => summary?.find((s) => s.stage_id === id);
  const draggedCompany = dragging ? Object.values(columns).flatMap((c) => c.rows).find((r) => r.id === dragging) : null;
  const totalCompanies = summary?.reduce((n, s) => n + s.count, 0) ?? 0;

  return (
    <>
      <div className="card">
        <div className="crm-filters">
          <div className="field">
            <label>Assigned to</label>
            <select value={assigned} onChange={(e) => setAssigned(e.target.value)}>
              <option value="">Anyone</option>
              <option value="none">Unassigned</option>
              {meta?.assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {personName(a.email)}
                  {a.id === meta.me ? " (me)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All</option>
              {meta?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Search the board</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company, contact, town..." />
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        {message && <p style={{ margin: "0.75rem 0 0", fontSize: "0.85rem" }}>{message}</p>}
      </div>

      <div className="card">
        <h2>Pipeline summary</h2>
        {!summary ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Companies</th>
                  <th>Estimated value (a guess, not sales)</th>
                  <th>Value won (recorded)</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => {
                  const row = find(s.id);
                  return (
                    <tr key={s.id} onClick={() => showList(s.id)}>
                      <td>
                        <StageBadge name={s.name} kind={s.kind} />
                      </td>
                      <td>{row?.count ?? 0}</td>
                      <td>{s.kind === "open" ? (row?.estimated_total ? fmtMoney(row.estimated_total) : "—") : "—"}</td>
                      <td>{s.kind === "won" ? (row?.won_total ? fmtMoney(row.won_total) : "—") : "—"}</td>
                    </tr>
                  );
                })}
                {find(null) && (
                  <tr onClick={() => router.push("/dashboard/crm/companies")}>
                    <td>No stage</td>
                    <td>{find(null)!.count}</td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
          {totalCompanies} companies in total. Click a stage to open its list. Estimates are only a guide; sales are the values recorded when a deal is marked Won.
        </p>
      </div>

      <h2 style={{ fontSize: "1.05rem", margin: "0 0 0.6rem" }}>Board</h2>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "var(--muted)" }}>Drag a card to another stage, or use its Move menu. Won, Lost and Not Suitable ask you to confirm first.</p>
      <div className="crm-board">
        {stages.map((s) => {
          const col = columns[s.id];
          return (
            <div
              key={s.id}
              className={`crm-column${dropOver === s.id ? " drop" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDropOver(s.id);
              }}
              onDragLeave={() => setDropOver((d) => (d === s.id ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                setDropOver(null);
                if (draggedCompany) requestMove(draggedCompany, s.id);
                setDragging(null);
              }}
            >
              <h3>
                <span>{s.name}</span>
                <span style={{ color: "var(--muted)", fontWeight: 500 }}>{col ? col.total : "…"}</span>
              </h3>
              {col?.rows.map((c) => {
                const fu = followUpState(c.next_follow_up);
                return (
                  <div key={c.id} className="crm-card" draggable onDragStart={() => setDragging(c.id)} onDragEnd={() => setDragging(null)}>
                    <Link href={`/dashboard/crm/companies/${c.id}`}>{c.name}</Link>
                    <div style={{ color: "var(--muted)", marginTop: 2 }}>
                      <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: PRIORITY_COLOR[c.priority], marginRight: 5 }} title={`${c.priority} priority`} />
                      {[c.city, c.category_name].filter(Boolean).join(" · ") || "No details"}
                    </div>
                    <div style={{ color: "var(--muted)" }}>{c.assignee_email ? personName(c.assignee_email) : "Unassigned"}</div>
                    {c.estimated_value !== null && <div style={{ color: "var(--muted)" }}>Est. {fmtMoney(c.estimated_value)}</div>}
                    {c.next_follow_up && (
                      <div style={{ color: FOLLOW_UP_COLOR[fu], fontWeight: fu === "overdue" || fu === "today" ? 600 : undefined }}>Follow up {fmtDate(c.next_follow_up)}</div>
                    )}
                    <select value="" onChange={(e) => requestMove(c, e.target.value)} aria-label={`Move ${c.name} to stage`}>
                      <option value="">Move to...</option>
                      {stages
                        .filter((x) => x.id !== c.stage_id)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                    </select>
                  </div>
                );
              })}
              {col && col.rows.length === 0 && !col.loading && <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>Nothing here</p>}
              {col && col.rows.length < col.total && (
                <button className="btn btn-secondary" style={{ width: "100%", padding: "0.3rem", fontSize: "0.78rem" }} disabled={col.loading} onClick={() => loadColumn(s.id, col.page + 1, true)}>
                  {col.loading ? "Loading..." : `Show more (${col.total - col.rows.length})`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {pending && (
        <StageDialog
          companyName={pending.company.name}
          stage={pending.stage}
          busy={busy}
          error={dialogError}
          onConfirm={(v) => move(pending.company, pending.stage, v)}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
