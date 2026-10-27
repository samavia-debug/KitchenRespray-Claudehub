"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FACT_LABEL, LETTER_TYPES, LETTER_TYPE_BY_KEY, SENSITIVE_NOTICE, STATUS_LABEL, type FactKey, type LetterStatus, type LetterTypeKey } from "@/lib/letters/config";
import { applyAdded, formatLongDate, missingFacts, type LetterFacts } from "@/lib/letters/facts";
import { applyFormat, type FormatAction } from "@/lib/letters/format";
import { EMPTY_SETTINGS, recipientLinesOf, signatureLinesOf, type LetterSettings } from "@/lib/letters/layout";
import { refreshLetter } from "@/lib/letters/refresh";
import { unresolvedPlaceholders, type LetterDetails, type Recipient } from "@/lib/letters/prompt";
import { buildFromStock, fillStock, staffAsRecipient, stockFor, type StockContext } from "@/lib/letters/stock";
import { TEMPLATE_CATEGORY_LABEL, buildFromTemplate, generaliseLetterText, type LetterTemplate } from "@/lib/letters/templates";
import type { LetterRow, TechnicianListItem } from "@/lib/letters/service";
import { showSignatureImage, signerLines, type Signer } from "@/lib/letters/signers";
import LetterPreview from "./letter-preview";

const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const FACT_ORDER: FactKey[] = ["jobTitle", "role", "department", "team", "branch", "employmentType", "startDate", "employeeId"];
const CONTACT_ORDER: FactKey[] = ["email", "phone"];

type Draft = { subject: string; greeting: string; body: string; closing: string };
const EMPTY_DRAFT: Draft = { subject: "", greeting: "", body: "", closing: "" };
const STATUS_COLOR: Record<LetterStatus, string> = { draft: "#6f6a63", finalised: "#97690a", approved: "#2e7d32" };

type Notice = { kind: "ok" | "error"; text: string } | null;

