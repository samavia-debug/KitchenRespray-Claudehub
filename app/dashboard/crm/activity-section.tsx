"use client";

import { useCallback, useEffect, useState } from "react";
import { ACTIVITY_TYPES, type Activity } from "@/lib/crm/types";
import { api } from "./api";
import { useCrm } from "./crm-context";
import { fmtDate, fmtDateTime, personName } from "./fmt";
import QuickDate from "./quick-date";

/** The local date and time for a datetime-local box, to the minute (so it is never ahead of the clock). */
function localNow(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Form = { type: string; contact_id: string; when: string; user_id: string; outcome: string; notes: string; next_action: string; next_follow_up: string };

/**
 * Record what was done at a company in one short form, and read the history. It is a record of things a person
 * did: nothing here sends a message or makes a call, and an activity cannot be dated in the future.
 */
export default function ActivitySection({ companyId, contacts, onChanged, refreshKey }: { companyId: string; contacts: { id: string; full_name: string }[]; onChanged: () => void; refreshKey?: number }) {
  const { meta } = useCrm();
  const isOverseer = meta?.role === "Admin" || meta?.role === "Manager";
  const blank = useCallback((): Form => ({ type: "Telephone call", contact_id: "", when: localNow(), user_id: meta?.me ?? "", outcome: "", notes: "", next_action: "", next_follow_up: "" }), [meta?.me]);

  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(blank());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api(`/api/crm/activities?company_id=${companyId}`);
    if (!res.ok) return setError(res.body.error || "Could not load the activity history");
    setError(null);
    setActivities(res.body.activities);
  }, [companyId]);

  // Reloads when the page says something elsewhere on it changed (completing a follow-up can record an activity).
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const res = await api("/api/crm/activities", {
      method: "POST",
      body: {
        company_id: companyId,
        type: form.type,
        contact_id: form.contact_id || null,
        occurred_at: form.when ? new Date(form.when).toISOString() : null,
        user_id: form.user_id || null,
        outcome: form.outcome,
        notes: form.notes,
        next_action: form.next_action,
        next_follow_up: form.next_follow_up || null,
      },
    });
    setSaving(false);
    if (!res.ok) return setFormError(res.body.error || "Could not save the activity");
    setMessage(res.body.taskId ? "Recorded, and the follow-up is set." : "Recorded.");
    setForm(blank());
    setOpen(false);
    await load();
    onChanged();
  }

  async function remove(a: Activity) {
    if (!window.confirm(`Delete this ${a.type.toLowerCase()} from the history? This cannot be undone.`)) return;
    const res = await api(`/api/crm/activities/${a.id}`, { method: "DELETE" });
    if (!res.ok) return setMessage(res.body.error || "Could not delete it");
    setMessage(null);
    await load();
    onChanged();
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Activity</h2>
        {!open && (
          <button
            className="btn"
            onClick={() => {
              setForm(blank());
              setOpen(true);
              setMessage(null);
            }}
          >
            + Log activity
          </button>
        )}
      </div>
      {message && <p style={{ margin: "0 0 0.6rem", fontSize: "0.85rem" }}>{message}</p>}

      {open && (
        <form onSubmit={save} style={{ background: "var(--accent-soft)", borderRadius: 10, padding: "1rem", margin: "0.5rem 0 1rem" }}>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "var(--muted)" }}>Record something you have done. This only logs it: nothing is sent from here.</p>
          <div className="crm-form-grid">
            <div className="field">
              <label>What did you do? *</label>
              <select value={form.type} onChange={set("type")}>
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Who with</label>
              <select value={form.contact_id} onChange={set("contact_id")}>
                <option value="">The company in general</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>When</label>
              <input type="datetime-local" value={form.when} max={localNow()} onChange={set("when")} />
            </div>
            <div className="field">
              <label>Done by</label>
              <select value={form.user_id} onChange={set("user_id")}>
                {meta?.assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {personName(a.email)}
                    {a.id === meta.me ? " (me)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field wide-field">
              <label>Outcome</label>
              <input value={form.outcome} onChange={set("outcome")} maxLength={1000} placeholder="e.g. Interested, asked for a brochure" autoFocus />
            </div>
            <div className="field wide-field">
              <label>Notes</label>
              <textarea rows={2} value={form.notes} onChange={set("notes")} maxLength={4000} />
            </div>
            <div className="field">
              <label>Next action</label>
              <input value={form.next_action} onChange={set("next_action")} maxLength={300} placeholder="e.g. Phone Mick about the quote" />
              {form.next_action && !form.next_follow_up && <div style={{ fontSize: "0.72rem", color: "#b98900", marginTop: "0.25rem" }}>Pick a date to set this as a follow-up.</div>}
            </div>
            <QuickDate label="Follow up on" value={form.next_follow_up} onChange={(v) => setForm({ ...form, next_follow_up: v })} />
          </div>
          {formError && <p className="error-text">{formError}</p>}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.9rem" }}>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Record activity"}
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="error-text">{error}</p>}
      {!activities && !error && <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>}
      {activities && activities.length === 0 && !open && <p style={{ color: "var(--muted)", margin: 0 }}>Nothing recorded yet. Log the first call, email or visit.</p>}

      {activities?.map((a) => (
        <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.7rem 0", borderTop: "1px solid var(--border)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>
              {a.type}
              {a.contact_name ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> with {a.contact_name}</span> : null}
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
              {fmtDateTime(a.occurred_at)} · {personName(a.user_email)}
            </div>
            {a.outcome && <div style={{ fontSize: "0.88rem", marginTop: 3 }}>{a.outcome}</div>}
            {a.notes && <div style={{ fontSize: "0.82rem", color: "var(--muted)", whiteSpace: "pre-line", marginTop: 2 }}>{a.notes}</div>}
            {(a.next_action || a.next_follow_up) && (
              <div style={{ fontSize: "0.8rem", marginTop: 3 }}>
                Next: {a.next_action || "Follow up"}
                {a.next_follow_up ? ` (${fmtDate(a.next_follow_up)})` : ""}
              </div>
            )}
          </div>
          {isOverseer && (
            <button className="btn btn-secondary" style={{ padding: "0.25rem 0.55rem", fontSize: "0.75rem", color: "#b3261e", alignSelf: "flex-start" }} onClick={() => remove(a)}>
              Delete
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
