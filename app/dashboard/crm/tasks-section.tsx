"use client";

import { useCallback, useEffect, useState } from "react";
import { dublinToday } from "@/lib/crm/followups";
import type { Task } from "@/lib/crm/types";
import { api } from "./api";
import CompleteDialog from "./complete-dialog";
import { useCrm } from "./crm-context";
import { FOLLOW_UP_COLOR, fmtDate, fmtDateTime, followUpState, personName } from "./fmt";
import QuickDate from "./quick-date";

/** A company's follow-ups: what is still to do (with who and when), and the last few things that were done. */
export default function TasksSection({ companyId, contacts, onChanged, refreshKey }: { companyId: string; contacts: { id: string; full_name: string }[]; onChanged: () => void; refreshKey?: number }) {
  const { meta } = useCrm();
  const [open, setOpen] = useState<Task[] | null>(null);
  const [done, setDone] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [owner, setOwner] = useState("");
  const [contactId, setContactId] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<Task | null>(null);
  const [rescheduling, setRescheduling] = useState<{ id: string; date: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api(`/api/crm/tasks?company_id=${companyId}`);
    if (!res.ok) return setError(res.body.error || "Could not load the follow-ups");
    setError(null);
    setOpen(res.body.open);
    setDone(res.body.done);
  }, [companyId]);

  // Reloads when the page says something elsewhere on it changed (an activity can create a follow-up).
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const changed = async () => {
    await load();
    onChanged();
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const res = await api("/api/crm/tasks", { method: "POST", body: { company_id: companyId, title, due_date: due, assigned_to: owner || meta?.me, contact_id: contactId || null } });
    setSaving(false);
    if (!res.ok) return setFormError(res.body.error || "Could not save the follow-up");
    setTitle("");
    setDue("");
    setContactId("");
    setAdding(false);
    setNote("Follow-up set.");
    await changed();
  }

  async function reschedule() {
    if (!rescheduling?.date) return;
    const res = await api(`/api/crm/tasks/${rescheduling.id}`, { method: "PATCH", body: { due_date: rescheduling.date } });
    if (!res.ok) return setNote(res.body.error || "Could not change the date");
    setRescheduling(null);
    setNote("Date changed.");
    await changed();
  }

  async function cancel(t: Task) {
    if (!window.confirm(`Remove the follow-up "${t.title}"? It is kept as cancelled.`)) return;
    const res = await api(`/api/crm/tasks/${t.id}`, { method: "DELETE" });
    if (!res.ok) return setNote(res.body.error || "Could not remove it");
    setNote(null);
    await changed();
  }

  async function reassign(t: Task, assigned_to: string) {
    const res = await api(`/api/crm/tasks/${t.id}`, { method: "PATCH", body: { assigned_to } });
    if (!res.ok) return setNote(res.body.error || "Could not change who has it");
    setNote(null);
    await changed();
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Follow-ups{open ? ` (${open.length})` : ""}</h2>
        {!adding && (
          <button
            className="btn btn-secondary"
            onClick={() => {
              setOwner(meta?.me ?? "");
              setAdding(true);
              setNote(null);
            }}
          >
            + Add follow-up
          </button>
        )}
      </div>
      {note && <p style={{ margin: "0 0 0.6rem", fontSize: "0.85rem" }}>{note}</p>}

      {adding && (
        <form onSubmit={add} style={{ background: "var(--accent-soft)", borderRadius: 10, padding: "1rem", margin: "0.5rem 0 1rem" }}>
          <div className="crm-form-grid">
            <div className="field wide-field">
              <label>What needs doing? *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} placeholder="e.g. Phone Mick about the quote" autoFocus />
            </div>
            <QuickDate label="Due *" value={due} onChange={setDue} />
            <div className="field">
              <label>Who has it?</label>
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                {meta?.assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {personName(a.email)}
                    {a.id === meta.me ? " (me)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>About</label>
              <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">The company in general</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {formError && <p className="error-text">{formError}</p>}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.9rem" }}>
            <button className="btn" type="submit" disabled={saving || !due}>
              {saving ? "Saving..." : "Save follow-up"}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setAdding(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="error-text">{error}</p>}
      {!open && !error && <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>}
      {open && open.length === 0 && !adding && <p style={{ color: "var(--muted)", margin: 0 }}>Nothing to follow up. Add one so this company is not forgotten.</p>}

      {open?.map((t) => {
        const state = followUpState(t.due_date);
        return (
          <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", padding: "0.7rem 0", borderTop: "1px solid var(--border)" }}>
            <div style={{ minWidth: 220 }}>
              <div style={{ fontWeight: 600 }}>{t.title}</div>
              <div style={{ fontSize: "0.8rem", color: FOLLOW_UP_COLOR[state], fontWeight: state === "overdue" || state === "today" ? 600 : undefined }}>
                {state === "overdue" ? "Overdue, was due " : "Due "}
                {fmtDate(t.due_date)}
                {state === "today" ? " (today)" : ""}
                {t.contact_name ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · about {t.contact_name}</span> : null}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
              <select style={{ width: "auto", fontSize: "0.8rem", padding: "0.3rem 0.4rem" }} value={t.assigned_to ?? ""} onChange={(e) => reassign(t, e.target.value)} aria-label={`Who has ${t.title}`}>
                {!t.assigned_to && <option value="">Unassigned</option>}
                {meta?.assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {personName(a.email)}
                  </option>
                ))}
              </select>
              {rescheduling?.id === t.id ? (
                <>
                  <input type="date" style={{ width: "auto" }} value={rescheduling.date} min={dublinToday()} onChange={(e) => setRescheduling({ id: t.id, date: e.target.value })} />
                  <button className="btn" style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }} disabled={!rescheduling.date} onClick={reschedule}>
                    Save date
                  </button>
                  <button className="btn btn-secondary" style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }} onClick={() => setRescheduling(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button className="btn" style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }} onClick={() => setCompleting(t)}>
                    Complete
                  </button>
                  <button className="btn btn-secondary" style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }} onClick={() => setRescheduling({ id: t.id, date: t.due_date })}>
                    Change date
                  </button>
                  <button className="btn btn-secondary" style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }} onClick={() => cancel(t)}>
                    Remove
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {done.length > 0 && (
        <details style={{ marginTop: "0.9rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "var(--muted)" }}>Recently completed ({done.length})</summary>
          {done.map((t) => (
            <div key={t.id} style={{ padding: "0.5rem 0", borderTop: "1px solid var(--border)", fontSize: "0.85rem" }}>
              <strong>{t.title}</strong> <span style={{ color: "var(--muted)" }}>done {fmtDateTime(t.completed_at)}</span>
              {t.result && <div style={{ color: "var(--muted)" }}>{t.result}</div>}
            </div>
          ))}
        </details>
      )}

      {completing && (
        <CompleteDialog
          task={{ id: completing.id, title: completing.title, company_name: null, assigned_to: completing.assigned_to }}
          onClose={() => setCompleting(null)}
          onDone={async () => {
            setCompleting(null);
            setNote("Marked as done.");
            await changed();
          }}
        />
      )}
    </div>
  );
}
