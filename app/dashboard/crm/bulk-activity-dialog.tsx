"use client";

import { useState } from "react";
import { dublinToday } from "@/lib/crm/followups";
import { ACTIVITY_TYPES } from "@/lib/crm/types";
import { api } from "./api";
import { useCrm } from "./crm-context";
import { personName } from "./fmt";
import QuickDate from "./quick-date";

/**
 * Record one activity (for example the WhatsApp message that went out) against every selected company. The date is when
 * it was really sent, so the history and "last contacted" are right even when this is entered afterwards.
 */
export default function BulkActivityDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (message: string) => void }) {
  const { meta } = useCrm();
  const today = dublinToday();
  const [type, setType] = useState("WhatsApp message");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [nextAction, setNextAction] = useState("Follow up on WhatsApp");
  const [by, setBy] = useState(meta?.me ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const many = `${ids.length} compan${ids.length === 1 ? "y" : "ies"}`;

  async function submit() {
    if (!date) return setError("Say which day it was sent");
    if (!window.confirm(`Record "${type}" on ${date} against ${many}?`)) return;
    setBusy(true);
    setError(null);
    // Today means "now"; an earlier day is recorded at midday on that day.
    const occurred_at = date === today ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString();
    const res = await api("/api/crm/activities/bulk", {
      method: "POST",
      body: { ids, type, occurred_at, notes: notes.trim() || null, user_id: by || null, next_follow_up: nextDate || null, next_action: nextDate ? nextAction.trim() || null : null, confirmed: true },
    });
    setBusy(false);
    if (!res.ok) return setError(res.body.error || "Could not record the activity");
    const r = res.body as { logged: number; alreadyLogged: number; notFound: number; followUps: number };
    const parts = [`Recorded on ${r.logged} compan${r.logged === 1 ? "y" : "ies"}`];
    if (r.followUps) parts.push(`${r.followUps} follow-up${r.followUps === 1 ? "" : "s"} booked`);
    if (r.alreadyLogged) parts.push(`${r.alreadyLogged} already had it that day, so were skipped`);
    if (r.notFound) parts.push(`${r.notFound} could not be found`);
    onDone(`${parts.join(". ")}.`);
  }

  return (
    <div className="crm-modal" role="dialog" aria-modal="true" aria-label="Record an activity for the selected companies">
      <div style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Record an activity</h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: "var(--muted)" }}>
          This adds the same activity to <strong>{many}</strong>. Use it for something that has already happened, such as a WhatsApp sent to a list.
        </p>

        <div className="field">
          <label>What was done</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Day it was sent</label>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="field">
          <label>The message (kept in each company's history)</label>
          <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="Paste exactly what was sent" />
        </div>

        <div className="field">
          <label>Done by</label>
          <select value={by} onChange={(e) => setBy(e.target.value)}>
            {meta?.assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {personName(a.email)}
                {a.id === meta.me ? " (me)" : ""}
              </option>
            ))}
          </select>
        </div>

        <QuickDate label="Book a follow-up for each (optional)" value={nextDate} onChange={setNextDate} />
        {nextDate && (
          <div className="field">
            <label>What is the follow-up?</label>
            <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} maxLength={300} />
          </div>
        )}

        <p style={{ margin: "0 0 0.75rem", fontSize: "0.78rem", color: "var(--muted)" }}>
          A company that already has this kind of activity on the same day is skipped, so pressing the button twice does not record it twice.
        </p>
        {error && <p className="error-text" style={{ marginTop: 0 }}>{error}</p>}
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? "Recording..." : `Record on ${many}`}
          </button>
        </div>
      </div>
    </div>
  );
}
