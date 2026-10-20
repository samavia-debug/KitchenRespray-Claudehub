"use client";

import { useState } from "react";
import type { Stage } from "@/lib/crm/types";

const COPY: Record<string, { title: (n: string) => string; note: string; button: string }> = {
  won: { title: (n) => `Mark ${n} as Won`, note: "What was the job, and anything worth remembering?", button: "Mark as Won" },
  lost: { title: (n) => `Mark ${n} as Lost`, note: "Why was it lost? (optional)", button: "Mark as Lost" },
  not_suitable: { title: (n) => `Mark ${n} as Not Suitable`, note: "Why is it not suitable? (optional)", button: "Mark as Not Suitable" },
};

/**
 * Closing a deal is not undone by accident: this asks for confirmation and takes the outcome. The value
 * is only asked for on a win, and is kept apart from the estimate (an estimate is never counted as revenue).
 */
export default function StageDialog({
  companyName,
  stage,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  companyName: string;
  stage: Stage;
  busy: boolean;
  error: string | null;
  onConfirm: (v: { outcome_note: string; won_value: string }) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [value, setValue] = useState("");
  const copy = COPY[stage.kind] ?? COPY.lost;

  return (
    <div className="crm-modal" role="dialog" aria-modal="true" aria-label={copy.title(companyName)}>
      <div>
        <h2 style={{ marginTop: 0 }}>{copy.title(companyName)}</h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: "var(--muted)" }}>
          {companyName} will move to <strong>{stage.name}</strong>. This is recorded with your name and the date.
        </p>
        {stage.kind === "won" && (
          <div className="field">
            <label>Value won (€), if known</label>
            <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 12500" />
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>Leave blank if you do not have the final figure yet.</div>
          </div>
        )}
        <div className="field">
          <label>{copy.note}</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </div>
        {error && <p className="error-text" style={{ marginTop: 0 }}>{error}</p>}
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={() => onConfirm({ outcome_note: note, won_value: value })} disabled={busy}>
            {busy ? "Saving..." : copy.button}
          </button>
        </div>
      </div>
    </div>
  );
}
