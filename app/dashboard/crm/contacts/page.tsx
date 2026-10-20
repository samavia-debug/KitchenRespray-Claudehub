"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ContactListRow } from "@/lib/crm/service";
import { api } from "../api";
import { fmtDate, personName, whatsappLink } from "../fmt";

const PAGE_SIZE = 25;

export default function ContactsPage() {
  const router = useRouter();
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ContactListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (q) params.set("q", q);
    const res = await api(`/api/crm/contacts?${params}`);
    if (id !== requestId.current) return;
    setLoading(false);
    if (!res.ok) return setError(res.body.error || "Could not load the contacts");
    setError(null);
    setRows(res.body.contacts);
    setTotal(res.body.total);
  }, [q, page]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="card">
      <h2>Contacts</h2>
      <div className="field" style={{ maxWidth: 420 }}>
        <label>Search</label>
        <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Name, job title, email or phone" />
      </div>
      {error && <p className="error-text">{error}</p>}

      <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Job title</th>
              <th>Company</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Prefers</th>
              <th>Assigned to</th>
              <th>Follow-up</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const wa = whatsappLink(c.phone);
              return (
                <tr key={c.id} onClick={() => router.push(`/dashboard/crm/companies/${c.company_id}`)}>
                  <td style={{ fontWeight: 600 }}>{c.full_name}</td>
                  <td>{c.job_title || "—"}</td>
                  <td>
                    <Link href={`/dashboard/crm/companies/${c.company_id}`} onClick={(e) => e.stopPropagation()} style={{ color: "inherit" }}>
                      {c.company_name || "—"}
                    </Link>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {c.phone ? <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}>{c.phone}</a> : "—"}
                    {wa && (
                      <>
                        {" "}
                        <a href={wa} target="_blank" rel="noreferrer" style={{ fontSize: "0.78rem" }} title="Opens a WhatsApp chat. You write and send the message yourself.">
                          WhatsApp
                        </a>
                      </>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}</td>
                  <td>{c.preferred_method || "—"}</td>
                  <td>{c.assignee_email ? personName(c.assignee_email) : "—"}</td>
                  <td>{fmtDate(c.next_follow_up)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && rows.length === 0 && !error && (
          <p style={{ color: "var(--muted)", textAlign: "center", padding: "1.5rem 0" }}>
            {q ? "No contacts match that search." : "No contacts yet. Add contacts from a company's page, once the person is known."}
          </p>
        )}
      </div>

      <div className="crm-pager">
        <span style={{ color: "var(--muted)" }}>{total === 0 ? "0 contacts" : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}</span>
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
  );
}
