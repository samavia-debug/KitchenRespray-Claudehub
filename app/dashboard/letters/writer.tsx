"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FACT_LABEL, LETTER_TYPES, LETTER_TYPE_BY_KEY, SENSITIVE_NOTICE, STATUS_LABEL, type FactKey, type LetterStatus, type LetterTypeKey } from "@/lib/letters/config";
import { applyAdded, formatLongDate, missingFacts, type LetterFacts } from "@/lib/letters/facts";
import { EMPTY_SETTINGS, type LetterSettings } from "@/lib/letters/layout";
import { unresolvedPlaceholders, type LetterDetails, type Recipient } from "@/lib/letters/prompt";
import type { LetterRow, TechnicianListItem } from "@/lib/letters/service";
import LetterPreview from "./letter-preview";

const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const FACT_ORDER: FactKey[] = ["jobTitle", "role", "department", "team", "branch", "employmentType", "startDate", "employeeId"];
const CONTACT_ORDER: FactKey[] = ["email", "phone"];

type Draft = { subject: string; greeting: string; body: string; closing: string };
const EMPTY_DRAFT: Draft = { subject: "", greeting: "", body: "", closing: "" };
const STATUS_COLOR: Record<LetterStatus, string> = { draft: "#6f6a63", finalised: "#97690a", approved: "#2e7d32" };

type Notice = { kind: "ok" | "error"; text: string } | null;

