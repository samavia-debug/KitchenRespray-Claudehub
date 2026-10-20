"use client";

import { useState } from "react";
import { ACTIVITY_TYPES } from "@/lib/crm/types";
import { api } from "./api";
import { useCrm } from "./crm-context";
import { personName } from "./fmt";
import QuickDate from "./quick-date";

export type CompletableTask = { id: string; title: string; company_name?: string | null; assigned_to?: string | null };

/**
 * Finish a follow-up: say what happened, optionally record it as an activity (only if it really happened), and
 * set the next follow-up in the same step. Nothing is recorded as a call or email unless the person chooses it.
 */
export default function CompleteDialog({ task, onClose, onDone }: { task: CompletableTask; onClose: () => void; onDone: () => void }) {
  const { meta } = useCrm();
  const [result, setResult] = useState("");
  const [activity, setActivity] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [nextTitle, setNextTitle] = useState(task.title);
  const [nextOwner, setNextOwner] = useState(task.assigned_to ?? meta?.me ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await api(`/api/crm/tasks/${task.id}/complete`, {
      method: "POST",
      body: { result, activity_type: activity || null, next: nextDate ? { due_date: nextDate, title: nextTitle, assigned_to: nextOwner || null } : null },
    });
    setBusy(false);
    if (!res.ok) return setError(res.body.error || "Could not complete the follow-up");
    onDone();
  }

  return (
    <div className="crm-modal" role="dialog" aria-modal="true" aria-label="Complete follow-up">
      <div style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Complete follow-up</h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: "var(--muted)" }}>
          <strong>{task.title}</strong>
          {task.company_name ? ` at ${task.company_name}` : ""}
        </p>

        <div className="field">
          <label>What happened?</label>
          <textarea rows={3} value={result} onChange={(e) => setResult(e.target.value)} maxLength={1000} placeholder="e.g. Spoke to Mick, wants a quote for 12 doors" autoFocus />
        </div>

        <div className="field">
          <label>Also record it as an activity</label>
          <select value={activity} onChange={(e) => setActivity(e.target.value)}>
            <option value="">No, just mark it done</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>Only choose one if it really happened. It then counts as the last time the company was contacted.</div>
        </div>

        <QuickDate label="Schedule another follow-up (optional)" value={nextDate} onChange={setNextDate} />
        {nextDate && (
          <>
            <div className="field">
              <label>What is the next follow-up?</label>
              <input value={nextTitle} onChange={(e) => setNextTitle(e.target.value)} maxLength={300} />
            </div>
            <div className="field">
              <label>Who has it?</label>
              <select value={nextOwner} onChange={(e) => setNextOwner(e.target.value)}>
                {meta?.assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {personName(a.email)}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {error && <p className="error-text" style={{ marginTop: 0 }}>{error}</p>}
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? "Saving..." : "Mark as done"}
          </button>
        </div>
      </div>
    </div>
  );
}
