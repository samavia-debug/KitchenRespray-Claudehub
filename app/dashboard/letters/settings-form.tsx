"use client";

import { useEffect, useState } from "react";
import { EMPTY_SETTINGS, type LetterSettings } from "@/lib/letters/layout";

const FIELDS: { key: keyof LetterSettings; label: string; placeholder?: string; multiline?: boolean }[] = [
  { key: "company_name", label: "Company name", placeholder: "Kitchen Respray Ltd" },
  { key: "address", label: "Address", placeholder: "One line per row of the address", multiline: true },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "signatory_name", label: "Signatory name", placeholder: "Who signs letters" },
  { key: "signatory_title", label: "Signatory title", placeholder: "e.g. Director" },
  { key: "footer_text", label: "Footer line (optional)", placeholder: "e.g. company registration details", multiline: true },
];

/** Letterhead and signatory shown on every letter. Typing a name here does not mean any letter has been signed or approved. */
export default function SettingsForm({ onSaved }: { onSaved: (s: LetterSettings) => void }) {
  const [values, setValues] = useState<LetterSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/letters/settings")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) setError(body.error || "Could not load the settings");
        else setValues({ ...EMPTY_SETTINGS, ...body.settings });
      })
      .catch((e) => setError(e.message || "Network error"));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!values) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/letters/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const body = await res.json();
      if (!res.ok) setError(body.error || "Could not save");
      else {
        setMessage("Saved. New previews and downloads use these details.");
        onSaved(values);
      }
    } catch (err: any) {
      setError(err.message || "Network error");
    }
    setSaving(false);
  }

  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Letterhead and signatory</h2>
      <p style={{ color: "var(--muted)", marginTop: 0, fontSize: "0.9rem" }}>
        These appear at the top and bottom of every letter. The signatory is only a typed name under the closing; a letter is never marked as signed or approved because of
        it.
      </p>
      {tableMissing && (
        <p className="error-text">The letters tables are not set up yet. Run the letters migration in Supabase, then reload.</p>
      )}
      {error && !tableMissing && <p className="error-text">{error}</p>}
      {!values && !error && <p style={{ color: "var(--muted)" }}>Loading...</p>}
      {values && (
        <form onSubmit={save} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.75rem" }}>
          {FIELDS.map((f) => (
            <div className="field" key={f.key} style={{ margin: 0 }}>
              <label>{f.label}</label>
              {f.multiline ? (
                <textarea rows={3} value={values[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              ) : (
                <input value={values[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              )}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save details"}
            </button>
          </div>
        </form>
      )}
      {message && <p style={{ margin: "0.75rem 0 0", fontSize: "0.85rem" }}>{message}</p>}
    </div>
  );
}
