"use client";

import { useState } from "react";
import { addDays, dublinToday } from "@/lib/crm/followups";
import { detailPatch, FIELD_LABEL, researchPatch } from "@/lib/crm/ai/apply";
import type { NextSteps } from "@/lib/crm/ai/prompts";
import type { ResearchResult } from "@/lib/crm/ai/service";
import type { CompanyRow, ContactRow } from "@/lib/crm/service";
import { api } from "./api";
import { useCrm } from "./crm-context";
import { fmtDate, personName } from "./fmt";

type Tool = "next" | "draft" | "research";
const TOOLS: { id: Tool; label: string }[] = [
  { id: "next", label: "Suggest next steps" },
  { id: "draft", label: "Draft a message" },
  { id: "research", label: "Research this company" },
];

const CHANNEL_NOTE = "A reminder: send business-to-business messages to business contact details only, and give an easy way to opt out.";
const PLACEHOLDER = /\[CONFIRM:\s*([^\]]+)\]/gi;

function Unverified({ children }: { children?: React.ReactNode }) {
  return (
    <span className="status-badge" style={{ background: "rgba(185, 137, 0, 0.16)", color: "#8a6700" }}>
      {children ?? "Unverified"}
    </span>
  );
}

/**
 * AI help for one company. It suggests, drafts and researches; it never sends, saves or changes anything by itself.
 * Each result says where it came from, and what is applied is marked on the company as AI-suggested and unverified.
 */
