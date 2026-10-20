"use client";

import { useCallback, useEffect, useState } from "react";
import { OPPORTUNITY_SOURCES, OPPORTUNITY_STATUSES, OPPORTUNITY_STATUS_LABEL, type Opportunity, type OpportunityStatus, type Stage } from "@/lib/crm/types";
import { api } from "./api";
import { StageBadge } from "./badges";
import { useCrm } from "./crm-context";
import { fmtDate, fmtMoney, personName } from "./fmt";
import StageDialog from "./stage-dialog";

type Form = { title: string; description: string; estimated_value: string; source: string; assigned_to: string };
const EMPTY: Form = { title: "", description: "", estimated_value: "", source: "", assigned_to: "" };

const kindOf = (s: OpportunityStatus) => (s === "won" ? "won" : s === "lost" ? "lost" : "open");

/**
 * The separate jobs a company might give you. Each has its own status, a guess at its value (never counted as
 * sales), and, once won, the value actually won. The source says where it came from, so a sale is only credited to
 * direct prospecting when somebody recorded that it was.
 */
export default function OpportunitiesSection({ companyId, onChanged }: { companyId: string; onChanged: () => void }) {
  const { meta } = useCrm();
  const isOverseer = meta?.role === "Admin" || meta?.role === "Manager";
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ opp: Opportunity; status: OpportunityStatus } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api(`/api/crm/opportunities?company_id=${companyId}`);
    if (!res.ok) return setError(res.body.error || "Could not load the opportunities");
    setError(null);
    setItems(res.body.opportunities);
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  function startEdit(o: Opportunity | null) {
    setFormError(null);
    setNote(null);
    setEditing(o ? o.id : "new");
    setForm(o ? { title: o.title, description: o.description ?? "", estimated_value: o.estimated_value === null ? "" : String(o.estimated_value), source: o.source ?? "", assigned_to: o.assigned_to ?? "" } : { ...EMPTY, assigned_to: meta?.me ?? "" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const current = items?.find((o) => o.id === editing);
    const res =
      editing === "new"
        ? await api("/api/crm/opportunities", { method: "POST", body: { ...form, company_id: companyId } })
        : await api(`/api/crm/opportunities/${editing}`, { method: "PATCH", body: { ...form, expectedUpdatedAt: current?.updated_at } });
    setSaving(false);
    if (!res.ok) return setFormError(res.body.error || "Could not save the opportunity");
    setEditing(null);
    setNote("Saved.");
    await load();
    onChanged();
  }

  async function setStatus(o: Opportunity, status: OpportunityStatus, extra?: { outcome_note: string; won_value: string }) {
    setBusy(true);
    setDialogError(null);
    const res = await api(`/api/crm/opportunities/${o.id}/status`, {
      method: "POST",
      body: { status, confirmed: status === "won" || status === "lost", outcome_note: extra?.outcome_note, won_value: extra?.won_value },
    });
    setBusy(false);
    if (!res.ok) return closing ? setDialogError(res.body.error || "Could not change the status") : setNote(res.body.error || "Could not change the status");
    setClosing(null);
    setNote(`${o.title} is now ${OPPORTUNITY_STATUS_LABEL[status].toLowerCase()}.`);
    await load();
    onChanged();
  }

  function requestStatus(o: Opportunity, status: OpportunityStatus) {
    if (status === o.status) return;
    setNote(null);
    if (status === "won" || status === "lost") {
      setDialogError(null);
      setClosing({ opp: o, status });
    } else setStatus(o, status);
  }

  async function remove(o: Opportunity) {
    if (!window.confirm(`Delete the opportunity "${o.title}"? This cannot be undone.`)) return;
    const res = await api(`/api/crm/opportunities/${o.id}`, { method: "DELETE" });
    if (!res.ok) return setNote(res.body.error || "Could not delete it");
    await load();
    onChanged();
  }

  const formView = (
    <form onSubmit={save} style={{ background: "var(--accent-soft)", borderRadius: 10, padding: "1rem", margin: "0.5rem 0 1rem" }}>
      <div className="crm-form-grid">
        <div className="field wide-field">
          <label>What is the job? *</label>
          <input value={form.title} onChange={set("title")} required maxLength={200} placeholder="e.g. 40 hotel bedroom doors" autoFocus />
        </div>
        <div className="field wide-field">
          <label>Details</label>
          <textarea rows={2} value={form.description} onChange={set("description")} maxLength={2000} />
        </div>
        <div className="field">
          <label>Estimated value (€)</label>
          <input inputMode="decimal" value={form.estimated_value} onChange={set("estimated_value")} placeholder="A guess, not counted as sales" />
        </div>
        <div className="field">
          <label>Where did it come from?</label>
          <select value={form.source} onChange={set("source")}>
            <option value="">Not recorded</option>
            {OPPORTUNITY_SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Who is handling it?</label>
          <select value={form.assigned_to} onChange={set("assigned_to")}>
            <option value="">Unassigned</option>
            {meta?.assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {personName(a.email)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {formError && <p className="error-text">{formError}</p>}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.9rem" }}>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save opportunity"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={() => setEditing(null)} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Opportunities{items ? ` (${items.length})` : ""}</h2>
        {editing === null && (
          <button className="btn btn-secondary" onClick={() => startEdit(null)}>
            + Add opportunity
          </button>
        )}
      </div>
      <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>A company can have several potential jobs. Estimates are only a guide; sales are the value recorded when a job is marked Won.</p>
      {note && <p style={{ margin: "0 0 0.6rem", fontSize: "0.85rem" }}>{note}</p>}
      {editing === "new" && formView}
      {error && <p className="error-text">{error}</p>}
      {!items && !error && <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>}
      {items && items.length === 0 && editing === null && <p style={{ color: "var(--muted)", margin: 0 }}>No opportunities yet. Add one when you find a job they might need doing.</p>}

      {items?.map((o) =>
        editing === o.id ? (
          <div key={o.id}>{formView}</div>
        ) : (
          <div key={o.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", padding: "0.75rem 0", borderTop: "1px solid var(--border)" }}>
            <div style={{ minWidth: 240, flex: "1 1 240px" }}>
              <div style={{ fontWeight: 600 }}>{o.title}</div>
              {o.description && <div style={{ fontSize: "0.82rem", color: "var(--muted)", whiteSpace: "pre-line" }}>{o.description}</div>}
              <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 3 }}>
                {o.source ?? "Source not recorded"} · {o.assignee_email ? personName(o.assignee_email) : "Unassigned"} · changed {fmtDate(o.status_changed_at)}
              </div>
              {o.outcome_note && <div style={{ fontSize: "0.82rem", marginTop: 3 }}>{o.outcome_note}</div>}
            </div>
            <div style={{ fontSize: "0.85rem", minWidth: 150 }}>
              <StageBadge name={OPPORTUNITY_STATUS_LABEL[o.status]} kind={kindOf(o.status)} />
              <div style={{ marginTop: 4, color: "var(--muted)" }}>Estimate {fmtMoney(o.estimated_value)}</div>
              {o.status === "won" && <div style={{ fontWeight: 600 }}>Won {o.won_value !== null ? fmtMoney(o.won_value) : "(value not recorded)"}</div>}
            </div>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start", flexWrap: "wrap" }}>
              <select style={{ width: "auto", fontSize: "0.8rem", padding: "0.3rem 0.4rem" }} value="" onChange={(e) => requestStatus(o, e.target.value as OpportunityStatus)} aria-label={`Change status of ${o.title}`}>
                <option value="">Change status...</option>
                {OPPORTUNITY_STATUSES.filter((s) => s !== o.status).map((s) => (
                  <option key={s} value={s}>
                    {OPPORTUNITY_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <button className="btn btn-secondary" style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }} onClick={() => startEdit(o)}>
                Edit
              </button>
              {isOverseer && (
                <button className="btn btn-secondary" style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem", color: "#b3261e" }} onClick={() => remove(o)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        )
      )}

      {closing && (
        <StageDialog
          companyName={closing.opp.title}
          stage={{ id: closing.status, name: OPPORTUNITY_STATUS_LABEL[closing.status], kind: closing.status === "won" ? "won" : "lost", sort_order: 0, active: true } as Stage}
          busy={busy}
          error={dialogError}
          onConfirm={(v) => setStatus(closing.opp, closing.status, v)}
          onCancel={() => setClosing(null)}
        />
      )}
    </div>
  );
}
