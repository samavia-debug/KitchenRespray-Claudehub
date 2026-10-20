"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IMPORT_TARGETS, validateMapping } from "@/lib/crm/import/mapping";
import type { BatchRow } from "@/lib/crm/import/import-service";
import type { ImportResult } from "@/lib/crm/import/import-service";
import type { PlanCounts, PlanRow } from "@/lib/crm/import/plan";
import { PRIORITIES } from "@/lib/crm/types";
import { api } from "../api";
import { useCrm } from "../crm-context";
import { downloadExport } from "../download";
import { fmtDateTime, personName } from "../fmt";

type Parsed = { filename: string; sheets: string[]; sheetIndex: number; headers: string[]; rows: string[][]; suggestedTargets: string[]; cellsShortened: number };
type Defaults = { category_id: string; source: string; assigned_to: string; priority: string };
type Step = "upload" | "map" | "review" | "done";
type Filter = "all" | "duplicates" | "errors" | "warnings";

const STEPS: { id: Step; label: string }[] = [
  { id: "upload", label: "1. Choose a file" },
  { id: "map", label: "2. Match the columns" },
  { id: "review", label: "3. Check and decide" },
  { id: "done", label: "4. Done" },
];
const PAGE = 50;
const NO_DEFAULTS: Defaults = { category_id: "", source: "", assigned_to: "", priority: "" };

const STATUS_STYLE: Record<PlanRow["status"], { bg: string; fg: string; label: string }> = {
  ready: { bg: "rgba(46, 125, 50, 0.14)", fg: "#2e7d32", label: "Ready" },
  duplicate: { bg: "rgba(185, 137, 0, 0.16)", fg: "#8a6700", label: "Looks like a duplicate" },
  error: { bg: "rgba(179, 38, 30, 0.12)", fg: "#b3261e", label: "Cannot import" },
};

