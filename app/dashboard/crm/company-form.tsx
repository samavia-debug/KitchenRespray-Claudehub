"use client";

import Link from "next/link";
import { useState } from "react";
import { PRIORITIES, type DuplicateMatch } from "@/lib/crm/types";
import { COUNTY_CHOICES } from "@/lib/crm/territories";
import type { ApiResult } from "./api";
import { useCrm } from "./crm-context";
import { personName } from "./fmt";

export type CompanyFormValues = {
  name: string;
  category_id: string;
  website: string;
  phone: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  county: string;
  postcode: string;
  country: string;
  description: string;
  services: string;
  estimated_value: string;
  source: string;
  priority: string;
  assigned_to: string;
  notes: string;
};

export const EMPTY_COMPANY: CompanyFormValues = {
  name: "", category_id: "", website: "", phone: "", mobile: "", email: "", address: "", city: "", county: "", postcode: "", country: "Ireland",
  description: "", services: "", estimated_value: "", source: "", priority: "Medium", assigned_to: "", notes: "",
};

/** The form values for a company already saved (nulls become empty text so inputs stay controlled). */
export function toFormValues(c: Record<string, any>): CompanyFormValues {
  const out: any = { ...EMPTY_COMPANY };
  for (const k of Object.keys(EMPTY_COMPANY)) out[k] = c[k] === null || c[k] === undefined ? EMPTY_COMPANY[k as keyof CompanyFormValues] : String(c[k]);
  return out;
}

/** What to send when saving changes: only the fields that differ from what was loaded. */
export function changedFields(before: CompanyFormValues, after: CompanyFormValues): Partial<CompanyFormValues> {
  const diff: Partial<CompanyFormValues> = {};
  for (const k of Object.keys(after) as (keyof CompanyFormValues)[]) if (after[k] !== before[k]) diff[k] = after[k];
  return diff;
}

/**
 * Shared by "Add company" and "Edit". When the server says it looks like a company already in the CRM, the
 * matches are shown and nothing is saved until the person chooses to open the existing one or save anyway.
 */
export default function CompanyForm({
  initial,
  submitLabel,
  onSubmit,
  onDone,
  onCancel,
}: {
  initial: CompanyFormValues;
  submitLabel: string;
  onSubmit: (values: CompanyFormValues, confirmDuplicate: boolean) => Promise<ApiResult>;
  onDone: (body: any) => void;
  onCancel?: () => void;
}) {
  const { meta } = useCrm();
  const [v, setV] = useState<CompanyFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);

  const set = (k: keyof CompanyFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setV({ ...v, [k]: e.target.value });
    // A changed detail may no longer match, so the old warning is dropped and the check runs again on save.
    setDuplicates(null);
  };

  async function save(confirmDuplicate: boolean) {
    setSaving(true);
    setError(null);
    const res = await onSubmit(v, confirmDuplicate);
    setSaving(false);
    if (res.ok) return onDone(res.body);
    if (res.status === 409 && res.body.duplicates) return setDuplicates(res.body.duplicates);
    setError(res.body.error || "Could not save");
  }

  const input = (k: keyof CompanyFormValues, label: string, extra?: { type?: string; placeholder?: string; max?: number; required?: boolean }) => (
    <div className="field">
      <label>
        {label}
        {extra?.required ? " *" : ""}
      </label>
      <input type={extra?.type ?? "text"} value={v[k]} onChange={set(k)} placeholder={extra?.placeholder} maxLength={extra?.max} required={extra?.required} />
    </div>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      <h3 style={{ margin: "0 0 0.6rem", fontSize: "0.9rem" }}>Basic information</h3>
      <div className="crm-form-grid">
        {input("name", "Company name", { required: true, max: 200 })}
        <div className="field">
          <label>Customer category</label>
          <select value={v.category_id} onChange={set("category_id")}>
            <option value="">Not set</option>
            {meta?.categories
              .filter((c) => c.active || c.id === initial.category_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        {input("website", "Website", { placeholder: "aceroofing.ie", max: 300 })}
        {input("phone", "Business telephone", { placeholder: "+353 1 234 5678", max: 40 })}
        {input("mobile", "Mobile / WhatsApp", { placeholder: "087 123 4567", max: 40 })}
        {input("email", "General email", { type: "email", max: 200 })}
        {input("address", "Address", { max: 300 })}
        {input("city", "Town or city", { max: 100 })}
        <div className="field">
          <label>County</label>
          <select value={v.county} onChange={set("county")}>
            <option value="">Not set</option>
            {COUNTY_CHOICES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        {input("postcode", "Postcode", { max: 20 })}
        {input("country", "Country", { max: 80 })}
      </div>

      <h3 style={{ margin: "1.25rem 0 0.6rem", fontSize: "0.9rem" }}>Commercial information</h3>
      <div className="crm-form-grid">
        <div className="field wide-field">
          <label>Business description</label>
          <textarea rows={2} value={v.description} onChange={set("description")} maxLength={2000} />
        </div>
        {input("services", "Potential services required", { placeholder: "e.g. kitchen respray for fit-outs", max: 500 })}
        {input("estimated_value", "Estimated opportunity value (€)", { placeholder: "A guess, not counted as sales" })}
        {input("source", "Source of the prospect", { placeholder: "e.g. Google Maps, referral", max: 120 })}
        <div className="field">
          <label>Priority</label>
          <select value={v.priority} onChange={set("priority")}>
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
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
        <div className="field wide-field">
          <label>Notes</label>
          <textarea rows={3} value={v.notes} onChange={set("notes")} maxLength={4000} />
        </div>
      </div>

      {duplicates && (
        <div className="card" style={{ margin: "1rem 0 0", borderColor: "#b98900", background: "rgba(185, 137, 0, 0.07)" }}>
          <strong>This looks like a company that is already in the CRM</strong>
          <ul style={{ margin: "0.5rem 0", paddingLeft: "1.2rem", fontSize: "0.9rem" }}>
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/dashboard/crm/companies/${d.id}`} target="_blank">
                  {d.name}
                </Link>
                {d.city ? `, ${d.city}` : ""} <span style={{ color: "var(--muted)" }}>({d.reasons.join(", ")})</span>
              </li>
            ))}
          </ul>
          <p style={{ margin: "0 0 0.6rem", fontSize: "0.85rem", color: "var(--muted)" }}>Open the existing one to update it instead. Only save this as a new company if it really is a different business.</p>
          <button type="button" className="btn btn-secondary" onClick={() => save(true)} disabled={saving}>
            It is a different company, save it anyway
          </button>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem" }}>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Saving..." : submitLabel}
        </button>
        {onCancel && (
          <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