export default function AiAssistant({ company, contacts, onChanged }: { company: CompanyRow; contacts: ContactRow[]; onChanged: () => void }) {
  const { meta } = useCrm();
  const [tool, setTool] = useState<Tool>("next");
  const [remaining, setRemaining] = useState<number | null>(null);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>AI assistant</h2>
        {remaining !== null && <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{remaining} AI request{remaining === 1 ? "" : "s"} left today</span>}
      </div>
      <p style={{ margin: "0.3rem 0 0.9rem", fontSize: "0.82rem", color: "var(--muted)" }}>
        Suggestions to check, not facts. Nothing is sent, saved or changed until you choose. Company details are sent to the AI service to answer; phone numbers and email addresses are not.
      </p>
      <div className="tabs" role="tablist" style={{ marginBottom: "1rem" }}>
        {TOOLS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tool === t.id} className={tool === t.id ? "active" : ""} onClick={() => setTool(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {/* All three stay mounted so a draft being edited is not lost when switching tabs. */}
      <div style={{ display: tool === "next" ? "block" : "none" }}>
        <NextSteps companyId={company.id} onUsed={setRemaining} onChanged={onChanged} me={meta?.me ?? ""} />
      </div>
      <div style={{ display: tool === "draft" ? "block" : "none" }}>
        <Draft company={company} contacts={contacts} onUsed={setRemaining} />
      </div>
      <div style={{ display: tool === "research" ? "block" : "none" }}>
        <Research company={company} onUsed={setRemaining} onChanged={onChanged} />
      </div>
    </div>
  );
}

// ---------- next steps ----------

function NextSteps({ companyId, onUsed, onChanged, me }: { companyId: string; onUsed: (n: number) => void; onChanged: () => void; me: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(NextSteps & { remaining: number }) | null>(null);
  const [added, setAdded] = useState<Record<number, string>>({});

  async function run() {
    setBusy(true);
    setError(null);
    setAdded({});
    const res = await api("/api/crm/ai/next-step", { method: "POST", body: { company_id: companyId } });
    setBusy(false);
    if (!res.ok) return setError(res.body.error || "Could not get suggestions");
    setResult(res.body);
    onUsed(res.body.remaining);
  }

  async function addFollowUp(i: number) {
    const s = result!.suggestions[i];
    const due = addDays(dublinToday(), s.in_days ?? 3);
    const res = await api("/api/crm/tasks", { method: "POST", body: { company_id: companyId, title: s.action, due_date: due, assigned_to: me } });
    if (!res.ok) return setAdded((a) => ({ ...a, [i]: res.body.error || "Could not add it" }));
    setAdded((a) => ({ ...a, [i]: `Added as a follow-up for ${fmtDate(due)}` }));
    onChanged();
  }

  return (
    <>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.88rem" }}>Looks at this company's recorded history, stage, contacts and follow-ups, and suggests what to do next.</p>
      <button className="btn" onClick={run} disabled={busy}>
        {busy ? "Thinking..." : result ? "Suggest again" : "Suggest next steps"}
      </button>
      {error && <p className="error-text">{error}</p>}
      {result && (
        <div style={{ marginTop: "1rem" }}>
          {result.summary && <p style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>{result.summary}</p>}
          {result.suggestions.length === 0 && <p style={{ color: "var(--muted)" }}>No suggestions came back.</p>}
          {result.suggestions.map((s, i) => (
            <div key={i} style={{ padding: "0.7rem 0", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ minWidth: 240, flex: "1 1 260px" }}>
                <div style={{ fontWeight: 600 }}>{s.action}</div>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{s.why}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: 2 }}>
                  {s.channel ?? "Any way"} · {s.in_days === null ? "no date suggested" : s.in_days === 0 ? "today" : `in ${s.in_days} day${s.in_days === 1 ? "" : "s"}`}
                </div>
              </div>
              <div style={{ minWidth: 190 }}>
                {added[i]?.startsWith("Added") ? (
                  <span style={{ fontSize: "0.82rem", color: "#2e7d32" }}>{added[i]}</span>
                ) : (
                  <>
                    <button className="btn btn-secondary" style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => addFollowUp(i)}>
                      Add as follow-up
                    </button>
                    {added[i] && <div className="error-text" style={{ margin: "0.3rem 0 0" }}>{added[i]}</div>}
                  </>
                )}
              </div>
            </div>
          ))}
          {result.missing_info.length > 0 && (
            <div style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
              <strong>Not recorded, and would help:</strong>
              <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.2rem", color: "var(--muted)" }}>
                {result.missing_info.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------- drafting ----------

type DraftResult = { subject: string; body: string; missing: string[]; remaining: number; usedTemplate: boolean; wordingSet: boolean };

function Draft({ company, contacts, onUsed }: { company: CompanyRow; contacts: ContactRow[]; onUsed: (n: number) => void }) {
  const [kind, setKind] = useState<"introduction" | "follow_up">("introduction");
  const [channel, setChannel] = useState<"WhatsApp" | "Email" | "Letter">(company.mobile ? "WhatsApp" : "Email");
  const [contactId, setContactId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setCopied(false);
    const res = await api("/api/crm/ai/draft", { method: "POST", body: { company_id: company.id, contact_id: contactId || null, channel, kind, instructions } });
    setBusy(false);
    if (!res.ok) return setError(res.body.error || "Could not write a draft");
    setDraft(res.body);
    setSubject(res.body.subject);
    setBody(res.body.body);
    onUsed(res.body.remaining);
  }

  // What still needs confirming is worked out from the text as it is edited now.
  const open = Array.from(body.matchAll(PLACEHOLDER)).map((m) => m[1].trim());

  async function copy() {
    const text = channel === "WhatsApp" || !subject ? body : `Subject: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError("Could not copy. Select the text and copy it yourself.");
    }
  }

  return (
    <>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.88rem" }}>Writes a draft from the details on record and your approved wording. You edit it and send it yourself.</p>
      <div className="crm-form-grid">
        <div className="field">
          <label>What kind of message</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="introduction">First introduction</option>
            <option value="follow_up">Follow-up to earlier contact</option>
          </select>
        </div>
        <div className="field">
          <label>How it will be sent</label>
          <select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
            <option>WhatsApp</option>
            <option>Email</option>
            <option>Letter</option>
          </select>
        </div>
        <div className="field">
          <label>To</label>
          <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">No named person</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
                {c.job_title ? `, ${c.job_title}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="field wide-field">
          <label>Anything specific? (optional)</label>
          <textarea rows={2} maxLength={600} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. mention we work with hotels, keep it very short" />
        </div>
      </div>
      <button className="btn" onClick={run} disabled={busy} style={{ marginTop: "0.75rem" }}>
        {busy ? "Writing..." : draft ? "Write another draft" : "Write a draft"}
      </button>
      {error && <p className="error-text">{error}</p>}

      {draft && (
        <div style={{ marginTop: "1rem" }}>
          {!draft.wordingSet && (
            <p style={{ fontSize: "0.82rem", color: "#8a6700", margin: "0 0 0.6rem" }}>No approved wording has been set yet (an Admin can add it in Settings), so this draft has nothing to say about Kitchen Respray beyond your instructions and may have gaps to fill.</p>
          )}
          {channel !== "WhatsApp" && (
            <div className="field">
              <label>Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} />
            </div>
          )}
          <div className="field">
            <label>Message (edit it as you like)</label>
            <textarea rows={channel === "WhatsApp" ? 6 : 14} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
          </div>
          {open.length > 0 ? (
            <div style={{ fontSize: "0.85rem", color: "#b3261e", marginBottom: "0.6rem" }}>
              <strong>{open.length} thing{open.length === 1 ? "" : "s"} to fill in before you send:</strong> {open.join("; ")}. Look for [CONFIRM: ...] in the text.
            </div>
          ) : (
            <div style={{ fontSize: "0.82rem", color: "var(--muted)", marginBottom: "0.6rem" }}>Nothing is marked to confirm, but check every statement is true before you send it.</div>
          )}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn btn-secondary" onClick={copy}>
              {copied ? "Copied" : "Copy message"}
            </button>
            <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Nothing is sent from here. Once you have sent it, log it under Activity.</span>
          </div>
          <p style={{ margin: "0.6rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>{CHANNEL_NOTE}</p>
        </div>
      )}
    </>
  );
}

// ---------- research ----------

function Research({ company, onUsed, onChanged }: { company: CompanyRow; onUsed: (n: number) => void; onChanged: () => void }) {
  const { meta } = useCrm();
  const [readWebsite, setReadWebsite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [state, setState] = useState<Record<string, string>>({});

  async function run() {
    setBusy(true);
    setError(null);
    setState({});
    const res = await api("/api/crm/ai/research", { method: "POST", body: { company_id: company.id, read_website: readWebsite } });
    setBusy(false);
    if (!res.ok) return setError(res.body.error || "Could not research this company");
    setResult(res.body);
    onUsed(res.body.remaining);
  }

  const who = () => personName(meta?.assignees.find((a) => a.id === meta?.me)?.email);

  /**
   * Saves one or more suggestions to the company, and marks on the company that they were AI-suggested and unverified. It
   * starts from the company as it is saved right now, so nothing saved by someone else in the meantime is overwritten.
   */
  async function applyMany(entries: { key: string; s: ResearchResult["suggestions"][number] }[]) {
    const mark = (text: string) => setState((x) => ({ ...x, ...Object.fromEntries(entries.map((e) => [e.key, text])) }));
    mark("Applying...");
    const fresh = await api(`/api/crm/companies/${company.id}`);
    if (!fresh.ok) return mark(fresh.body.error || "Could not load the company");
    const current = fresh.body.company as CompanyRow;
    const patch = researchPatch(current, entries.map((e) => e.s), who(), fmtDate(dublinToday()));
    const res = await api(`/api/crm/companies/${company.id}`, { method: "PATCH", body: { ...patch, expectedUpdatedAt: current.updated_at } });
    if (!res.ok) return mark(res.body.error || "Could not apply it");
    mark("Applied");
    onChanged();
  }

  const apply = (key: string, s: ResearchResult["suggestions"][number]) => applyMany([{ key, s }]);

  function applyAll() {
    if (!result) return;
    const entries = result.suggestions.map((s, i) => ({ key: `s${i}`, s })).filter((e) => state[e.key] !== "Applied");
    if (entries.length === 0) return;
    if (!window.confirm(`Save ${entries.length} suggestion${entries.length === 1 ? "" : "s"} to this company's record? They are unverified, so a line in the notes will say they came from the AI.`)) return;
    applyMany(entries);
  }

  /** Puts a phone number or email found on their website into the empty field for it, or into the notes if that field is already filled. */
  async function addDetail(key: string, kind: "email" | "phone", value: string) {
    setState((x) => ({ ...x, [key]: "Saving..." }));
    const fresh = await api(`/api/crm/companies/${company.id}`);
    if (!fresh.ok) return setState((x) => ({ ...x, [key]: fresh.body.error || "Could not load the company" }));
    const current = fresh.body.company as CompanyRow;
    const { patch, placed } = detailPatch(current, kind, value, who(), fmtDate(dublinToday()));
    const res = await api(`/api/crm/companies/${company.id}`, { method: "PATCH", body: { ...patch, expectedUpdatedAt: current.updated_at } });
    if (!res.ok) return setState((x) => ({ ...x, [key]: res.body.error || "Could not save it" }));
    setState((x) => ({ ...x, [key]: placed === "notes" ? "Added to the notes" : `Saved as ${placed === "email" ? "email" : placed === "mobile" ? "mobile" : "telephone"}` }));
    onChanged();
  }

  async function addContact(key: string, c: ResearchResult["contacts"][number]) {
    const res = await api("/api/crm/contacts", { method: "POST", body: { company_id: company.id, full_name: c.name, job_title: c.role, source: "Company website (unverified)" } });
    if (res.status === 409) return setState((x) => ({ ...x, [key]: "Looks like someone already on file" }));
    if (!res.ok) return setState((x) => ({ ...x, [key]: res.body.error || "Could not add" }));
    setState((x) => ({ ...x, [key]: "Added" }));
    onChanged();
  }

  const btn = { padding: "0.3rem 0.7rem", fontSize: "0.8rem" } as const;

  return (
    <>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.88rem" }}>Organises what is on record and suggests what to add. Every suggestion comes with a quote you can check, and none is saved until you apply it.</p>
      <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", fontSize: "0.88rem", marginBottom: "0.75rem", opacity: company.website ? 1 : 0.6 }}>
        <input type="checkbox" checked={readWebsite} disabled={!company.website} onChange={(e) => setReadWebsite(e.target.checked)} style={{ marginTop: 3 }} />
        <span>
          Also read their website {company.website ? <span style={{ color: "var(--muted)" }}>({company.website.replace(/^https?:\/\//, "")}, that one page only, if the site allows it)</span> : <span style={{ color: "var(--muted)" }}>(there is no website on record)</span>}
        </span>
      </label>
      <button className="btn" onClick={run} disabled={busy}>
        {busy ? "Researching..." : result ? "Research again" : "Research this company"}
      </button>
      {error && <p className="error-text">{error}</p>}

      {result && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <Unverified>Everything here is unverified</Unverified>
            {result.website.read && <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Read their website{result.website.title ? `: "${result.website.title}"` : ""}</span>}
          </div>
          {result.website.note && <p style={{ margin: "0.5rem 0 0", fontSize: "0.82rem", color: "#8a6700" }}>{result.website.note}</p>}
          {result.summary && <p style={{ margin: "0.75rem 0", fontSize: "0.9rem" }}>{result.summary}</p>}

          {result.suggestions.length === 0 && <p style={{ color: "var(--muted)", fontSize: "0.88rem" }}>Nothing could be suggested that has evidence behind it.</p>}
          {result.suggestions.filter((_, i) => state[`s${i}`] !== "Applied").length >= 2 && (
            <div style={{ margin: "0 0 0.6rem" }}>
              <button className="btn" style={btn} disabled={result.suggestions.some((_, i) => state[`s${i}`] === "Applying...")} onClick={applyAll}>
                Apply all {result.suggestions.filter((_, i) => state[`s${i}`] !== "Applied").length} to this company
              </button>
              <span style={{ marginLeft: "0.6rem", fontSize: "0.78rem", color: "var(--muted)" }}>Adds to what is there and never replaces it. The notes will say it came from the AI and is unverified.</span>
            </div>
          )}
          {result.suggestions.map((s, i) => {
            const key = `s${i}`;
            return (
              <div key={key} style={{ padding: "0.7rem 0", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ minWidth: 240, flex: "1 1 280px" }}>
                  <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.02em", color: "var(--muted)", fontWeight: 600 }}>
                    {FIELD_LABEL[s.field]} · {s.source} · {s.confidence} confidence
                  </div>
                  <div style={{ fontWeight: 600 }}>{s.value}</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontStyle: "italic" }}>“{s.evidence}”</div>
                </div>
                <div style={{ minWidth: 170 }}>
                  {state[key] === "Applied" ? (
                    <span style={{ fontSize: "0.82rem", color: "#2e7d32" }}>Applied</span>
                  ) : (
                    <>
                      <button className="btn btn-secondary" style={btn} disabled={state[key] === "Applying..."} onClick={() => apply(key, s)}>
                        Apply to this company
                      </button>
                      {state[key] && <div className={state[key] === "Applying..." ? "" : "error-text"} style={{ margin: "0.3rem 0 0", fontSize: "0.8rem" }}>{state[key]}</div>}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {result.contacts.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <strong style={{ fontSize: "0.88rem" }}>People named on their website</strong>
              {result.contacts.map((c, i) => {
                const key = `c${i}`;
                return (
                  <div key={key} style={{ padding: "0.5rem 0", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {c.name}
                        {c.role ? <span style={{ fontWeight: 400, color: "var(--muted)" }}>, {c.role}</span> : null}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)", fontStyle: "italic" }}>“{c.evidence}”</div>
                    </div>
                    {state[key] === "Added" ? <span style={{ fontSize: "0.82rem", color: "#2e7d32" }}>Added</span> : (
                      <div>
                        <button className="btn btn-secondary" style={btn} onClick={() => addContact(key, c)}>
                          Add as a contact
                        </button>
                        {state[key] && <div className="error-text" style={{ margin: "0.3rem 0 0" }}>{state[key]}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(result.details.emails.length > 0 || result.details.phones.length > 0 || result.details.social.length > 0) && (
            <div style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
              <strong>Contact details shown on their website</strong> <Unverified>Check before using</Unverified>
              <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.2rem" }}>
                {([["email", result.details.emails], ["phone", result.details.phones]] as const).flatMap(([kind, list]) =>
                  list.map((d) => {
                    const key = `${kind}:${d.value}`;
                    return (
                      <li key={key}>
                        {d.value} {d.onRecord ? <span style={{ color: "var(--muted)" }}>(already on record)</span> : <span style={{ color: "#8a6700" }}>(not on record)</span>}
                        {!d.onRecord && !/^(Saved|Added)/.test(state[key] ?? "") && (
                          <button className="btn btn-secondary" style={{ ...btn, marginLeft: "0.6rem", padding: "0.15rem 0.55rem" }} disabled={state[key] === "Saving..."} onClick={() => addDetail(key, kind, d.value)}>
                            Add to record
                          </button>
                        )}
                        {state[key] && <span style={{ marginLeft: "0.5rem", color: /^(Saved|Added)/.test(state[key]) ? "#2e7d32" : "#b3261e" }}>{state[key] === "Saving..." ? "" : state[key]}</span>}
                      </li>
                    );
                  })
                )}
                {result.details.social.map((u) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noreferrer">
                      {u.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.gaps.length > 0 && (
            <div style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
              <strong>Missing, and would help:</strong>
              <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.2rem", color: "var(--muted)" }}>
                {result.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          {result.dropped > 0 && <p style={{ margin: "0.75rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>{result.dropped} suggestion{result.dropped === 1 ? " was" : "s were"} left out because the quote given for {result.dropped === 1 ? "it" : "them"} could not be found in the text.</p>}
        </div>
      )}
    </>
  );
}
