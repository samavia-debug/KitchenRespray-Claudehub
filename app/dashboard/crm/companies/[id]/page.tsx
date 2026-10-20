"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CompanyRow, ContactRow, StageHistoryRow } from "@/lib/crm/service";
import { CLOSING_KINDS, type Stage } from "@/lib/crm/types";
import { api } from "../../api";
import { PriorityMark, StageBadge } from "../../badges";
import CompanyForm, { changedFields, toFormValues } from "../../company-form";
import ContactForm, { changedContactFields, EMPTY_CONTACT, toContactValues } from "../../contact-form";
import { useCrm } from "../../crm-context";
import { FOLLOW_UP_COLOR, fmtDate, fmtDateTime, fmtMoney, followUpState, personName, whatsappLink } from "../../fmt";
import StageDialog from "../../stage-dialog";
import ActivitySection from "../../activity-section";
import AiAssistant from "../../ai-assistant";
import OpportunitiesSection from "../../opportunities-section";
import TasksSection from "../../tasks-section";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.02em", color: "var(--muted)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: "0.92rem", overflowWrap: "anywhere" }}>{children || <span style={{ color: "var(--muted)" }}>—</span>}</div>
    </div>
  );
}

function Phone({ value }: { value: string | null }) {
  if (!value) return null;
  const wa = whatsappLink(value);
  return (
    <>
      <a href={`tel:${value.replace(/[^+\d]/g, "")}`}>{value}</a>
      {wa && (
        <>
          {" "}
          <a href={wa} target="_blank" rel="noreferrer" title="Opens a WhatsApp chat. You write and send the message yourself." style={{ fontSize: "0.78rem" }}>
            WhatsApp
          </a>
        </>
      )}
    </>
  );
}

