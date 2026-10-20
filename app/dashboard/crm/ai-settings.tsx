"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

type Values = { about_us: string; intro_template: string; tone: string; avoid: string };
const EMPTY: Values = { about_us: "", intro_template: "", tone: "", avoid: "" };

/**
 * The wording the AI may rely on when it drafts a message. It is only ever allowed to say about Kitchen Respray what is
 * written here (or in the letterhead details), so a draft cannot make up claims. Admin only.
 */
export default function AiSettings() {
  const [values, setValues] = useState<Values | null>(null);
  const [info, setInfo] = useState<{ used: number; limit: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("/api/crm/ai/settings").then((res) => {
      if (!res.ok) return setError(res.body.error || "Could not load the settings");
      setValues({ ...EMPTY, ...Object.fromEntries(Object.entries(res.body.settings).map(([k, v]) => [k, (v as string | null) ?? ""])) });
      setInfo({ used: res.body.allowance.used, limit: res.body.dailyLimit });
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!values) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const res = await api("/api/crm/ai/settings", { method: "PUT", body: values });
    setSaving(false);
    if (!res.ok) return setError(res.body.error || "Could not save");
    setMessage("Saved. New drafts use this wording.");
  }

  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => values && setValues({ ...values, [k]: e.target.value });
  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);

  return (
    <div className="card">
      <h2>AI assistant: approved wording</h2>
      <p style={{ margin: "0 0 1rem", fontSize: "0.85rem", color: "var(--muted)" }}>
        When someone asks the AI to draft a message, this is the only information about Kitchen Respray it may state, along with the company name, phone, email, website and sender on the Letter Writer's letterhead. Anything it needs that is not here is left as a [CONFIRM: ...] gap for the person to fill in. It never sends anything.
      </p>
      {tableMissing && <p className="error-text">The AI settings table is not set up yet. Run the crm_ai migration in Supabase, then reload.</p>}
      {error && !tableMissing && <p className="error-text">{error}</p>}
      {!values && !error && <p style={{ color: "var(--muted)" }}>Loading...</p>}
      {values && (
        <form onSubmit={save}>
          <div className="field">
            <label>About us: facts a message may state</label>
            <textarea rows={6} maxLength={3000} value={values.about_us} onChange={set("about_us")} placeholder="e.g. We respray kitchen cabinets and doors on site in Dublin, Wicklow and Kildare, so there is no need to replace the kitchen. We work with homeowners, hotels, landlords and builders." />
          </div>
          <div className="field">
            <label>An approved example message (optional): drafts follow its structure and wording</label>
            <textarea rows={8} maxLength={3000} value={values.intro_template} onChange={set("intro_template")} placeholder="Paste a message you are happy with. Use <name> and <company> where they should change." />
          </div>
          <div className="crm-form-grid">
            <div className="field">
              <label>Tone</label>
              <input maxLength={300} value={values.tone} onChange={set("tone")} placeholder="e.g. friendly and plain, no hard sell" />
            </div>
            <div className="field">
              <label>Never say or promise</label>
              <input maxLength={600} value={values.avoid} onChange={set("avoid")} placeholder="e.g. prices, discounts, guarantees, delivery dates" />
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.75rem", flexWrap: "wrap" }}>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save wording"}
            </button>
            {message && <span style={{ fontSize: "0.85rem" }}>{message}</span>}
          </div>
        </form>
      )}
      {info && (
        <p style={{ margin: "1rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
          Each person can make {info.limit} AI requests a day. You have made {info.used} today. Every request uses a little of your Anthropic balance. Only counts are recorded, never what was asked or answered.
        </p>
      )}
    </div>
  );
}
