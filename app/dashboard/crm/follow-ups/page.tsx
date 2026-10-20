"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { dublinToday } from "@/lib/crm/followups";
import { FOLLOW_UP_VIEWS, type FollowUpView, type Task } from "@/lib/crm/types";
import { api } from "../api";
import CompleteDialog from "../complete-dialog";
import { useCrm } from "../crm-context";
import { FOLLOW_UP_COLOR, fmtDate, fmtDateTime, followUpState, personName } from "../fmt";

const PAGE_SIZE = 25;
const STORE_KEY = "crm-followup-view";

const TABS: { view: FollowUpView; label: string; hint: string }[] = [
  { view: "overdue", label: "Overdue", hint: "Due before today" },
  { view: "today", label: "Due today", hint: "Due today" },
  { view: "week", label: "Due this week", hint: "Tomorrow to Sunday" },
  { view: "upcoming", label: "Upcoming", hint: "Due after this week" },
  { view: "completed", label: "Completed", hint: "Done, most recent first" },
];

export default function FollowUpsPage() {
  const { meta } = useCrm();
  const [view, setView] = useState<FollowUpView>("today");
  const [assigned, setAssigned] = useState<string | null>(null); // null until we know who is looking
  const [page, setPage] = useState(1);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<FollowUpView, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<Task | null>(null);
  const [rescheduling, setRescheduling] = useState<{ id: string; date: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const requestId = useRef(0);

  // Staff open on their own follow-ups; Admin and Manager see everyone's. Either can switch.
  useEffect(() => {
    if (!meta || assigned !== null) return;
    let saved: { view?: FollowUpView; assigned?: string } = {};
    try {
      saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}");
    } catch {
      /* not remembered */
    }
    if (saved.view && FOLLOW_UP_VIEWS.includes(saved.view)) setView(saved.view);
    setAssigned(saved.assigned !== undefined ? saved.assigned : meta.role === "Staff" ? meta.me : "");
  }, [meta, assigned]);

  useEffect(() => {
    if (assigned === null) return;
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ view, assigned }));
    } catch {
      /* not remembered */
    }
  }, [view, assigned]);

  const load = useCallback(async () => {
    if (assigned === null) return;
    const id = ++requestId.current;
    setLoading(true);
    const params = new URLSearchParams({ view, page: String(page), pageSize: String(PAGE_SIZE) });
    if (assigned) params.set("assigned_to", assigned);
    const res = await api(`/api/crm/tasks?${params}`);
    if (id !== requestId.current) return;
    setLoading(false);
    if (!res.ok) return setError(res.body.error || "Could not load the follow-ups");
    setError(null);
    setTasks(res.body.tasks);
    setTotal(res.body.total);
    setCounts(res.body.counts);
  }, [view, assigned, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function reassign(t: Task, assigned_to: string) {
    const res = await api(`/api/crm/tasks/${t.id}`, { method: "PATCH", body: { assigned_to } });
    if (!res.ok) return setNote(res.body.error || "Could not change who has it");
    setNote(`Now with ${personName(meta?.assignees.find((a) => a.id === assigned_to)?.email)}.`);
    load();
  }

  async function saveDate() {
    if (!rescheduling?.date) return;
    const res = await api(`/api/crm/tasks/${rescheduling.id}`, { method: "PATCH", body: { due_date: rescheduling.date } });
    if (!res.ok) return setNote(res.body.error || "Could not change the date");
    setRescheduling(null);
    setNote("Date changed.");
    load();
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tab = TABS.find((t) => t.view === view)!;

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "0.9rem" }}>
          <h2 style={{ margin: 0 }}>Follow-ups</h2>
          <div className="field" style={{ margin: 0, minWidth: 220 }}>
            <label>Whose follow-ups</label>
            <select
              value={assigned ?? ""}
              onChange={(e) => {
                setAssigned(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Everyone</option>
              {meta && <option value={meta.me}>Mine</option>}
              <option value="none">Unassigned</option>
              {meta?.assignees
                .filter((a) => a.id !== meta.me)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {personName(a.email)}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.view}
              role="tab"
              aria-selected={view === t.view}
              className={view === t.view ? "active" : ""}
              title={t.hint}
              onClick={() => {
                setView(t.view);
                setPage(1);
                setNote(null);
              }}
              style={t.view === "overdue" && counts && counts.overdue > 0 && view !== "overdue" ? { color: "#b3261e" } : undefined}
            >
              {t.label}
              {counts ? ` (${counts[t.view]})` : ""}
            </button>
          ))}
        </div>
        <p style={{ margin: "-0.75rem 0 0.9rem", fontSize: "0.78rem", color: "var(--muted)" }}>{tab.hint}. Today is {fmtDate(dublinToday())}.</p>

        {note && <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>{note}</p>}
        {error && <p className="error-text">{error}</p>}

        <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Next action</th>
                <th>{view === "completed" ? "Completed" : "Due"}</th>
                <th>Assigned to</th>
                <th>Last activity</th>
                <th>{view === "completed" ? "Result" : ""}</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const state = view === "completed" ? "none" : followUpState(t.due_date);
                return (
                  <tr key={t.id} style={{ cursor: "default" }}>
                    <td style={{ fontWeight: 600 }}>
                      <Link href={`/dashboard/crm/companies/${t.company_id}`} style={{ color: "inherit" }}>
                        {t.company_name ?? "—"}
                      </Link>
                    </td>
                    <td>{t.contact_name ?? "—"}</td>
                    <td style={{ whiteSpace: "normal", minWidth: 180 }}>{t.title}</td>
                    <td style={{ color: FOLLOW_UP_COLOR[state], fontWeight: state === "overdue" || state === "today" ? 600 : undefined }}>
                      {view === "completed" ? fmtDateTime(t.completed_at) : fmtDate(t.due_date)}
                      {state === "overdue" ? " (overdue)" : ""}
                    </td>
                    <td>
                      {view === "completed" ? (
                        personName(t.assignee_email)
                      ) : (
                        <select style={{ width: "auto", fontSize: "0.8rem", padding: "0.25rem 0.4rem" }} value={t.assigned_to ?? ""} onChange={(e) => reassign(t, e.target.value)} aria-label={`Who has ${t.title}`}>
                          {!t.assigned_to && <option value="">Unassigned</option>}
                          {meta?.assignees.map((a) => (
                            <option key={a.id} value={a.id}>
                              {personName(a.email)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td style={{ color: "var(--muted)" }}>{t.last_activity_type ? `${t.last_activity_type}, ${fmtDate(t.last_activity_at)}` : "None yet"}</td>
                    <td style={{ whiteSpace: view === "completed" ? "normal" : "nowrap" }}>
                      {view === "completed" ? (
                        t.result || "—"
                      ) : rescheduling?.id === t.id ? (
                        <span style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
                          <input type="date" style={{ width: "auto" }} value={rescheduling.date} min={dublinToday()} onChange={(e) => setRescheduling({ id: t.id, date: e.target.value })} />
                          <button className="btn" style={{ padding: "0.25rem 0.6rem", fontSize: "0.78rem" }} disabled={!rescheduling.date} onClick={saveDate}>
                            Save
                          </button>
                          <button className="btn btn-secondary" style={{ padding: "0.25rem 0.6rem", fontSize: "0.78rem" }} onClick={() => setRescheduling(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", gap: "0.35rem" }}>
                          <button className="btn" style={{ padding: "0.25rem 0.6rem", fontSize: "0.78rem" }} onClick={() => setCompleting(t)}>
                            Complete
                          </button>
                          <button className="btn btn-secondary" style={{ padding: "0.25rem 0.6rem", fontSize: "0.78rem" }} onClick={() => setRescheduling({ id: t.id, date: t.due_date })}>
                            Change date
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && tasks.length === 0 && !error && (
            <p style={{ color: "var(--muted)", textAlign: "center", padding: "1.5rem 0" }}>
              {view === "completed" ? "No completed follow-ups yet." : view === "overdue" ? "Nothing is overdue. Well done." : "Nothing here."}
            </p>
          )}
        </div>

        <div className="crm-pager">
          <span style={{ color: "var(--muted)" }}>{total === 0 ? "0 follow-ups" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}</span>
          <span style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button className="btn btn-secondary" style={{ padding: "0.35rem 0.7rem" }} disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            Page {page} of {pages}
            <button className="btn btn-secondary" style={{ padding: "0.35rem 0.7rem" }} disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </span>
        </div>
      </div>

      {completing && (
        <CompleteDialog
          task={{ id: completing.id, title: completing.title, company_name: completing.company_name, assigned_to: completing.assigned_to }}
          onClose={() => setCompleting(null)}
          onDone={() => {
            setCompleting(null);
            setNote("Marked as done.");
            load();
          }}
        />
      )}
    </>
  );
}
