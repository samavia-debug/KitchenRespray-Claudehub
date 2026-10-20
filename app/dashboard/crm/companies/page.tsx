"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanyRow } from "@/lib/crm/service";
import { PRIORITIES, type SortField } from "@/lib/crm/types";
import { api } from "../api";
import { downloadExport } from "../download";
import { PriorityMark, StageBadge } from "../badges";
import { useCrm } from "../crm-context";
import { FOLLOW_UP_COLOR, fmtDate, fmtMoney, followUpState, personName } from "../fmt";

type Filters = {
  q: string;
  category_id: string;
  stage_id: string;
  assigned_to: string;
  priority: string;
  source: string;
  location: string;
  contacted_before: string;
  follow_up_before: string;
  min_value: string;
  max_value: string;
  sort: SortField;
  dir: "asc" | "desc";
  page: number;
};

const DEFAULTS: Filters = {
  q: "", category_id: "", stage_id: "", assigned_to: "", priority: "", source: "", location: "", contacted_before: "", follow_up_before: "",
  min_value: "", max_value: "", sort: "name", dir: "asc", page: 1,
};
const PAGE_SIZE = 25;
const STORE_KEY = "crm-company-filters";

function loadSaved(): Filters {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const SORTABLE: { field: SortField; label: string }[] = [
  { field: "name", label: "Company" },
  { field: "city", label: "City" },
  { field: "next_follow_up", label: "Next follow-up" },
  { field: "estimated_value", label: "Estimate" },
  { field: "created_at", label: "Added" },
];

export default function CompaniesPage() {
  const router = useRouter();
  const { meta } = useCrm();
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [qInput, setQInput] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAssign, setBulkAssign] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const requestId = useRef(0);

  // Filters are kept for the tab, so coming back from a company's page does not lose the search.
  useEffect(() => {
    const saved = loadSaved();
    setFilters(saved);
    setQInput(saved.q);
    setShowMore(!!(saved.source || saved.location || saved.contacted_before || saved.follow_up_before || saved.min_value || saved.max_value));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(filters));
    } catch {
      /* private window: filters just are not remembered */
    }
  }, [filters, ready]);

  // The search box waits for a pause in typing before asking the server.
  useEffect(() => {
    if (!ready || qInput === filters.q) return;
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: qInput, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [qInput, filters.q, ready]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    for (const [k, v] of Object.entries(filters)) if (v !== "" && v !== null) params.set(k, String(v));
    const res = await api(`/api/crm/companies?${params}`);
    if (id !== requestId.current) return; // a newer search has replaced this one
    setLoading(false);
    if (!res.ok) return setError(res.body.error || "Could not load the companies");
    setError(null);
    setRows(res.body.companies);
    setTotal(res.body.total);
    setSelected(new Set());
  }, [filters]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch, page: 1 }));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = JSON.stringify({ ...filters, sort: "", dir: "", page: 0 }) !== JSON.stringify({ ...DEFAULTS, sort: "", dir: "", page: 0 });

  function sortBy(field: SortField) {
    setFilters((f) => ({ ...f, sort: field, dir: f.sort === field && f.dir === "asc" ? "desc" : "asc", page: 1 }));
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulk(action: "assign" | "category") {
    const value = action === "assign" ? bulkAssign : bulkCategory;
    if (action === "category" && !value) return;
    const target =
      action === "assign"
        ? value === "none"
          ? "Unassigned"
          : personName(meta?.assignees.find((a) => a.id === value)?.email)
        : meta?.categories.find((c) => c.id === value)?.name;
    const what = action === "assign" ? `assign ${selected.size} compan${selected.size === 1 ? "y" : "ies"} to ${target}` : `set the category of ${selected.size} compan${selected.size === 1 ? "y" : "ies"} to ${target}`;
    if (!window.confirm(`Are you sure you want to ${what}?`)) return;

    setBulkBusy(true);
    setBulkMessage(null);
    const res = await api("/api/crm/companies/bulk", { method: "POST", body: { ids: Array.from(selected), action, value: value === "none" ? null : value, confirmed: true } });
    setBulkBusy(false);
    if (!res.ok) return setBulkMessage(res.body.error || "Could not apply the change");
    setBulkMessage(`Done: ${res.body.updated} updated.`);
    setBulkAssign("");
    setBulkCategory("");
    load();
  }

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const isOverseer = meta?.role === "Admin" || meta?.role === "Manager";

  /** Exports what is selected, or else everything the current search and filters show (not just this page). */
  async function exportRows(format: "csv" | "xlsx") {
    setExporting(true);
    setExportNote(null);
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v !== "" && v !== null && k !== "page") qs.set(k, String(v));
    const err = await downloadExport({ type: "companies", format, ...(selected.size > 0 ? { ids: Array.from(selected) } : { qs: qs.toString() }) });
    setExporting(false);
    setExportNote(err ?? `Exported ${selected.size > 0 ? selected.size : total} compan${(selected.size > 0 ? selected.size : total) === 1 ? "y" : "ies"}.`);
  }

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
          <h2 style={{ margin: 0 }}>Companies</h2>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            {isOverseer && (
              <>
                <button className="btn btn-secondary" style={{ padding: "0.5rem 0.8rem", fontSize: "0.85rem" }} disabled={exporting || total === 0} onClick={() => exportRows("xlsx")} title="Downloads an Excel file of the selected companies, or of everything the filters show">
                  {exporting ? "Preparing..." : selected.size > 0 ? `Export ${selected.size} selected (Excel)` : `Export ${total} shown (Excel)`}
                </button>
                <button className="btn btn-secondary" style={{ padding: "0.5rem 0.8rem", fontSize: "0.85rem" }} disabled={exporting || total === 0} onClick={() => exportRows("csv")}>
                  CSV
                </button>
              </>
            )}
            <Link href="/dashboard/crm/import" className="btn btn-secondary" style={{ padding: "0.5rem 0.8rem", fontSize: "0.85rem" }}>
              Import
            </Link>
            <Link href="/dashboard/crm/companies/new" className="btn">
              + Add company
            </Link>
          </div>
        </div>
        {exportNote && <p style={{ margin: "-0.4rem 0 0.75rem", fontSize: "0.85rem" }}>{exportNote}</p>}

        <div className="crm-filters">
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label>Search</label>
            <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Company, contact, email, phone, town..." />
          </div>
          <div className="field">
            <label>Category</label>
            <select value={filters.category_id} onChange={(e) => set({ category_id: e.target.value })}>
              <option value="">All</option>
              {meta?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? "" : " (off)"}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Stage</label>
            <select value={filters.stage_id} onChange={(e) => set({ stage_id: e.target.value })}>
              <option value="">All</option>
              {meta?.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Assigned to</label>
            <select value={filters.assigned_to} onChange={(e) => set({ assigned_to: e.target.value })}>
              <option value="">Anyone</option>
              <option value="none">Unassigned</option>
              {meta?.assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {personName(a.email)}
                  {a.id === meta.me ? " (me)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Priority</label>
            <select value={filters.priority} onChange={(e) => set({ priority: e.target.value })}>
              <option value="">Any</option>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ margin: "0.6rem 0", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary" style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }} onClick={() => setShowMore(!showMore)}>
            {showMore ? "Fewer filters" : "More filters"}
          </button>
          {hasFilters && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }}
              onClick={() => {
                setQInput("");
                setFilters(DEFAULTS);
              }}
            >
              Clear all filters
            </button>
          )}
        </div>

        {showMore && (
          <div className="crm-filters" style={{ marginBottom: "0.9rem" }}>
            <div className="field">
              <label>Location (town, county, postcode)</label>
              <input value={filters.location} onChange={(e) => set({ location: e.target.value })} />
            </div>
            <div className="field">
              <label>Lead source</label>
              <input value={filters.source} onChange={(e) => set({ source: e.target.value })} placeholder="e.g. Google Maps" />
            </div>
            <div className="field">
              <label>Not contacted since</label>
              <input type="date" value={filters.contacted_before} onChange={(e) => set({ contacted_before: e.target.value })} />
            </div>
            <div className="field">
              <label>Follow-up due by</label>
              <input type="date" value={filters.follow_up_before} onChange={(e) => set({ follow_up_before: e.target.value })} />
            </div>
            <div className="field">
              <label>Estimate from (€)</label>
              <input inputMode="decimal" value={filters.min_value} onChange={(e) => set({ min_value: e.target.value })} />
            </div>
            <div className="field">
              <label>Estimate up to (€)</label>
              <input inputMode="decimal" value={filters.max_value} onChange={(e) => set({ max_value: e.target.value })} />
            </div>
          </div>
        )}

        {selected.size > 0 && (
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", padding: "0.6rem 0.75rem", background: "var(--accent-soft)", borderRadius: 8, marginBottom: "0.75rem" }}>
            <strong style={{ fontSize: "0.85rem" }}>{selected.size} selected</strong>
            <select style={{ width: "auto" }} value={bulkAssign} onChange={(e) => setBulkAssign(e.target.value)} aria-label="Assign selected to">
              <option value="">Assign to...</option>
              <option value="none">Unassigned</option>
              {meta?.assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {personName(a.email)}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary" style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }} disabled={!bulkAssign || bulkBusy} onClick={() => applyBulk("assign")}>
              Assign
            </button>
            <select style={{ width: "auto" }} value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} aria-label="Set category of selected">
              <option value="">Set category...</option>
              {meta?.categories
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <button className="btn btn-secondary" style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }} disabled={!bulkCategory || bulkBusy} onClick={() => applyBulk("category")}>
              Set category
            </button>
            <button className="btn btn-secondary" style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }} onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>
        )}
        {bulkMessage && <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>{bulkMessage}</p>}
        {error && <p className="error-text">{error}</p>}

        <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPage}
                    onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
                {SORTABLE.slice(0, 2).map((s) => (
                  <th key={s.field} onClick={() => sortBy(s.field)} style={{ cursor: "pointer" }}>
                    {s.label} {filters.sort === s.field ? (filters.dir === "asc" ? "▲" : "▼") : ""}
                  </th>
                ))}
                <th>Category</th>
                <th>Stage</th>
                <th>Priority</th>
                <th>Assigned to</th>
                <th>Phone</th>
                {SORTABLE.slice(2).map((s) => (
                  <th key={s.field} onClick={() => sortBy(s.field)} style={{ cursor: "pointer" }}>
                    {s.label} {filters.sort === s.field ? (filters.dir === "asc" ? "▲" : "▼") : ""}
                  </th>
                ))}
                <th>Contacts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const fu = followUpState(c.next_follow_up);
                return (
                  <tr key={c.id} onClick={() => router.push(`/dashboard/crm/companies/${c.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      <Link href={`/dashboard/crm/companies/${c.id}`} onClick={(e) => e.stopPropagation()} style={{ color: "inherit" }}>
                        {c.name}
                      </Link>
                    </td>
                    <td>{c.city || "—"}</td>
                    <td>{c.category_name || "—"}</td>
                    <td>
                      <StageBadge name={c.stage_name} kind={c.stage_kind} />
                    </td>
                    <td>
                      <PriorityMark priority={c.priority} />
                    </td>
                    <td>{c.assignee_email ? personName(c.assignee_email) : <span style={{ color: "var(--muted)" }}>Unassigned</span>}</td>
                    <td>{c.phone || "—"}</td>
                    <td style={{ color: FOLLOW_UP_COLOR[fu], fontWeight: fu === "overdue" || fu === "today" ? 600 : undefined }}>
                      {fmtDate(c.next_follow_up)}
                      {fu === "overdue" ? " (overdue)" : fu === "today" ? " (today)" : ""}
                    </td>
                    <td>{fmtMoney(c.estimated_value)}</td>
                    <td>{fmtDate(c.created_at)}</td>
                    <td>{c.contact_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && rows.length === 0 && !error && (
            <p style={{ color: "var(--muted)", textAlign: "center", padding: "1.5rem 0" }}>
              {hasFilters ? "No companies match these filters." : "No companies yet. Add the first one, or import your spreadsheet when the import step is ready."}
            </p>
          )}
        </div>

        <div className="crm-pager">
          <span style={{ color: "var(--muted)" }}>
            {total === 0 ? "0 companies" : `${(filters.page - 1) * PAGE_SIZE + 1}–${Math.min(filters.page * PAGE_SIZE, total)} of ${total}`}
          </span>
          <span style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button className="btn btn-secondary" style={{ padding: "0.35rem 0.7rem" }} disabled={filters.page <= 1 || loading} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>
              Previous
            </button>
            Page {filters.page} of {pages}
            <button className="btn btn-secondary" style={{ padding: "0.35rem 0.7rem" }} disabled={filters.page >= pages || loading} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>
              Next
            </button>
          </span>
        </div>
      </div>
      <p style={{ fontSize: "0.78rem", color: "var(--muted)" }}>The estimate is a guess at the size of the job and is never counted as sales. Value won is recorded only when a deal is marked Won.</p>
    </>
  );
}