export default function CompanyPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { meta } = useCrm();
  const [company, setCompany] = useState<CompanyRow | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [history, setHistory] = useState<StageHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState("");
  const [dialog, setDialog] = useState<Stage | null>(null);
  const [stageBusy, setStageBusy] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [addingContact, setAddingContact] = useState(false);
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Bumped whenever a card on the page changes something the other cards show.
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    const res = await api(`/api/crm/companies/${params.id}`);
    if (res.status === 404) return setNotFound(true);
    if (!res.ok) return setError(res.body.error || "Could not load the company");
    setError(null);
    setCompany(res.body.company);
    setContacts(res.body.contacts);
    setHistory(res.body.history);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = () => {
    load();
    setRefresh((r) => r + 1);
  };

  if (notFound) {
    return (
      <div className="card">
        <p>That company was not found. It may have been archived or deleted.</p>
        <Link href="/dashboard/crm/companies">Back to companies</Link>
      </div>
    );
  }
  if (error) return <p className="error-text">{error}</p>;
  if (!company || !meta) return <p style={{ color: "var(--muted)" }}>Loading...</p>;

  const role = meta.role;
  const isOverseer = role === "Admin" || role === "Manager";
  const current = meta.stages.find((s) => s.id === company.stage_id);
  const fu = followUpState(company.next_follow_up);

  async function moveTo(stage: Stage, extra?: { outcome_note: string; won_value: string }) {
    setStageBusy(true);
    setStageError(null);
    const res = await api(`/api/crm/companies/${params.id}/stage`, {
      method: "POST",
      body: { stage_id: stage.id, confirmed: CLOSING_KINDS.includes(stage.kind), outcome_note: extra?.outcome_note, won_value: extra?.won_value },
    });
    setStageBusy(false);
    if (!res.ok) return setStageError(res.body.error || "Could not change the stage");
    setDialog(null);
    setTarget("");
    setNote(`Moved to ${stage.name}.`);
    await load();
  }

  function startMove() {
    const stage = meta?.stages.find((s) => s.id === target);
    if (!stage) return;
    if (CLOSING_KINDS.includes(stage.kind)) {
      setStageError(null);
      setDialog(stage);
    } else moveTo(stage);
  }

  async function remove(permanent: boolean) {
    const message = permanent
      ? `Delete ${company!.name} and all its contacts for good? This cannot be undone.`
      : `Archive ${company!.name}? It disappears from every list. Nothing is deleted.`;
    if (!window.confirm(message)) return;
    const res = await api(`/api/crm/companies/${params.id}${permanent ? "?permanent=true" : ""}`, { method: "DELETE" });
    if (!res.ok) return setNote(res.body.error || "Could not remove the company");
    router.push("/dashboard/crm/companies");
  }

  async function deleteContact(c: ContactRow) {
    if (!window.confirm(`Delete ${c.full_name} from the CRM? This cannot be undone.`)) return;
    const res = await api(`/api/crm/contacts/${c.id}`, { method: "DELETE" });
    if (!res.ok) return setNote(res.body.error || "Could not delete the contact");
    setNote(null);
    load();
  }

  return (
    <>
      <div style={{ marginBottom: "0.75rem" }}>
        <Link href="/dashboard/crm/companies" style={{ fontSize: "0.85rem" }}>
          ← All companies
        </Link>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ margin: "0 0 0.4rem", fontSize: "1.35rem" }}>{company.name}</h2>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", fontSize: "0.88rem" }}>
              <StageBadge name={company.stage_name} kind={company.stage_kind} />
              <PriorityMark priority={company.priority} />
              <span style={{ color: "var(--muted)" }}>{company.category_name || "No category"}</span>
              <span style={{ color: "var(--muted)" }}>Assigned to {company.assignee_email ? personName(company.assignee_email) : "nobody"}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <select style={{ width: "auto" }} value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Move to stage">
              <option value="">Move to stage...</option>
              {meta.stages
                .filter((s) => s.active && s.id !== company.stage_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <button className="btn" disabled={!target || stageBusy} onClick={startMove}>
              Move
            </button>
          </div>
        </div>
        {stageError && !dialog && <p className="error-text">{stageError}</p>}
        {note && <p style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>{note}</p>}
      </div>

      <TasksSection companyId={params.id} contacts={contacts.map((c) => ({ id: c.id, full_name: c.full_name }))} onChanged={changed} refreshKey={refresh} />
      <ActivitySection companyId={params.id} contacts={contacts.map((c) => ({ id: c.id, full_name: c.full_name }))} onChanged={changed} refreshKey={refresh} />

      <AiAssistant company={company} contacts={contacts} onChanged={changed} />

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem" }}>
          <h2 style={{ margin: 0 }}>Company details</h2>
          {!editing && (
            <button className="btn btn-secondary" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <CompanyForm
            initial={toFormValues(company)}
            submitLabel="Save changes"
            onSubmit={(values) => {
              const diff = changedFields(toFormValues(company), values);
              if (Object.keys(diff).length === 0) return Promise.resolve({ ok: true, status: 200, body: { company } });
              return api(`/api/crm/companies/${params.id}`, { method: "PATCH", body: { ...diff, expectedUpdatedAt: company.updated_at } });
            }}
            onDone={() => {
              setEditing(false);
              setNote("Saved.");
              load();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <div className="crm-form-grid">
              <Detail label="Website">{company.website && <a href={company.website} target="_blank" rel="noreferrer">{company.website}</a>}</Detail>
              <Detail label="Telephone">
                <Phone value={company.phone} />
              </Detail>
              <Detail label="Mobile">
                <Phone value={company.mobile} />
              </Detail>
              <Detail label="Email">{company.email && <a href={`mailto:${company.email}`}>{company.email}</a>}</Detail>
              <Detail label="Address">{[company.address, company.city, company.county, company.postcode, company.country].filter(Boolean).join(", ")}</Detail>
              <Detail label="Potential services">{company.services}</Detail>
              <Detail label="Source">{company.source}</Detail>
              <Detail label="Estimated opportunity (a guess, not sales)">{company.estimated_value !== null ? fmtMoney(company.estimated_value) : null}</Detail>
              {company.stage_kind === "won" && <Detail label="Value won">{company.won_value !== null ? fmtMoney(company.won_value) : "Not recorded"}</Detail>}
              <Detail label="Next follow-up">
                {company.next_follow_up && (
                  <span style={{ color: FOLLOW_UP_COLOR[fu], fontWeight: fu === "overdue" || fu === "today" ? 600 : undefined }}>
                    {fmtDate(company.next_follow_up)}
                    {fu === "overdue" ? " (overdue)" : fu === "today" ? " (today)" : ""}
                  </span>
                )}
              </Detail>
              <Detail label="Last contacted">{company.last_contacted_at ? fmtDate(company.last_contacted_at) : "Not yet"}</Detail>
              <Detail label="Last activity">{company.last_activity_type ? `${company.last_activity_type}, ${fmtDate(company.last_activity_at)}` : "None recorded"}</Detail>
              <Detail label="Added">{fmtDate(company.created_at)}</Detail>
              {company.outcome_note && (
                <div className="wide-field">
                  <Detail label="Outcome">{company.outcome_note}</Detail>
                </div>
              )}
              {company.description && (
                <div className="wide-field">
                  <Detail label="Business description">{company.description}</Detail>
                </div>
              )}
              {company.notes && (
                <div className="wide-field">
                  <Detail label="Notes">
                    <span style={{ whiteSpace: "pre-line" }}>{company.notes}</span>
                  </Detail>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <h2 style={{ margin: 0 }}>Contacts ({contacts.length})</h2>
          {!addingContact && (
            <button className="btn btn-secondary" onClick={() => setAddingContact(true)}>
              + Add contact
            </button>
          )}
        </div>

        {addingContact && (
          <ContactForm
            initial={EMPTY_CONTACT}
            submitLabel="Save contact"
            onSubmit={(values, confirmDuplicate) => api("/api/crm/contacts", { method: "POST", body: { ...values, company_id: params.id, confirmDuplicate } })}
            onDone={() => {
              setAddingContact(false);
              load();
            }}
            onCancel={() => setAddingContact(false)}
          />
        )}

        {contacts.length === 0 && !addingContact && <p style={{ color: "var(--muted)", margin: "0.5rem 0 0" }}>No contacts yet. Add the person you speak to, with their job title.</p>}

        {contacts.map((c) =>
          editingContact === c.id ? (
            <ContactForm
              key={c.id}
              initial={toContactValues(c)}
              submitLabel="Save changes"
              onSubmit={(values) => {
                const diff = changedContactFields(toContactValues(c), values);
                if (Object.keys(diff).length === 0) return Promise.resolve({ ok: true, status: 200, body: {} });
                return api(`/api/crm/contacts/${c.id}`, { method: "PATCH", body: { ...diff, expectedUpdatedAt: c.updated_at } });
              }}
              onDone={() => {
                setEditingContact(null);
                load();
              }}
              onCancel={() => setEditingContact(null)}
            />
          ) : (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", padding: "0.75rem 0", borderTop: "1px solid var(--border)" }}>
              <div style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 600 }}>{c.full_name}</div>
                <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{c.job_title || "No job title"}</div>
              </div>
              <div style={{ fontSize: "0.88rem", minWidth: 220 }}>
                <div>
                  <Phone value={c.phone} />
                  {!c.phone && <span style={{ color: "var(--muted)" }}>No phone</span>}
                </div>
                <div style={{ overflowWrap: "anywhere" }}>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span style={{ color: "var(--muted)" }}>No email</span>}</div>
              </div>
              <div style={{ fontSize: "0.82rem", color: "var(--muted)", minWidth: 180 }}>
                {c.preferred_method && <div>Prefers {c.preferred_method}</div>}
                {c.assignee_email && <div>Assigned to {personName(c.assignee_email)}</div>}
                {c.next_follow_up && <div>Follow up {fmtDate(c.next_follow_up)}</div>}
                {c.notes && <div style={{ whiteSpace: "pre-line" }}>{c.notes}</div>}
              </div>
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start" }}>
                <button className="btn btn-secondary" style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }} onClick={() => setEditingContact(c.id)}>
                  Edit
                </button>
                {isOverseer && (
                  <button className="btn btn-secondary" style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem", color: "#b3261e" }} onClick={() => deleteContact(c)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          )
        )}
      </div>

      <OpportunitiesSection companyId={params.id} onChanged={load} />

      {Object.keys(company.extra ?? {}).length > 0 && (
        <div className="card">
          <h2>Imported details</h2>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "var(--muted)" }}>Kept from the spreadsheet this company was imported from. These have not been checked, so treat them as a lead, not as fact. Anything under &quot;Not imported&quot; was a value that could not be used as it was written.</p>
          <div className="crm-form-grid">
            {Object.entries(company.extra).map(([k, v]) => (
              <Detail key={k} label={k}>
                {typeof v === "string" && /^https?:\/\//i.test(v) ? (
                  <a href={v} target="_blank" rel="noreferrer">
                    {v.length > 60 ? `${v.slice(0, 57)}...` : v}
                  </a>
                ) : (
                  <span style={{ whiteSpace: "pre-line" }}>{String(v)}</span>
                )}
              </Detail>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Pipeline history</h2>
        {history.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No stage changes yet. It started at {current?.name ?? "the first stage"} on {fmtDate(company.created_at)}.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Moved</th>
                  <th>By</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} style={{ cursor: "default" }}>
                    <td>{fmtDateTime(h.created_at)}</td>
                    <td>
                      {h.from_stage ?? "—"} → <strong>{h.to_stage ?? "—"}</strong>
                    </td>
                    <td>{personName(h.user_email)}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      {h.won_value !== null && <strong>{fmtMoney(h.won_value)} won. </strong>}
                      {h.outcome_note || (h.won_value === null ? "—" : "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isOverseer && (
        <div className="card">
          <h2>Remove this company</h2>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.88rem", color: "var(--muted)" }}>
            Archiving hides it from every list and keeps the record. Deleting removes it and its contacts for good, for example when someone asks for their details to be erased.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-secondary" onClick={() => remove(false)}>
              Archive
            </button>
            {role === "Admin" && (
              <button className="btn btn-secondary" style={{ color: "#b3261e" }} onClick={() => remove(true)}>
                Delete permanently
              </button>
            )}
          </div>
        </div>
      )}

      {dialog && <StageDialog companyName={company.name} stage={dialog} busy={stageBusy} error={stageError} onConfirm={(v) => moveTo(dialog, v)} onCancel={() => setDialog(null)} />}
    </>
  );
}
