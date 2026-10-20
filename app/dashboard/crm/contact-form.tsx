"use client";

import { useState } from "react";
import { CONTACT_METHODS, type ContactDuplicateMatch } from "@/lib/crm/types";
import type { ApiResult } from "./api";
import { useCrm } from "./crm-context";
import { personName } from "./fmt";

export type ContactFormValues = {
  full_name: string;
  job_title: string;
  email: string;
  phone: string;
  preferred_method: string;
  source: string;
  notes: string;
  assigned_to: string;
  next_follow_up: string;
};

export const EMPTY_CONTACT: ContactFormValues = { full_name: "", job_title: "", email: "", phone: "", preferred_method: "", source: "", notes: "", assigned_to: "", next_follow_up: "" };

export function toContactValues(c: Record<string, any>): ContactFormValues {
  const out: any = { ...EMPTY_CONTACT };
  for (const k of Object.keys(EMPTY_CONTACT)) out[k] = c[k] === null || c[k] === undefined ? "" : String(c[k]);
  return out;
}

export function changedContactFields(before: ContactFormValues, after: ContactFormValues): Partial<ContactFormValues> {
  const diff: Partial<ContactFormValues> = {};
  for (const k of Object.keys(after) as (keyof ContactFormValues)[]) if (after[k] !== before[k]) diff[k] = after[k];
  return diff;
}

/** Add or edit a person at a company. A likely duplicate is shown first and only saved on purpose. */
export default function ContactForm({
  initial,
  submitLabel,
  onSubmit,
  onDone,
  onCancel,
}: {
  initial: ContactFormValues;
  submitLabel: string;
  onSubmit: (values: ContactFormValues, confirmDuplicate: boolean) => Promise<ApiResult>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { meta } = useCrm();
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<ContactDuplicateMatch[] | null>(null);

  const set = (k: keyof ContactFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setV({ ...v, [k]: e.target.value });
    setDuplicates(null);
  };

  async function save(confirmDuplicate: boolean) {
    setSaving(true);
    setError(null);
    const res = await onSubmit(v, confirmDuplicate);
    setSaving(false);
    if (res.ok) return onDone();
    if (res.status === 409 && res.body.duplicates) return setDuplicates(res.body.duplicates);
    setError(res.body.error || "Could not save");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
      style={{ background: "var(--accent-soft)", borderRadius: 10, padding: "1rem", margin: "0.75rem 0" }}
    >
      <div className="crm-form-grid">
        <div className="field">
          <label>Full name *</label>
          <input value={v.full_name} onChange={set("full_name")} required maxLength={150} />
        </div>
        <div className="field">
          <label>Job title</label>
          <input value={v.job_title} onChange={set("job_title")} placeholder="e.g. Maintenance Manager" maxLength={120} />
        </div>
        <div className="field">
          <label>Business email</label>
          <input type="email" value={v.email} onChange={set("email")} maxLength={200} />
        </div>
        <div className="field">
          <label>Business phone or mobile</label>
          <input value={v.phone} onChange={set("phone")} maxLength={40} />
        </div>
        <div className="field">
          <label>Preferred contact method</label>
          <select value={v.preferred_method} onChange={set("preferred_method")}>
            <option value="">Not known</option>
            {CONTACT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Contact source</label>
          <input value={v.source} onChange={set("source")} placeholder="e.g. LinkedIn, referral" maxLength={120} />
        </div>
        <div className="field">
          <label>Assigned to</label>
          <select value={v.assigned_to} onChange={set("assigned_to")}>
            <option value="">Unassigned</option>
            {meta?.assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {personName(a.email)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Next follow-up date</label>
          <input type="date" value={v.next_follow_up} onChange={set("next_follow_up")} />
        </div>
        <div className="field wide-field">
          <label>Notes</label>
          <textarea rows={2} value={v.notes} onChange={set("notes")} maxLength={4000} />
        </div>
      </div>
      <p style={{ margin: "0.6rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>Business contact details only, please.</p>

      {duplicates && (
        <div style={{ margin: "0.75rem 0 0", padding: "0.75rem", border: "1px solid #b98900", borderRadius: 8, background: "rgba(185, 137, 0, 0.07)" }}>
          <strong style={{ fontSize: "0.9rem" }}>This looks like a contact that is already in the CRM</strong>
          <ul style={{ margin: "0.4rem 0", paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
            {duplicates.map((d) => (
              <li key={d.id}>
                {d.full_name}
                {d.company_name ? ` at ${d.company_name}` : ""} <span style={{ color: "var(--muted)" }}>({d.reasons.join(", ")})</span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-secondary" onClick={() => save(true)} disabled={saving}>
            It is a different person, save it anyway
          </button>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.9rem" }}>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Saving..." : submitLabel}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
