"use client";

import { useEffect, useState } from "react";
import { fillTemplate, TEMPLATE_MAX, unknownPlaceholders } from "@/lib/crm/whatsapp";
import { api } from "./api";

type Values = { first_message: string; follow_up: string };

const BLANKS: [string, string][] = [
  ["{name}", "the contact's first name (\"there\" when the company has no contact)"],
  ["{company}", "the company's name"],
  ["{county}", "the company's county"],
  ["{sender}", "the first name of the person using the queue"],
  ["{offer}", "the wording of the special running in the company's county"],
  ["{code}", "that special's code"],
];

// What the preview shows for each blank; the real values come from each company.
const SAMPLE = { name: "Sean", company: "Murphy Joinery", county: "Kilkenny", sender: "Joanna", offer: "[the special's wording]", code: "[the special's code]" };

/**
 * The two fixed WhatsApp messages the send queue uses, with blanks it fills in for each company. Admin only, because this
 * is the wording that goes out to customers. A message that uses {offer} or {code} is never offered for a company with no
 * special running in its county.
 */
export default function WhatsappSettings() {
  const [values, setValues] = useState<Values | null>(null);
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api("/api/crm/whatsapp/templates").then((res) => {
      if (!res.ok) return setError(res.body.error || "Could not load the messages");
      setValues({ first_message: res.body.first_message, follow_up: res.body.follow_up });
      setSaved(!!res.body.saved);
    });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!values) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const res = await api("/api/crm/whatsapp/templates", { method: "PUT", body: values });
    setSaving(false);
    if (!res.ok) return setError(res.body.error || "Could not save");
    setSaved(true);
    setMessage("Saved. The WhatsApp queue uses these messages now.");
  }

  const field = (key: keyof Values, label: string) => {
    const text = values?.[key] ?? "";
    const unknown = unknownPlaceholders(text);
    return (
      <div className="field">
        <label>{label}</label>
        <textarea rows={6} maxLength={TEMPLATE_MAX} value={text} onChange={(e) => values && setValues({ ...values, [key]: e.target.value })} />
        {unknown.length > 0 && <p className="error-text" style={{ margin: "0.3rem 0 0" }}>{unknown.join(", ")} is not a blank we fill in.</p>}
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.78rem", color: "var(--muted)", whiteSpace: "pre-wrap" }}>
          <strong>Looks like:</strong> {fillTemplate(text, SAMPLE).text}
        </p>
      </div>
    );
  };

  return (
    <div className="card">
      <h2>WhatsApp send queue: the messages</h2>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--muted)" }}>
        Select companies on the Companies list and choose <strong>Send WhatsApp</strong>. For each one, WhatsApp opens with the message below already typed, and the person presses Send. Nothing is sent from the Hub.
      </p>
      <ul style={{ margin: "0 0 1rem", paddingLeft: "1.2rem", fontSize: "0.82rem", color: "var(--muted)" }}>
        {BLANKS.map(([blank, what]) => (
          <li key={blank}>
            <code>{blank}</code> is {what}
          </li>
        ))}
      </ul>
      {!saved && values && <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem" }}>These are the starter messages. Nothing has been saved yet, so write your own and save.</p>}
      {error && <p className="error-text">{error}</p>}
      {!values && !error && <p style={{ color: "var(--muted)" }}>Loading...</p>}
      {values && (
        <form onSubmit={save}>
          {field("first_message", "First message")}
          {field("follow_up", "Follow-up message")}
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save messages"}
            </button>
            {message && <span style={{ fontSize: "0.85rem" }}>{message}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