export default function Writer({
  openId,
  settingsKey,
  templatesKey,
  signersKey,
  onSaved,
  onTemplatesChanged,
}: {
  openId: string | null;
  settingsKey: number;
  templatesKey: number;
  signersKey: number;
  onSaved: () => void;
  onTemplatesChanged: () => void;
}) {
  const [techs, setTechs] = useState<TechnicianListItem[] | null>(null);
  const [templates, setTemplates] = useState<LetterTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [signers, setSigners] = useState<Signer[]>([]);
  /** The details the letter's wording was last filled from, to see which have changed since. */
  const [filledWith, setFilledWith] = useState<StockContext | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [techError, setTechError] = useState<string | null>(null);
  const [settings, setSettings] = useState<LetterSettings>(EMPTY_SETTINGS);

  const [search, setSearch] = useState("");
  const [techId, setTechId] = useState<number | null>(null);
  const [facts, setFacts] = useState<LetterFacts | null>(null);
  const [added, setAdded] = useState<Partial<Record<FactKey, string>>>({});
  const [nameOverride, setNameOverride] = useState<string | null>(null);
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

  // The company's templates are read again whenever they are changed on the Templates tab.
  useEffect(() => {
    fetch("/api/letters/templates")
      .then(async (res) => (res.ok ? setTemplates((await res.json()).templates ?? []) : undefined))
      .catch(() => undefined);
  }, [templatesKey]);

  // The people who sign letters are read again whenever they are changed on the Signatures tab.
  useEffect(() => {
    fetch("/api/letters/signers")
      .then(async (res) => (res.ok ? setSigners((await res.json()).signers ?? []) : undefined))
      .catch(() => undefined);
  }, [signersKey]);

  const reset = useCallback(() => {
    setTemplateId("");
    setFilledWith(null);
    setSearch("");
    setTechId(null);
    setFacts(null);
    setAdded({});
    setNameOverride(null);
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
        // A typed address block or signature that was cleared is stored as empty, which means "use the details".
        const saved: LetterDetails = { ...(l.details || {}) };
        if (!saved.addressBlock) delete saved.addressBlock;
        if (!saved.signatureBlock) delete saved.signatureBlock;
        setDetails(saved);
        setFilledWith({ facts: l.facts, company: "Kitchen Respray", recipient: l.recipient || {}, details: saved });
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
    setNameOverride(null);
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
      // A letter to the person themselves starts addressed to them, with their address and contact details.
      if (config?.recipient === "technician" && !recipient.name) setRecipient(staffAsRecipient(f));
    } catch (e: any) {
      setNotice({ kind: "error", text: e.message || "Network error" });
    }
  }

  function chooseType(next: LetterTypeKey | "") {
    setType(next);
    setDirty(true);
    const c = next ? LETTER_TYPE_BY_KEY[next] : null;
    // A letter to the technician themselves starts addressed to them.
    if (c?.recipient === "technician" && effective && !recipient.name) setRecipient(staffAsRecipient(effective));
  }

  /** The person's name, home address and contact details as the addressee, for any letter type. */
  function addressToStaff() {
    if (!effective) return;
    setRecipient(staffAsRecipient(effective));
    // Back to the address block built from these details, if one had been typed over.
    setDetails((d) => {
      const { addressBlock, ...rest } = d;
      return rest;
    });
    setDirty(true);
  }

  // ---- Derived ----

  const effective = useMemo(() => {
    if (!facts) return null;
    const withAdded = applyAdded(facts, added);
    // The name on the letter can be corrected without touching the staff record.
    return { ...withAdded, name: (nameOverride ?? withAdded.name).replace(/\s+/g, " ").trim() || withAdded.name };
  }, [facts, added, nameOverride]);
  const missingNow = useMemo(() => (type && effective ? missingFacts(type, effective) : []), [type, effective]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (techs || []).filter((t) => !q || `${t.name} ${t.sourceName} ${t.jobTitle ?? ""} ${t.role ?? ""}`.toLowerCase().includes(q));
  }, [techs, search]);
  const currentStaff = matches.filter((t) => !t.former);
  const formerStaff = matches.filter((t) => t.former);
  const openItems = draft ? unresolvedPlaceholders(draft.body) : [];

  // The details as they stand now, and which of them have changed since the letter was written.
  const contextNow = useMemo<StockContext | null>(
    () => (effective ? { facts: effective, company: settings.company_name || "Kitchen Respray", recipient, details } : null),
    [effective, settings.company_name, recipient, details]
  );
  const refresh = useMemo(
    () => (draft && filledWith && contextNow && status === "draft" ? refreshLetter(draft, filledWith, contextNow) : null),
    [draft, filledWith, contextNow, status]
  );

  // Anything typed and not saved is lost if the page is closed, so the browser is asked to confirm.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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
        body: JSON.stringify({ technician_user_id: techId, name: effective?.name, letter_type: type, added, recipient, details, letter_date: date }),
      });
      const body = await res.json();
      if (!res.ok) {
        setNotice({ kind: "error", text: body.error || "Could not write the letter" });
      } else {
        setDraft({ subject: body.draft.subject, greeting: body.draft.greeting, body: body.draft.body, closing: body.draft.closing });
        setMissing(body.draft.missing);
        setFilledWith(stockContext());
        startWithUsualSigner();
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

  const stockContext = (): StockContext | null =>
    effective ? { facts: effective, company: settings.company_name || "Kitchen Respray", recipient, details } : null;

  const chosenTemplate = templates.find((t) => t.id === templateId) ?? null;

  /** The whole letter from the chosen template, or the ready-made paragraphs: instant, and only what the record and the form say. */
  function writeFromStock() {
    const ctx = stockContext();
    if (!ctx || !type) return;
    if (draft?.body && dirty && !window.confirm("Write the letter again? Your edits to the current letter will be replaced.")) return;
    const d = chosenTemplate ? buildFromTemplate({ ...chosenTemplate, letter_type: type }, ctx) : buildFromStock(type, ctx);
    setDraft({ subject: d.subject, greeting: d.greeting, body: d.body, closing: d.closing });
    setMissing(d.missing);
    setFilledWith(ctx);
    startWithUsualSigner();
    setAiGenerated(false);
    setDirty(true);
    setNotice({ kind: "ok", text: "Letter written. Check it, add or change any paragraph below, then save it." });
  }

  /** Who signs: their typed name and job title go under the closing, and their picture above it once the letter is finalised. */
  function chooseSigner(id: string) {
    const signer = signers.find((s) => s.id === id);
    setDetails((d) => {
      const next = { ...d };
      if (signer) {
        next.signerId = signer.id;
        next.signatureBlock = signerLines(signer);
      } else {
        delete next.signerId;
        delete next.signatureBlock;
      }
      return next;
    });
    setDirty(true);
  }

  /** A new letter starts with the usual signer, if there is one and nobody has been chosen or typed. */
  function startWithUsualSigner() {
    const usual = signers.find((s) => s.is_default && s.active);
    if (!usual || details.signerId || details.signatureBlock) return;
    setDetails((d) => ({ ...d, signerId: usual.id, signatureBlock: signerLines(usual) }));
  }

  /** Bold, italic or a list on whatever is selected in the letter text. */
  function format(action: FormatAction) {
    const el = bodyRef.current;
    if (!el || !draft || locked) return;
    const edit = applyFormat(draft.body, el.selectionStart, el.selectionEnd, action);
    set("body", edit.text);
    window.setTimeout(() => {
      el.focus();
      el.setSelectionRange(edit.start, edit.end);
    }, 0);
  }

  function bodyKeys(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "b" || key === "i") {
      e.preventDefault();
      format(key === "b" ? "bold" : "italic");
    }
  }

  /** Swaps the details that have changed since the letter was written; the rest of the wording, including edits, stays. */
  function applyRefresh() {
    if (!refresh || !contextNow || refresh.changes.length === 0) return;
    setDraft(refresh.letter);
    setFilledWith(contextNow);
    setDirty(true);
    setNotice({ kind: "ok", text: `Updated: ${refresh.changes.map((c) => c.label).join(", ")}. Your own edits were kept.` });
  }

  /** Keeps the letter's wording as a template; the person's name and the company become {name} and {company}. */
  async function saveAsTemplate() {
    if (!draft || !type) return;
    const name = window.prompt("Name for the new template:", `${config?.label ?? "Letter"}`.slice(0, 100));
    if (!name || !name.trim()) return;
    const company = settings.company_name || "Kitchen Respray";
    const who = effective ?? { name: "" };
    const g = (v: string) => generaliseLetterText(v, who, company);
    try {
      const res = await fetch("/api/letters/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category: type === "general_business" || type === "custom" ? "general" : "hr",
          letter_type: type,
          subject: g(draft.subject),
          greeting: "",
          body: g(draft.body),
          closing: draft.closing,
        }),
      });
      const body = await res.json();
      if (!res.ok) setNotice({ kind: "error", text: body.error || "Could not save the template" });
      else {
        setNotice({ kind: "ok", text: "Saved as a template. The name and company are now {name} and {company}; change anything else on the Templates tab." });
        onTemplatesChanged();
      }
    } catch (e: any) {
      setNotice({ kind: "error", text: e.message || "Network error" });
    }
  }

  /** Adds one ready-made paragraph to the end of the letter text. */
  function addStock(id: string) {
    const ctx = stockContext();
    const paragraph = type ? stockFor(type).find((p) => p.id === id) : undefined;
    if (!ctx || !paragraph) return;
    const text = fillStock(paragraph.text, ctx);
    set("body", draft?.body.trim() ? `${draft.body.trimEnd()}\n\n${text}` : text);
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
    details: { addressBlock: details.addressBlock, signatureBlock: details.signatureBlock, signerId: details.signerId },
  };

  // The address block and sign-off as they stand: what was typed over them, or what the details give.
  const addressText = details.addressBlock ?? recipientLinesOf(recipient).join("\n");
  const signatureText = details.signatureBlock ?? signatureLinesOf(settings).slice(2).join("\n");
  const signerPicture = !!signers.find((s) => s.id === details.signerId)?.has_image;
  const setBlock = (key: "addressBlock" | "signatureBlock", value: string | undefined) => {
    setDetails((d) => {
      const next = { ...d };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    setDirty(true);
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
                {currentStaff.length > 0 && (
                  <optgroup label={`Current staff (${currentStaff.length})`}>
                    {currentStaff.map((t) => (
                      <option key={t.userId} value={t.userId}>
                        {t.name}
                        {t.jobTitle ? ` — ${t.jobTitle}` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                {formerStaff.length > 0 && (
                  <optgroup label={`Former staff (${formerStaff.length})`}>
                    {formerStaff.map((t) => (
                      <option key={t.userId} value={t.userId}>
                        {t.name}
                        {t.jobTitle ? ` — ${t.jobTitle}` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {matches.length === 0 && <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No one matches.</p>}
            </div>

            {techId && !effective && <p style={{ color: "var(--muted)" }}>Loading details...</p>}
            {effective && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Name on the letter</label>
                  <input
                    value={effective.name}
                    disabled={locked}
                    onChange={(e) => {
                      setNameOverride(e.target.value);
                      setDirty(true);
                    }}
                  />
                </div>
                {facts?.sourceName && facts.sourceName !== effective.name && (
                  <p style={{ margin: "0 0 0.6rem", fontSize: "0.72rem", color: "var(--muted)" }}>
                    Connecteam has this person as &ldquo;{facts.sourceName}&rdquo;. The one-letter code at the front looks like a branch or team code, so it is left off the
                    letter. Change the name above if that is wrong.
                  </p>
                )}
                {effective.former && <p style={{ margin: "0 0 0.5rem", color: "#b98900", fontSize: "0.85rem" }}>Former employee</p>}
                <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "var(--muted)" }}>
                  Please confirm these details. Anything you add or change here is used for this letter only; the staff record is not changed.
                </p>
                {[...FACT_ORDER, ...CONTACT_ORDER, "address" as FactKey].map((key) => {
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
                        {(source === "added" || need || key === "startDate" || key === "email" || key === "phone" || key === "address") && (
                          <div style={{ fontSize: "0.7rem", color: need ? "#b3261e" : "var(--muted)" }}>
                            {need
                              ? "Missing: add it, or the letter will carry a placeholder"
                              : source === "added"
                              ? "Added for this letter only"
                              : key === "startDate"
                              ? "Check this date against the contract (Connecteam stores dates month first)"
                              : key === "address"
                              ? "Read from Connecteam when the person is chosen. Used for the address on the letter; add it here if it is not recorded."
                              : "Printed in the address block if you use it there; written into the letter only if you tick the box below"}
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
            {effective && !locked && (
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
                {config.recipient === "technician" ? (
                  <>The letter is addressed to {effective.name}, with the address and contact details from the record. </>
                ) : (
                  <>Is the letter for {effective.name} themselves? </>
                )}
                <button type="button" className="btn btn-secondary" style={{ marginLeft: "0.25rem" }} onClick={addressToStaff}>
                  Fill in {effective.name}&apos;s address and contact details
                </button>
              </p>
            )}
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
                <label>Recipient phone (optional)</label>
                <input value={recipient.phone ?? ""} disabled={locked} onChange={(e) => { setRecipient({ ...recipient, phone: e.target.value }); setDirty(true); }} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Recipient email (optional)</label>
                <input value={recipient.email ?? ""} disabled={locked} onChange={(e) => { setRecipient({ ...recipient, email: e.target.value }); setDirty(true); }} />
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
              <div className="field" style={{ maxWidth: 420 }}>
                <label>Wording to use</label>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Wording to use">
                  <option value="">Ready-made wording for this kind of letter</option>
                  {templates.filter((t) => t.letter_type === type).length > 0 && (
                    <optgroup label="Your templates for this kind of letter">
                      {templates
                        .filter((t) => t.letter_type === type)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({TEMPLATE_CATEGORY_LABEL[t.category] ?? t.category})
                          </option>
                        ))}
                    </optgroup>
                  )}
                  {templates.filter((t) => t.letter_type !== type).length > 0 && (
                    <optgroup label="Other templates">
                      {templates
                        .filter((t) => t.letter_type !== type)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({TEMPLATE_CATEGORY_LABEL[t.category] ?? t.category})
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
                <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Add or change templates on the Templates tab.</div>
              </div>
            )}
            {!locked && (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn" onClick={writeFromStock} disabled={!effective || !type}>
                  Write the letter for me
                </button>
                <button className="btn btn-secondary" onClick={generate} disabled={!readyToGenerate}>
                  {busy === "generate" ? "Writing..." : draft?.body && aiGenerated ? "Rewrite with the AI service" : "Write it with the AI service instead"}
                </button>
              </div>
            )}
            {!locked && (
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--muted)" }}>
                &ldquo;Write the letter for me&rdquo; builds it at once from the wording chosen above and the details on this page, and marks anything it does not know. The AI service writes
                in its own words from the same details and takes a little longer.
              </p>
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

            {refresh && refresh.changes.length > 0 && (
              <div style={{ margin: "0.75rem 0", padding: "0.6rem 0.8rem", background: "#eef6ff", border: "1px solid #a9c8ee", borderRadius: 6, fontSize: "0.85rem", color: "#1f4a7a" }}>
                <strong>Some details have changed since the letter was written:</strong>
                <ul style={{ margin: "0.3rem 0 0.5rem", paddingLeft: "1.1rem" }}>
                  {refresh.changes.map((c) => (
                    <li key={c.label}>
                      {c.label}: {c.from} → {c.to}
                    </li>
                  ))}
                </ul>
                <button className="btn btn-secondary" onClick={applyRefresh}>
                  Update the letter with these
                </button>
                <span style={{ marginLeft: "0.5rem" }}>Only these details are swapped. Everything else you have written stays.</span>
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
              {!locked && (
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.35rem" }}>
                  {(
                    [
                      ["bold", "B", "Bold (Ctrl+B)", { fontWeight: 700 }],
                      ["italic", "I", "Italic (Ctrl+I)", { fontStyle: "italic" }],
                      ["bullets", "• List", "Bullet list", {}],
                      ["numbers", "1. List", "Numbered list", {}],
                    ] as [FormatAction, string, string, React.CSSProperties][]
                  ).map(([action, label, title, style]) => (
                    <button key={action} type="button" className="btn btn-secondary" title={title} style={{ padding: "0.2rem 0.6rem", ...style }} onMouseDown={(e) => e.preventDefault()} onClick={() => format(action)}>
                      {label}
                    </button>
                  ))}
                  <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Select words, then click. Shown in the preview, the print and the Word file.</span>
                </div>
              )}
              <textarea ref={bodyRef} rows={14} value={draft.body} readOnly={locked} onKeyDown={bodyKeys} onChange={(e) => set("body", e.target.value)} />
            </div>
            {!locked && type && (
              <div className="field">
                <label>Add a ready-made paragraph</label>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) addStock(e.target.value);
                  }}
                  aria-label="Add a ready-made paragraph"
                >
                  <option value="">Choose a paragraph to add at the end...</option>
                  {stockFor(type).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Closing</label>
              <input value={draft.closing} readOnly={locked} onChange={(e) => set("closing", e.target.value)} />
            </div>
            <div className="field">
              <label>
                Address block (as printed)
                {details.addressBlock !== undefined && !locked && (
                  <button type="button" className="btn btn-secondary" style={{ marginLeft: "0.5rem", padding: "0.1rem 0.5rem", fontSize: "0.72rem" }} onClick={() => setBlock("addressBlock", undefined)}>
                    Use the details from step 3
                  </button>
                )}
              </label>
              <textarea rows={4} value={addressText} readOnly={locked} onChange={(e) => setBlock("addressBlock", e.target.value)} />
              <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>One line per row. Built from the recipient details; type here to change it for this letter only.</div>
            </div>
            <div className="field">
              <label>
                Signed off by
                {(details.signatureBlock !== undefined || details.signerId) && !locked && (
                  <button type="button" className="btn btn-secondary" style={{ marginLeft: "0.5rem", padding: "0.1rem 0.5rem", fontSize: "0.72rem" }} onClick={() => chooseSigner("")}>
                    Use the Letterhead tab details
                  </button>
                )}
              </label>
              {signers.length > 0 && (
                <select value={details.signerId ?? ""} disabled={locked} onChange={(e) => chooseSigner(e.target.value)} aria-label="Who signs" style={{ marginBottom: "0.4rem" }}>
                  <option value="">Typed name only, or type it below</option>
                  {signers
                    .filter((s) => s.active || s.id === details.signerId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.title ? ", " + s.title : ""}
                        {s.has_image ? " (signature picture)" : ""}
                      </option>
                    ))}
                </select>
              )}
              <textarea rows={2} value={signatureText} readOnly={locked} onChange={(e) => setBlock("signatureBlock", e.target.value)} />
              <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                Name, then job title. Room to sign is left above it.
                {signerPicture
                  ? showSignatureImage(status, type || "custom")
                    ? " The signature picture is on the letter."
                    : " The signature picture appears once the letter is finalised (once approved, for a warning or a reference); a draft is never shown as signed."
                  : " No signature picture is used, so sign it by hand."}
              </div>
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
              {type && (
                <button className="btn btn-secondary" onClick={saveAsTemplate} disabled={busy !== null}>
                  Save as template
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
