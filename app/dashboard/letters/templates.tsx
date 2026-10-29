"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LETTER_TYPES, LETTER_TYPE_BY_KEY } from "@/lib/letters/config";
import {
  SAMPLE_CONTEXT,
  TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABEL,
  TEMPLATE_TOKENS,
  buildFromTemplate,
  templateFields,
  type LetterTemplate,
  type TemplateCategory,
  type TemplateInput,
} from "@/lib/letters/templates";

type FieldKey = "subject" | "greeting" | "body" | "closing";
type Field = HTMLInputElement | HTMLTextAreaElement | null;

const BLANK: TemplateInput = { name: "", category: "hr", letter_type: "general_business", subject: "", greeting: "", body: "", closing: "" };
const toInput = (t: LetterTemplate): TemplateInput => ({ name: t.name, category: t.category as TemplateCategory, letter_type: t.letter_type, subject: t.subject, greeting: t.greeting, body: t.body, closing: t.closing });

/** The company's own letter wording: add a template, change it, copy it. Used from "Write a letter" in step 3. */
export default function Templates({ isAdmin, onChanged, refreshKey }: { isAdmin: boolean; onChanged: () => void; refreshKey: number }) {
  // Managers and Staff work with customer letters and quotes only; templates for staff letters are Admin only.
  const kinds = LETTER_TYPES.filter((t) => isAdmin || t.domain === "sales");
  const BLANK_HERE: TemplateInput = isAdmin ? BLANK : { ...BLANK, category: "sales", letter_type: "sales_letter" };
  const [templates, setTemplates] = useState<LetterTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<TemplateInput>(isAdmin ? BLANK : { ...BLANK, category: "sales", letter_type: "sales_letter" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<FieldKey>("body");
  const fields = useRef<Record<FieldKey, Field>>({ subject: null, greeting: null, body: null, closing: null });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/letters/templates");
      const body = await res.json();
      if (!res.ok) setError(body.error || "Could not load the templates");
      else {
        setError(null);
        setTemplates(body.templates);
      }
    } catch (e: any) {
      setError(e.message || "Network error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const visible = useMemo(() => (templates || []).filter((t) => !filter || t.category === filter), [templates, filter]);
  // In the preview each fill-in box shows as its own label in brackets, so the wording around it can be read.
  const preview = useMemo(() => {
    const boxes: Record<string, string> = {};
    for (const f of templateFields(form)) boxes[f.label] = `[${f.label}]`;
    return buildFromTemplate(form, SAMPLE_CONTEXT, boxes);
  }, [form]);
  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);

  function leave(): boolean {
    return !dirty || window.confirm("Leave this template? Changes you have not saved will be lost.");
  }

  function open(t: LetterTemplate) {
    if (!leave()) return;
    setEditing(t.id);
    setForm(toInput(t));
    setDirty(false);
    setMessage(null);
  }

  function startNew(base: TemplateInput = BLANK_HERE) {
    if (!leave()) return;
    setEditing("new");
    setForm(base);
    setDirty(base !== BLANK_HERE);
    setMessage(null);
  }

  const change = <K extends keyof TemplateInput>(key: K, value: TemplateInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  /** Puts {detail} at the cursor in whichever box was used last. */
  function insert(token: string) {
    insertText(`{${token}}`);
  }

  /** Adds a box that is filled in each time the template is used, such as the date of a conversation. */
  function addFillIn() {
    const label = window.prompt("What should the box ask for? For example: Date of the conversation");
    const clean = (label ?? "").replace(/[\[\]\n]/g, " ").replace(/\s+/g, " ").trim();
    if (clean) insertText(`[[${clean}]]`);
  }

  function insertText(text: string) {
    const el = fields.current[focus];
    const current = form[focus];
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? start;
    change(focus, current.slice(0, start) + text + current.slice(end));
    window.setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    }, 0);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(editing && editing !== "new" ? `/api/letters/templates/${editing}` : "/api/letters/templates", {
        method: editing && editing !== "new" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) setMessage(`Error: ${body.error}`);
      else {
        if (editing === "new") setEditing(body.id);
        setDirty(false);
        setMessage("Template saved. It is now in the list when you write a letter of this kind.");
        await load();
        onChanged();
      }
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
    setBusy(false);
  }

  async function remove() {
    if (!editing || editing === "new" || !window.confirm("Delete this template? Letters already written from it are not affected.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/letters/templates/${editing}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) setMessage(`Error: ${body.error}`);
      else {
        setEditing(null);
        setDirty(false);
        setMessage("Template deleted.");
        await load();
        onChanged();
      }
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
    setBusy(false);
  }

  async function addStarters() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/letters/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starters: true }) });
      const body = await res.json();
      if (!res.ok) setMessage(`Error: ${body.error}`);
      else {
        setMessage(body.added > 0 ? `${body.added} starter templates added. Open any of them to change the wording.` : "The starter templates are already there.");
        await load();
        onChanged();
      }
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
    setBusy(false);
  }

  const register = (key: FieldKey) => (el: Field) => {
    fields.current[key] = el;
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.25rem", alignItems: "start" }}>
      <div className="card">
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0, flex: "1 1 auto" }}>Templates</h2>
          <select style={{ maxWidth: 140 }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <button className="btn" onClick={() => startNew()}>
            New template
          </button>
          {isAdmin && (
            <button className="btn btn-secondary" onClick={addStarters} disabled={busy}>
              Add the ready-made wording and the lawyers' letters of concern as templates
            </button>
          )}
        </div>
        {tableMissing && <p className="error-text">The templates table is not set up yet. Run the letter templates migration in Supabase, then reload.</p>}
        {error && !tableMissing && <p className="error-text">{error}</p>}
        {!templates && !error && <p style={{ color: "var(--muted)" }}>Loading...</p>}
        {templates && visible.length === 0 && (
          <p style={{ color: "var(--muted)", margin: 0 }}>{templates.length === 0 ? "No templates yet. Add the ready-made wording to start from, or make a new one." : "No templates in this category."}</p>
        )}
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => open(t)}
            className="btn btn-secondary"
            style={{ display: "block", width: "100%", textAlign: "left", marginBottom: "0.4rem", outline: editing === t.id ? "2px solid var(--accent, #c9792b)" : undefined }}
          >
            <strong>{t.name}</strong>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              {TEMPLATE_CATEGORY_LABEL[t.category] ?? t.category} · {LETTER_TYPE_BY_KEY[t.letter_type]?.label ?? t.letter_type}
            </div>
          </button>
        ))}
      </div>

      <div className="card">
        {message && <p style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", color: message.startsWith("Error") ? "#b3261e" : undefined }}>{message}</p>}
        {!editing && <p style={{ color: "var(--muted)", margin: 0 }}>Choose a template to change it, or make a new one. Write the wording once here, and staff can use it for any letter of this kind from the &ldquo;Write a letter&rdquo; tab.</p>}
        {editing && (
          <>
            <h2 style={{ marginTop: 0 }}>{editing === "new" ? "New template" : "Edit template"}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
              <div className="field" style={{ margin: 0, gridColumn: "1 / -1" }}>
                <label>Template name</label>
                <input value={form.name} onChange={(e) => change("name", e.target.value)} placeholder="e.g. Employment confirmation for a mortgage" />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Category</label>
                <select value={form.category} onChange={(e) => change("category", e.target.value as TemplateCategory)}>
                  {TEMPLATE_CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Kind of letter</label>
                <select value={form.letter_type} onChange={(e) => change("letter_type", e.target.value as TemplateInput["letter_type"])}>
                  {kinds.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field" style={{ marginTop: "0.75rem" }}>
              <label>Put a detail into the wording</label>
              <select
                value=""
                aria-label="Insert a detail"
                onChange={(e) => {
                  if (e.target.value) insert(e.target.value);
                }}
              >
                <option value="">Choose a detail to insert where the cursor is...</option>
                {TEMPLATE_TOKENS.map((t) => (
                  <option key={t.token} value={t.token}>
                    {t.label}  —  {`{${t.token}}`}
                  </option>
                ))}
              </select>
              <div style={{ marginTop: "0.4rem" }}>
                <button type="button" className="btn btn-secondary" onClick={addFillIn}>
                  Add a fill-in box
                </button>
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                Each {"{detail}"} is filled in from the staff record and the form when the letter is written. A fill-in box, written [[like this]], is asked for each time the template is used. If anything is not known, the letter shows a [CONFIRM: ...] note to fill in.
              </div>
            </div>

            <div className="field">
              <label>Subject</label>
              <input ref={register("subject")} value={form.subject} onFocus={() => setFocus("subject")} onChange={(e) => change("subject", e.target.value)} />
            </div>
            <div className="field">
              <label>Greeting (leave empty for &ldquo;Dear name,&rdquo; or &ldquo;Dear Sir or Madam,&rdquo;)</label>
              <input ref={register("greeting")} value={form.greeting} onFocus={() => setFocus("greeting")} onChange={(e) => change("greeting", e.target.value)} />
            </div>
            <div className="field">
              <label>Letter text (leave a blank line between paragraphs)</label>
              <textarea ref={register("body")} rows={12} value={form.body} onFocus={() => setFocus("body")} onChange={(e) => change("body", e.target.value)} />
            </div>
            <div className="field">
              <label>Closing (leave empty for &ldquo;Yours sincerely,&rdquo; or &ldquo;Yours faithfully,&rdquo;)</label>
              <input ref={register("closing")} value={form.closing} onFocus={() => setFocus("closing")} onChange={(e) => change("closing", e.target.value)} />
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="btn" onClick={save} disabled={busy}>
                {busy ? "Saving..." : "Save template"}
              </button>
              {editing !== "new" && (
                <button className="btn btn-secondary" onClick={() => startNew({ ...form, name: `Copy of ${form.name}`.slice(0, 120) })} disabled={busy}>
                  Make a copy
                </button>
              )}
              {editing !== "new" && (
                <button className="btn btn-secondary" onClick={remove} disabled={busy}>
                  Delete
                </button>
              )}
              {dirty && <span style={{ alignSelf: "center", color: "var(--muted)", fontSize: "0.85rem" }}>Unsaved changes</span>}
            </div>

            <h3 style={{ marginBottom: "0.25rem" }}>How it will read</h3>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", color: "var(--muted)" }}>Filled in with example details (Pat Example, a Spray Technician), so you can check the wording.</p>
            <div style={{ border: "1px solid var(--border, #ddd)", borderRadius: 6, padding: "0.75rem 1rem", fontSize: "0.9rem", background: "#fff", color: "#222" }}>
              {preview.subject && <p style={{ margin: "0 0 0.6rem", fontWeight: 600 }}>{preview.subject}</p>}
              <p style={{ margin: "0 0 0.6rem" }}>{preview.greeting}</p>
              {preview.body.split(/\n\s*\n/).map((p, i) => (
                <p key={i} style={{ margin: "0 0 0.6rem", whiteSpace: "pre-wrap" }}>
                  {p}
                </p>
              ))}
              <p style={{ margin: 0 }}>{preview.closing}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