export default function ImportPage() {
  const { meta } = useCrm();
  const isOverseer = meta?.role === "Admin" || meta?.role === "Manager";

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<Defaults>(NO_DEFAULTS);
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [decisions, setDecisions] = useState<Record<number, "import" | "skip">>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<null | "reading" | "checking" | "importing">(null);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchRow[] | null>(null);
  const [batchNote, setBatchNote] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    const res = await api("/api/crm/import/batches");
    if (res.ok) setBatches(res.body.batches);
  }, []);
  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const mappingError = useMemo(() => (parsed ? validateMapping(targets, parsed.headers.length) : null), [parsed, targets]);

  async function readFile(f: File, sheet = 0) {
    setBusy("reading");
    setError(null);
    const form = new FormData();
    form.append("file", f);
    form.append("sheet", String(sheet));
    try {
      const res = await fetch("/api/crm/import/parse", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Could not read that file");
        return;
      }
      setFile(f);
      setParsed(body);
      setTargets(body.suggestedTargets);
      setDecisions({});
      setStep("map");
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setBusy(null);
    }
  }

  const payload = (confirmed: boolean) => ({
    filename: parsed!.filename,
    headers: parsed!.headers,
    rows: parsed!.rows,
    targets,
    defaults: { category_id: defaults.category_id || null, source: defaults.source || null, assigned_to: defaults.assigned_to || null, priority: defaults.priority || null },
    decisions,
    confirmed,
  });

  async function check() {
    setBusy("checking");
    setError(null);
    const res = await api("/api/crm/import/preview", { method: "POST", body: payload(false) });
    setBusy(null);
    if (!res.ok) return setError(res.body.error || "Could not check the import");
    setPlan(res.body.plan);
    setFilter(res.body.counts.duplicates > 0 ? "duplicates" : res.body.counts.errors > 0 ? "errors" : "all");
    setPage(1);
    setStep("review");
  }

  const effective = (p: PlanRow) => (p.status === "error" ? "skip" : decisions[p.index] ?? p.defaultAction);
  const counts: PlanCounts = useMemo(() => {
    const c: PlanCounts = { total: plan.length, ready: 0, duplicates: 0, errors: 0, withWarnings: 0, willImport: 0, willSkip: 0 };
    for (const p of plan) {
      if (p.status === "ready") c.ready++;
      else if (p.status === "duplicate") c.duplicates++;
      else c.errors++;
      if (p.warnings.length) c.withWarnings++;
      if (effective(p) === "import") c.willImport++;
      else c.willSkip++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, decisions]);

  const shown = plan.filter((p) => (filter === "all" ? true : filter === "duplicates" ? p.status === "duplicate" : filter === "errors" ? p.status === "error" : p.warnings.length > 0));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));

  async function runImport() {
    if (counts.willImport === 0) return;
    const skipping = counts.willSkip;
    if (!window.confirm(`Import ${counts.willImport} compan${counts.willImport === 1 ? "y" : "ies"}${skipping ? ` and skip ${skipping}` : ""}? Existing companies are never changed.`)) return;
    setBusy("importing");
    setError(null);
    const res = await api("/api/crm/import/commit", { method: "POST", body: payload(true) });
    setBusy(null);
    if (!res.ok) return setError(res.body.error || "Could not import the file");
    setResult(res.body);
    setStep("done");
    loadBatches();
  }

  function restart() {
    setStep("upload");
    setFile(null);
    setParsed(null);
    setPlan([]);
    setDecisions({});
    setResult(null);
    setError(null);
    setDefaults(NO_DEFAULTS);
  }

  async function undo(b: BatchRow) {
    if (!window.confirm(`Undo the import of "${b.filename ?? "this file"}"? Companies nobody has touched since are removed. Anything that has been edited or worked on stays.`)) return;
    setBatchNote(null);
    const res = await api(`/api/crm/import/batches/${b.id}/undo`, { method: "POST" });
    if (!res.ok) return setBatchNote(res.body.error || "Could not undo the import");
    setBatchNote(`Undone: ${res.body.removed} removed${res.body.kept ? `, ${res.body.kept} kept because they have been worked on` : ""}.`);
    loadBatches();
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Import companies from a spreadsheet</h2>
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          {STEPS.map((s, i) => (
            <span key={s.id} className="status-badge" style={{ background: i === stepIndex ? "var(--accent)" : "var(--accent-soft)", color: i === stepIndex ? "#fff" : "var(--muted)" }}>
              {s.label}
            </span>
          ))}
        </div>
        {error && <p className="error-text" style={{ marginTop: 0 }}>{error}</p>}

        {step === "upload" && (
          <>
            <p style={{ margin: "0 0 1rem", fontSize: "0.9rem", color: "var(--muted)" }}>
              Upload an Excel (.xlsx) or CSV file with one company per row. You will match its columns, then see every problem and possible duplicate before anything is saved. Existing companies are never changed.
            </p>
            <div className="field" style={{ maxWidth: 420 }}>
              <label>File</label>
              <input type="file" accept=".xlsx,.csv,.tsv,.txt" disabled={busy !== null} onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
              {busy === "reading" && <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.3rem" }}>Reading the file...</div>}
            </div>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>Up to 5 MB and 5,000 rows at a time. Old .xls files and PDFs cannot be read: save the sheet as .xlsx or CSV first.</p>
          </>
        )}

        {step === "map" && parsed && (
          <>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
              <strong>{parsed.filename}</strong>: {parsed.rows.length} rows, {parsed.headers.length} columns. Check what each column is; I have made a first guess.
            </p>
            {parsed.cellsShortened > 0 && <p style={{ fontSize: "0.82rem", color: "#b98900" }}>{parsed.cellsShortened} very long cell(s) were cut to 5,000 characters.</p>}
            {parsed.sheets.length > 1 && (
              <div className="field" style={{ maxWidth: 320 }}>
                <label>Sheet</label>
                <select value={parsed.sheetIndex} onChange={(e) => file && readFile(file, Number(e.target.value))} disabled={busy !== null}>
                  {parsed.sheets.map((s, i) => (
                    <option key={s} value={i}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Column in your file</th>
                    <th>Examples</th>
                    <th>Goes to</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.headers.map((h, i) => (
                    <tr key={i} style={{ cursor: "default", opacity: targets[i] === "ignore" ? 0.6 : 1 }}>
                      <td style={{ fontWeight: 600 }}>{h}</td>
                      <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", color: "var(--muted)" }}>
                        {parsed.rows
                          .map((r) => r[i])
                          .filter(Boolean)
                          .slice(0, 3)
                          .map((v) => (v.length > 36 ? `${v.slice(0, 33)}...` : v))
                          .join("  ·  ") || "(empty)"}
                      </td>
                      <td>
                        <select style={{ width: "auto", minWidth: 220 }} value={targets[i]} onChange={(e) => setTargets(targets.map((t, j) => (j === i ? e.target.value : t)))} aria-label={`Where ${h} goes`}>
                          {(["Company", "Contact", "Other"] as const).map((g) => (
                            <optgroup key={g} label={g === "Other" ? "Other" : g === "Company" ? "Company fields" : "Contact (adds a contact to the company)"}>
                              {IMPORT_TARGETS.filter((t) => t.group === g).map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mappingError && <p className="error-text">{mappingError}</p>}

            <h3 style={{ margin: "1.25rem 0 0.4rem", fontSize: "0.95rem" }}>For every row (used where the file has nothing)</h3>
            <div className="crm-form-grid">
              <div className="field">
                <label>Category</label>
                <select value={defaults.category_id} onChange={(e) => setDefaults({ ...defaults, category_id: e.target.value })}>
                  <option value="">None</option>
                  {meta?.categories.filter((c) => c.active).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Source</label>
                <input value={defaults.source} maxLength={120} onChange={(e) => setDefaults({ ...defaults, source: e.target.value })} placeholder="e.g. Google Maps, Dublin builders list" />
              </div>
              <div className="field">
                <label>Assign to</label>
                <select value={defaults.assigned_to} onChange={(e) => setDefaults({ ...defaults, assigned_to: e.target.value })}>
                  <option value="">Unassigned</option>
                  {meta?.assignees.map((a) => (
                    <option key={a.id} value={a.id}>
                      {personName(a.email)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Priority</label>
                <select value={defaults.priority} onChange={(e) => setDefaults({ ...defaults, priority: e.target.value })}>
                  <option value="">Medium (usual)</option>
                  {PRIORITIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem" }}>
              <button className="btn" onClick={check} disabled={!!mappingError || busy !== null}>
                {busy === "checking" ? "Checking..." : "Check my import"}
              </button>
              <button className="btn btn-secondary" onClick={restart} disabled={busy !== null}>
                Choose a different file
              </button>
            </div>
          </>
        )}

        {step === "review" && parsed && (
          <>
            <div className="stat-grid">
              {[
                ["Ready", counts.ready, "#2e7d32"],
                ["Look like duplicates", counts.duplicates, "#8a6700"],
                ["Cannot be imported", counts.errors, "#b3261e"],
                ["With a warning", counts.withWarnings, undefined],
              ].map(([label, n, color]) => (
                <div className="stat-card" key={label as string}>
                  <div className="stat-value" style={{ color: color as string | undefined }}>
                    {n as number}
                  </div>
                  <div className="stat-label">{label as string}</div>
                </div>
              ))}
            </div>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
              <strong>{counts.willImport}</strong> compan{counts.willImport === 1 ? "y" : "ies"} will be imported and <strong>{counts.willSkip}</strong> skipped. A strong look-alike (same phone, website or name) is skipped unless you choose to import it. You can change any row below.
            </p>

            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              {(
                [
                  ["all", `All (${counts.total})`],
                  ["duplicates", `Possible duplicates (${counts.duplicates})`],
                  ["errors", `Cannot import (${counts.errors})`],
                  ["warnings", `Warnings (${counts.withWarnings})`],
                ] as [Filter, string][]
              ).map(([id, label]) => (
                <button key={id} className={filter === id ? "btn" : "btn btn-secondary"} style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }} onClick={() => { setFilter(id); setPage(1); }}>
                  {label}
                </button>
              ))}
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th>What I found</th>
                    <th>What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice((page - 1) * PAGE, page * PAGE).map((p) => {
                    const st = STATUS_STYLE[p.status];
                    const action = effective(p);
                    return (
                      <tr key={p.index} style={{ cursor: "default" }}>
                        <td>{p.index + 2}</td>
                        <td style={{ fontWeight: 600, whiteSpace: "normal", minWidth: 160 }}>{p.label}</td>
                        <td>
                          <span className="status-badge" style={{ background: st.bg, color: st.fg }}>
                            {st.label}
                          </span>
                        </td>
                        <td style={{ whiteSpace: "normal", minWidth: 260, fontSize: "0.82rem" }}>
                          {p.errors.map((e, i) => (
                            <div key={`e${i}`} style={{ color: "#b3261e" }}>
                              {e}
                            </div>
                          ))}
                          {p.matches.map((m) => (
                            <div key={m.id}>
                              Looks like{" "}
                              <Link href={`/dashboard/crm/companies/${m.id}`} target="_blank">
                                {m.name}
                              </Link>
                              {m.city ? `, ${m.city}` : ""} <span style={{ color: "var(--muted)" }}>({m.reasons.join(", ")})</span>
                            </div>
                          ))}
                          {p.fileMatches.map((m) => (
                            <div key={`f${m.row}`}>
                              Looks like row {m.row + 2} of this file, {m.label} <span style={{ color: "var(--muted)" }}>({m.reasons.join(", ")})</span>
                            </div>
                          ))}
                          {p.warnings.map((w, i) => (
                            <div key={`w${i}`} style={{ color: "#8a6700" }}>
                              {w}
                            </div>
                          ))}
                          {p.contactNote && <div style={{ color: "var(--muted)" }}>{p.contactNote}</div>}
                          {!p.errors.length && !p.matches.length && !p.fileMatches.length && !p.warnings.length && !p.contactNote && <span style={{ color: "var(--muted)" }}>Nothing to flag</span>}
                        </td>
                        <td>
                          {p.status === "error" ? (
                            <span style={{ color: "var(--muted)" }}>Skipped</span>
                          ) : (
                            <select
                              style={{ width: "auto", fontSize: "0.82rem", padding: "0.3rem 0.45rem", fontWeight: 600, color: action === "import" ? "#2e7d32" : "#8a6700" }}
                              value={action}
                              onChange={(e) => setDecisions({ ...decisions, [p.index]: e.target.value as "import" | "skip" })}
                              aria-label={`What happens to row ${p.index + 2}`}
                            >
                              <option value="import">Import</option>
                              <option value="skip">Skip</option>
                            </select>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {shown.length === 0 && <p style={{ color: "var(--muted)", textAlign: "center", padding: "1.25rem 0" }}>Nothing in this list.</p>}
            </div>
            <div className="crm-pager">
              <span style={{ color: "var(--muted)" }}>{shown.length} row{shown.length === 1 ? "" : "s"}</span>
              <span style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button className="btn btn-secondary" style={{ padding: "0.35rem 0.7rem" }} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                Page {page} of {pages}
                <button className="btn btn-secondary" style={{ padding: "0.35rem 0.7rem" }} disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Next
                </button>
              </span>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem", flexWrap: "wrap" }}>
              <button className="btn" onClick={runImport} disabled={busy !== null || counts.willImport === 0}>
                {busy === "importing" ? "Importing..." : `Import ${counts.willImport} compan${counts.willImport === 1 ? "y" : "ies"}`}
              </button>
              <button className="btn btn-secondary" onClick={() => setStep("map")} disabled={busy !== null}>
                Back: change the column choices
              </button>
              <button className="btn btn-secondary" onClick={restart} disabled={busy !== null}>
                Cancel
              </button>
            </div>
          </>
        )}

        {step === "done" && result && (
          <>
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-value" style={{ color: "#2e7d32" }}>{result.imported}</div>
                <div className="stat-label">Companies imported</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{result.contactsCreated}</div>
                <div className="stat-label">Contacts added</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: "#8a6700" }}>{result.skippedCount}</div>
                <div className="stat-label">Skipped</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: result.failedCount ? "#b3261e" : undefined }}>{result.failedCount}</div>
                <div className="stat-label">Failed</div>
              </div>
            </div>
            {result.warningCount > 0 && <p style={{ fontSize: "0.85rem" }}>{result.warningCount} row(s) were imported with a warning (a detail that was not valid was left out and kept under the company's imported details).</p>}

            {result.failedCount > 0 && (
              <>
                <h3 style={{ fontSize: "0.95rem" }}>Failed rows</h3>
                <ul style={{ fontSize: "0.85rem", paddingLeft: "1.2rem" }}>
                  {result.failed.map((f) => (
                    <li key={f.row}>
                      Row {f.row}, {f.label}: {f.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {result.skippedCount > 0 && (
              <details style={{ margin: "0.5rem 0" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.9rem" }}>Skipped rows ({result.skippedCount})</summary>
                <ul style={{ fontSize: "0.85rem", paddingLeft: "1.2rem" }}>
                  {result.skipped.map((s) => (
                    <li key={s.row}>
                      Row {s.row}, {s.label}: {s.reason}
                    </li>
                  ))}
                  {result.skippedCount > result.skipped.length && <li>and {result.skippedCount - result.skipped.length} more</li>}
                </ul>
              </details>
            )}

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
              <Link href="/dashboard/crm/companies" className="btn">
                View companies
              </Link>
              <button className="btn btn-secondary" onClick={restart}>
                Import another file
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Recent imports</h2>
        {batchNote && <p style={{ margin: "0 0 0.6rem", fontSize: "0.85rem" }}>{batchNote}</p>}
        {!batches && <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>}
        {batches && batches.length === 0 && <p style={{ color: "var(--muted)", margin: 0 }}>No imports yet.</p>}
        {batches && batches.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>File</th>
                  <th>By</th>
                  <th>Imported</th>
                  <th>Skipped</th>
                  <th>Failed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} style={{ cursor: "default" }}>
                    <td>{fmtDateTime(b.created_at)}</td>
                    <td>{b.filename ?? "—"}</td>
                    <td>{personName(b.created_by_email)}</td>
                    <td>{b.imported_count}</td>
                    <td>{b.skipped_count}</td>
                    <td>{b.failed_count}</td>
                    <td>
                      {b.undone_at ? (
                        <span style={{ color: "var(--muted)" }}>Undone {fmtDateTime(b.undone_at)}</span>
                      ) : (
                        isOverseer &&
                        b.imported_count > 0 && (
                          <button className="btn btn-secondary" style={{ padding: "0.25rem 0.6rem", fontSize: "0.78rem" }} onClick={() => undo(b)}>
                            Undo
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>Undoing an import removes the companies it created that nobody has touched since. Anything that has been edited or worked on is kept.</p>
      </div>

      {isOverseer && <ExportCard />}
    </>
  );
}

function ExportCard() {
  const [type, setType] = useState("companies");
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setMessage(null);
    const err = await downloadExport({ type, format });
    setBusy(false);
    setMessage(err ?? "Downloaded.");
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Export</h2>
      <p style={{ margin: "0 0 0.9rem", fontSize: "0.88rem", color: "var(--muted)" }}>
        Download everything of one kind. To export only some companies, use the Export buttons on the Companies page, which follow your filters and selection. These files hold business contact details, so keep them safe.
      </p>
      <div className="crm-form-grid" style={{ maxWidth: 560 }}>
        <div className="field">
          <label>What</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="companies">Companies</option>
            <option value="contacts">Contacts</option>
            <option value="activities">Activities</option>
            <option value="opportunities">Opportunities</option>
          </select>
        </div>
        <div className="field">
          <label>Format</label>
          <select value={format} onChange={(e) => setFormat(e.target.value as "csv" | "xlsx")}>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV (opens in Excel)</option>
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "0.9rem" }}>
        <button className="btn" onClick={go} disabled={busy}>
          {busy ? "Preparing..." : "Download"}
        </button>
        {message && <span style={{ fontSize: "0.85rem" }}>{message}</span>}
      </div>
    </div>
  );
}