export default function Writer({ openId, settingsKey, onSaved }: { openId: string | null; settingsKey: number; onSaved: () => void }) {
  const [techs, setTechs] = useState<TechnicianListItem[] | null>(null);
  const [techError, setTechError] = useState<string | null>(null);
  const [settings, setSettings] = useState<LetterSettings>(EMPTY_SETTINGS);

  const [search, setSearch] = useState("");
  const [techId, setTechId] = useState<number | null>(null);
  const [facts, setFacts] = useState<LetterFacts | null>(null);
  const [added, setAdded] = useState<Partial<Record<FactKey, string>>>({});
  const [type, setType] = useState<LetterTypeKey | "">("");
  const [recipient, setRecipient] = useState<Recipient>({});
  const [date, setDate] = useState(todayIso());
  const [details, setDetails] = useState<LetterDetails>({});

  const [draft, setDraft] = useState<Draft | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [aiGenerated, setAiGenerated] = useState(false);
  const [letterId, setLetterId] = useState<string | null>(null);
  const [status, setStatus] = useState<LetterStatus>("draft");
  const [dirty, setDirty] = useState(false);

  const [busy, setBusy] = useState<null | "generate" | "save" | "status" | "load">(null);
  const [notice, setNotice] = useState<Notice>(null);

  const config = type ? LETTER_TYPE_BY_KEY[type] : null;
  const locked = status !== "draft";

  // ---- Loading ----

  useEffect(() => {
    fetch("/api/letters/technicians")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) setTechError(body.error || "Could not load the staff list");
        else setTechs(body.technicians);
      })
      .catch((e) => setTechError(e.message || "Network error"));
  }, []);

  // The letterhead is read again whenever it is saved on the Letterhead tab.
  useEffect(() => {
    fetch("/api/letters/settings")
      .then(async (res) => (res.ok ? setSettings({ ...EMPTY_SETTINGS, ...(await res.json()).settings }) : undefined))
      .catch(() => undefined);
  }, [settingsKey]);

  const reset = useCallback(() => {
    setSearch("");
    setTechId(null);
    setFacts(null);
    setAdded({});
    setType("");
    setRecipient({});
    setDate(todayIso());
    setDetails({});
    setDraft(null);
    setMissing([]);
    setAiGenerated(false);
    setLetterId(null);
    setStatus("draft");
    setDirty(false);
    setNotice(null);
  }, []);

  const openLetter = useCallback(async (id: string) => {
    setBusy("load");
    setNotice(null);
    try {
      const res = await fetch(`/api/letters/${id}`);
      const body = await res.json();
      if (!res.ok) {
        setNotice({ kind: "error", text: body.error || "Could not open the letter" });
      } else {
        const l: LetterRow = body.letter;
        setTechId(l.technician_user_id);
        setFacts(l.facts);
        setAdded({});
        setType(l.letter_type);
        setRecipient(l.recipient || {});
        setDate(l.letter_date);
        setDetails(l.details || {});
        setDraft({ subject: l.subject, greeting: l.greeting, body: l.body, closing: l.closing });
        setMissing(l.missing || []);
        setAiGenerated(l.ai_generated);
        setLetterId(l.id);
        setStatus(l.status);
        setDirty(false);
      }
    } catch (e: any) {
      setNotice({ kind: "error", text: e.message || "Network error" });
    }
    setBusy(null);
  }, []);

  useEffect(() => {
    if (openId) openLetter(openId);
  }, [openId, openLetter]);

  async function chooseTechnician(id: number) {
    setTechId(id);
    setFacts(null);
    setAdded({});
    setNotice(null);
    try {
      const res = await fetch(`/api/letters/technicians/${id}`);
      const body = await res.json();
      if (!res.ok) {
        setNotice({ kind: "error", text: body.error || "Could not load the technician" });
        return;
      }
      setFacts(body.facts);
      const f: LetterFacts = body.facts;
      if (config?.recipient === "technician" && !recipient.name) setRecipient((r) => ({ ...r, name: f.name }));
    } catch (e: any) {
      setNotice({ kind: "error", text: e.message || "Network error" });
    }
  }

  function chooseType(next: LetterTypeKey | "") {
    setType(next);
    setDirty(true);
    const c = next ? LETTER_TYPE_BY_KEY[next] : null;
    // A letter to the technician themselves starts addressed to them.
    if (c?.recipient === "technician" && facts && !recipient.name) setRecipient((r) => ({ ...r, name: facts.name }));
  }

  // ---- Derived ----

  const effective = useMemo(() => (facts ? applyAdded(facts, added) : null), [facts, added]);
  const missingNow = useMemo(() => (type && effective ? missingFacts(type, effective) : []), [type, effective]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (techs || []).filter((t) => !q || `${t.name} ${t.jobTitle ?? ""} ${t.role ?? ""}`.toLowerCase().includes(q));
  }, [techs, search]);
  const openItems = draft ? unresolvedPlaceholders(draft.body) : [];

  const set = <K extends keyof Draft>(key: K, value: string) => {
    setDraft((d) => ({ ...(d ?? EMPTY_DRAFT), [key]: value }));
    setDirty(true);
  };

  // ---- Actions ----

  function payload() {
    return {
      technician_user_id: techId,
      technician_name: effective?.name ?? "",
      technician_former: effective?.former ?? false,
      letter_type: type,
      subject: draft?.subject ?? "",
      letter_date: date,
      recipient,
      facts: effective,
      details,
      greeting: draft?.greeting ?? "",
      body: draft?.body ?? "",
      closing: draft?.closing ?? "",
      missing,
      ai_generated: aiGenerated,
    };
  }

  async function generate() {
    if (!techId || !type) return;
    if (draft?.body && dirty && !window.confirm("Write a new draft? Your edits to the current letter will be replaced.")) return;
    setBusy("generate");
    setNotice(null);
    try {
      const res = await fetch("/api/letters/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ technician_user_id: techId, letter_type: type, added, recipient, details, letter_date: date }),
      });
      const body = await res.json();
      if (!res.ok) {
        setNotice({ kind: "error", text: body.error || "Could not write the letter" });
      } else {
        setDraft({ subject: body.draft.subject, greeting: body.draft.greeting, body: body.draft.body, closing: body.draft.closing });
        setMissing(body.draft.missing);
        setFacts(body.facts);
        setAdded({});
        if (!recipient.name && body.recipientName) setRecipient((r) => ({ ...r, name: body.recipientName }));
        setAiGenerated(true);
        setDirty(true);
        setNotice({ kind: "ok", text: "Draft written. Read it carefully and edit anything that is wrong before saving." });
      }
    } catch (e: any) {
      setNotice({ kind: "error", text: e.message || "Network error" });
    }
    setBusy(null);
  }

  /** Saves the current letter as a draft; returns its id, or null if it could not be saved. */
  async function save(): Promise<string | null> {
    if (!draft || !type || !techId) return null;
    setBusy("save");
    setNotice(null);
    try {
      const res = await fetch(letterId ? `/api/letters/${letterId}` : "/api/letters", {
        method: letterId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const body = await res.json();
      if (!res.ok) {
        setNotice({ kind: "error", text: body.error || "Could not save the draft" });
        setBusy(null);
        return null;
      }
      const id: string = letterId ?? body.id;
      setLetterId(id);
      setDirty(false);
      setNotice({ kind: "ok", text: "Draft saved." });
      onSaved();
      setBusy(null);
      return id;
    } catch (e: any) {
      setNotice({ kind: "error", text: e.message || "Network error" });
      setBusy(null);
      return null;
    }
  }

  async function changeStatus(action: "finalise" | "approve" | "reopen") {
    const asks: Record<string, string> = {
      finalise: "Finalise this letter? It will be locked for editing until you reopen it.",
      approve: "Mark this letter as approved by management? Only do this if it has actually been reviewed and approved.",
      reopen: "Reopen as a draft? Any approval is withdrawn.",
    };
    if (!window.confirm(asks[action])) return;

    let id = letterId;
    if (action === "finalise" && (dirty || !id)) {
      id = await save();
      if (!id) return;
    }
    if (!id) return;

    setBusy("status");
    setNotice(null);
    try {
      const res = await fetch(`/api/letters/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const body = await res.json();
      if (!res.ok) setNotice({ kind: "error", text: body.error || "Could not change the status" });
      else {
        await openLetter(id);
        setNotice({ kind: "ok", text: action === "finalise" ? "Finalised." : action === "approve" ? "Marked as approved." : "Reopened as a draft." });
        onSaved();
      }
    } catch (e: any) {
      setNotice({ kind: "error", text: e.message || "Network error" });
    }
    setBusy(null);
  }

  async function duplicate() {
    if (!letterId) return;
    try {
      const res = await fetch(`/api/letters/${letterId}/duplicate`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) setNotice({ kind: "error", text: body.error || "Could not duplicate" });
      else {
        await openLetter(body.id);
        setNotice({ kind: "ok", text: "A copy was made as a new draft dated today." });
        onSaved();
      }
    } catch (e: any) {
      setNotice({ kind: "error", text: e.message || "Network error" });
    }
  }

  function print() {
    if (letterId) fetch(`/api/letters/${letterId}/printed`, { method: "POST" }).catch(() => undefined);
    window.print();
  }

  function startNew() {
    if (dirty && !window.confirm("Start a new letter? Changes you have not saved will be lost.")) return;
    reset();
  }

  const tableMissing = !!techError && /does not exist|could not find the table|schema cache/i.test(techError);
  const readyToGenerate = !!techId && !!effective && !!type && busy !== "generate";
  const content = {
    letter_type: type || "custom",
    status,
    letter_date: date,
    subject: draft?.subject ?? "",
    recipient,
    greeting: draft?.greeting ?? "",
    body: draft?.body ?? "",
    closing: draft?.closing ?? "",
  };

  return (
    <>
      {notice && (
        <div className="card no-print" style={{ marginBottom: "1rem", borderColor: notice.kind === "error" ? "#b3261e" : undefined }}>
          <p style={{ margin: 0, color: notice.kind === "error" ? "#b3261e" : undefined }}>{notice.text}</p>
        </div>
      )}

      {/* Step 1 */}
      <div className="card no-print" style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ marginTop: 0 }}>1. Technician</h2>
        {techError && <p className="error-text">{tableMissing ? "Staff records are not available yet." : techError}</p>}
        {!techs && !techError && <p style={{ color: "var(--muted)" }}>Loading staff...</p>}
        {techs && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
            <div>
              <input
                placeholder="Search by name or job title"
                value={search}
                disabled={locked}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search technicians"
              />
              <select
                size={Math.min(7, Math.max(2, matches.length))}
                style={{ marginTop: "0.5rem", width: "100%" }}
                value={techId ?? ""}
                disabled={locked}
                onChange={(e) => {
                  setDirty(true);
                  chooseTechnician(Number(e.target.value));
                }}
                aria-label="Technician"
              >
                {matches.map((t) => (
                  <option key={t.userId} value={t.userId}>
                    {t.name}
                    {t.jobTitle ? ` — ${t.jobTitle}` : ""}
                    {t.former ? " (former)" : ""}
                  </option>
                ))}
              </select>
              {matches.length === 0 && <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No one matches.</p>}
            </div>

            {techId && !effective && <p style={{ color: "var(--muted)" }}>Loading details...</p>}
            {effective && (
              <div>
                <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
                  {effective.name}
                  {effective.former && <span style={{ color: "#b98900", fontWeight: 400 }}> · former employee</span>}
                </p>
                <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                  Please confirm these details. Anything you add or change here is used for this letter only; the staff record is not changed.
                </p>
                {[...FACT_ORDER, ...CONTACT_ORDER].map((key) => {
                  const value = effective.values[key] ?? "";
                  const need = config?.requiredFacts.includes(key) && !value;
                  const source = effective.sources[key];
                  return (
                    <div key={key} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
                      <label style={{ fontSize: "0.82rem" }}>{FACT_LABEL[key]}</label>
                      <div>
                        <input
                          value={value}
                          disabled={locked}
                          placeholder={need ? "Needed for this letter" : "Not recorded"}
                          style={need ? { borderColor: "#b3261e" } : undefined}
                          onChange={(e) => {
                            setAdded((a) => ({ ...a, [key]: e.target.value }));
                            setDirty(true);
                          }}
                        />
                        {(source === "added" || need || key === "startDate" || (key === "email" || key === "phone")) && (
                          <div style={{ fontSize: "0.7rem", color: need ? "#b3261e" : "var(--muted)" }}>
                            {need
                              ? "Missing: add it, or the letter will carry a placeholder"
                              : source === "added"
                              ? "Added for this letter only"
                              : key === "startDate"
                              ? "Check this date against the contract (Connecteam stores dates month first)"
                              : "Only used if you tick the box for it below"}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Steps 2 and 3 */}
      <div className="card no-print" style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ marginTop: 0 }}>2. Letter type</h2>
        <div className="field" style={{ maxWidth: 420 }}>
          <select value={type} disabled={locked} onChange={(e) => chooseType(e.target.value as LetterTypeKey | "")} aria-label="Letter type">
            <option value="">Choose a letter type...</option>
            {LETTER_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
                {t.sensitive ? " (needs approval)" : ""}
              </option>
            ))}
          </select>
        </div>
        {config && <p style={{ margin: "0 0 0.5rem", color: "var(--muted)", fontSize: "0.9rem" }}>{config.description}</p>}
        {config?.sensitive && (
          <p style={{ margin: "0 0 0.5rem", padding: "0.6rem 0.8rem", background: "var(--accent-soft)", borderRadius: 6, fontSize: "0.85rem", color: "#7a4a00" }}>{SENSITIVE_NOTICE}</p>
        )}

        {config && (
          <>
            <h2>3. Recipient and details</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.75rem" }}>
              <div className="field" style={{ margin: 0 }}>
                <label>
                  {config.recipient === "technician" ? "Addressed to" : "Recipient name"}
                  {config.recipient === "required" ? " (required)" : config.recipient === "optional" ? " (optional)" : ""}
                </label>
                <input value={recipient.name ?? ""} disabled={locked} onChange={(e) => { setRecipient({ ...recipient, name: e.target.value }); setDirty(true); }} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Recipient organisation (optional)</label>
                <input value={recipient.organisation ?? ""} disabled={locked} onChange={(e) => { setRecipient({ ...recipient, organisation: e.target.value }); setDirty(true); }} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Recipient address (optional)</label>
                <textarea rows={3} value={recipient.address ?? ""} disabled={locked} onChange={(e) => { setRecipient({ ...recipient, address: e.target.value }); setDirty(true); }} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Letter date</label>
                <input type="date" value={date} disabled={locked} onChange={(e) => { setDate(e.target.value); setDirty(true); }} />
              </div>
              {config.showPeriod && (
                <>
                  <div className="field" style={{ margin: 0 }}>
                    <label>{config.periodLabel} from</label>
                    <input type="date" value={details.periodFrom ?? ""} disabled={locked} onChange={(e) => { setDetails({ ...details, periodFrom: e.target.value }); setDirty(true); }} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>to (optional)</label>
                    <input type="date" value={details.periodTo ?? ""} disabled={locked} onChange={(e) => { setDetails({ ...details, periodTo: e.target.value }); setDirty(true); }} />
                  </div>
                </>
              )}
              {config.showReference && (
                <div className="field" style={{ margin: 0 }}>
                  <label>Reference number (optional)</label>
                  <input value={details.reference ?? ""} disabled={locked} onChange={(e) => { setDetails({ ...details, reference: e.target.value }); setDirty(true); }} />
                </div>
              )}
            </div>

            <div className="field" style={{ marginTop: "0.75rem" }}>
              <label>
                {config.purposeLabel}
                {config.purposeRequired ? " (required)" : ""}
              </label>
              <textarea rows={3} value={details.purpose ?? ""} disabled={locked} placeholder={config.purposePlaceholder} onChange={(e) => { setDetails({ ...details, purpose: e.target.value }); setDirty(true); }} />
            </div>
            <div className="field">
              <label>Additional instructions (optional)</label>
              <textarea rows={2} value={details.instructions ?? ""} disabled={locked} placeholder="Tone, length, anything to include or leave out" onChange={(e) => { setDetails({ ...details, instructions: e.target.value }); setDirty(true); }} />
            </div>
            {config.allowContact && (
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
                <input type="checkbox" checked={!!details.includeContact} disabled={locked} onChange={(e) => { setDetails({ ...details, includeContact: e.target.checked }); setDirty(true); }} />
                Include the technician&apos;s work email and phone in the letter
              </label>
            )}

            {missingNow.length > 0 && (
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "#b98900" }}>
                Not recorded for this technician: {missingNow.map((k) => FACT_LABEL[k]).join(", ")}. You can add them above, or generate anyway and the letter will carry a placeholder to fill in.
              </p>
            )}

            {!locked && (
              <button className="btn" onClick={generate} disabled={!readyToGenerate}>
                {busy === "generate" ? "Writing..." : draft ? "Regenerate letter" : "Generate letter"}
              </button>
            )}
            {!techId && <span style={{ marginLeft: "0.75rem", color: "var(--muted)", fontSize: "0.85rem" }}>Choose a technician first.</span>}
            {locked && <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.85rem" }}>This letter is {STATUS_LABEL[status].toLowerCase()}. Reopen it to change the details.</p>}
          </>
        )}
      </div>

      {/* Edit and preview */}
      {draft && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "1.25rem", alignItems: "start" }}>
          <div className="card no-print">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0 }}>4. Edit the letter</h2>
              <span style={{ color: STATUS_COLOR[status], fontWeight: 600 }}>
                {STATUS_LABEL[status]}
                {dirty ? " · unsaved changes" : ""}
              </span>
            </div>

            {aiGenerated && (
              <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.5rem 0" }}>Written by the AI service from the details above. Check every fact before it is used.</p>
            )}

            {(missing.length > 0 || openItems.length > 0) && (
              <div style={{ margin: "0.75rem 0", padding: "0.6rem 0.8rem", background: "#fff4e5", border: "1px solid #f0c27b", borderRadius: 6, fontSize: "0.85rem", color: "#7a4a00" }}>
                <strong>Please check before using this letter:</strong>
                <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>
                  {Array.from(new Set([...missing, ...openItems])).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
                {openItems.length > 0 && <div style={{ marginTop: "0.3rem" }}>Replace each [CONFIRM: ...] in the text; the letter can&apos;t be finalised while any remain.</div>}
              </div>
            )}

            <div className="field">
              <label>Subject</label>
              <input value={draft.subject} readOnly={locked} onChange={(e) => set("subject", e.target.value)} />
            </div>
            <div className="field">
              <label>Greeting</label>
              <input value={draft.greeting} readOnly={locked} onChange={(e) => set("greeting", e.target.value)} />
            </div>
            <div className="field">
              <label>Letter text</label>
              <textarea rows={14} value={draft.body} readOnly={locked} onChange={(e) => set("body", e.target.value)} />
            </div>
            <div className="field">
              <label>Closing</label>
              <input value={draft.closing} readOnly={locked} onChange={(e) => set("closing", e.target.value)} />
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {!locked && (
                <button className="btn" onClick={save} disabled={busy !== null}>
                  {busy === "save" ? "Saving..." : "Save draft"}
                </button>
              )}
              {!locked && (
                <button className="btn btn-secondary" onClick={() => changeStatus("finalise")} disabled={busy !== null || openItems.length > 0 || !draft.subject.trim() || !draft.body.trim()}>
                  Finalise
                </button>
              )}
              {status === "finalised" && (
                <button className="btn" onClick={() => changeStatus("approve")} disabled={busy !== null}>
                  Mark as approved
                </button>
              )}
              {locked && (
                <button className="btn btn-secondary" onClick={() => changeStatus("reopen")} disabled={busy !== null}>
                  Reopen as draft
                </button>
              )}
              <button className="btn btn-secondary" onClick={print}>
                Print / Save as PDF
              </button>
              {letterId && !dirty && (
                <a className="btn btn-secondary" href={`/api/letters/${letterId}/docx`} style={{ textDecoration: "none", display: "inline-block" }}>
                  Download Word
                </a>
              )}
              {letterId && (
                <button className="btn btn-secondary" onClick={duplicate} disabled={busy !== null || dirty}>
                  Duplicate
                </button>
              )}
              <button className="btn btn-secondary" onClick={startNew}>
                Start new letter
              </button>
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0.75rem 0 0" }}>
              For a PDF, choose Print / Save as PDF and pick &ldquo;Save as PDF&rdquo; as the printer. Nothing is sent or issued from here; sending the letter is up to you.
              {!letterId && " Save the draft to enable the Word download and to keep it."}
            </p>
          </div>

          <div>
            <p className="no-print" style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
              Preview {settings.company_name ? "" : "(add your letterhead in the Letterhead tab)"}
            </p>
            <LetterPreview settings={settings} content={content} />
            <p className="no-print" style={{ margin: "0.5rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
              Dated {formatLongDate(date)}. This is what will print and what the Word file contains.
            </p>
          </div>
        </div>
      )}

      {!draft && busy === "load" && <p style={{ color: "var(--muted)" }}>Opening the letter...</p>}
    </>
  );
}
