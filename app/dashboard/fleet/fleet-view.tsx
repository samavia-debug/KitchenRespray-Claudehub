"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DUE_KINDS, DUE_LABEL, dueField, dueItem, dueSoon, equityOf, fleetTotals, missingDates, type DueKind, type Van, type VanInput } from "@/lib/fleet/fleet";

const LEVEL_COLOR: Record<string, string> = { expired: "#b3261e", urgent: "#b3261e", soon: "#b98900", watch: "#8a6d00", ok: "#2e7d32" };

const euro = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);

const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const BLANK: VanInput = {
  reg: "", model: null, driver: null, lender: null, agreement: null, value_eur: null, monthly_eur: null, settlement_eur: null,
  weight_kg: null, tax_pin: null, tax_due: null, doe_due: null, insurance_due: null, status: "active", notes: null,
};

const toInput = (v: Van): VanInput => ({
  reg: v.reg, model: v.model, driver: v.driver, lender: v.lender, agreement: v.agreement, value_eur: v.value_eur, monthly_eur: v.monthly_eur,
  settlement_eur: v.settlement_eur, weight_kg: v.weight_kg, tax_pin: v.tax_pin, tax_due: v.tax_due, doe_due: v.doe_due,
  insurance_due: v.insurance_due, status: v.status, notes: v.notes,
});

type ImportPreview = { sheets: string[]; sheetIndex: number; vans: number; added: number; updated: number; regsInHubNotInFile: number; monthOnly: number; warnings: string[] };

function DueCell({ van, kind, today }: { van: Van; kind: DueKind; today: string }) {
  const item = dueItem(van, kind, today);
  if (!item) return <span style={{ color: "var(--muted)" }}>not set</span>;
  return (
    <span style={{ color: LEVEL_COLOR[item.level], fontWeight: item.level === "ok" || item.level === "watch" ? 400 : 600 }} title={item.text}>
      {longDate(item.date)}
      <div style={{ fontSize: "0.72rem" }}>{item.text}</div>
    </span>
  );
}

export default function FleetView() {
  const [vans, setVans] = useState<Van[] | null>(null);
  const [today, setToday] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<"active" | "gone" | "all">("active");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<VanInput>(BLANK);
  const [busy, setBusy] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet");
      const body = await res.json();
      if (!res.ok) setError(body.error || "Could not load the vans");
      else {
        setError(null);
        setVans(body.vans);
        setToday(body.today);
      }
    } catch (e: any) {
      setError(e.message || "Network error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);
  const totals = useMemo(() => fleetTotals(vans || []), [vans]);
  const soon = useMemo(() => (vans && today ? dueSoon(vans, today, 30) : []), [vans, today]);
  const missing = useMemo(() => missingDates(vans || []), [vans]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (vans || []).filter(
      (v) => (show === "all" || v.status === show) && (!q || `${v.reg} ${v.model ?? ""} ${v.driver ?? ""} ${v.lender ?? ""}`.toLowerCase().includes(q))
    );
  }, [vans, search, show]);

  function open(v: Van) {
    setEditing(v.id);
    setForm(toInput(v));
    setMessage(null);
  }

  const change = <K extends keyof VanInput>(key: K, value: VanInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const text = (key: "model" | "driver" | "lender" | "agreement" | "tax_pin" | "notes") => ({
    value: form[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(key, e.target.value || null),
  });
  const amount = (key: "value_eur" | "monthly_eur" | "settlement_eur" | "weight_kg") => ({
    type: "number" as const,
    min: 0,
    step: key === "weight_kg" ? 1 : 0.01,
    value: form[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => change(key, e.target.value === "" ? null : Number(e.target.value)),
  });

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(editing && editing !== "new" ? `/api/fleet/${editing}` : "/api/fleet", {
        method: editing && editing !== "new" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) setMessage(`Error: ${body.error}`);
      else {
        setEditing(null);
        setMessage(`${form.reg} saved.`);
        await load();
      }
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
    setBusy(false);
  }

  async function remove() {
    if (!editing || editing === "new" || !window.confirm(`Delete ${form.reg} from the list? To keep its history, mark it as gone instead.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/fleet/${editing}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) setMessage(`Error: ${body.error}`);
      else {
        setEditing(null);
        setMessage("Van deleted.");
        await load();
      }
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
    setBusy(false);
  }

  async function sendImport(commit: boolean, sheet?: number) {
    if (!file) return;
    setImporting(true);
    setMessage(null);
    const data = new FormData();
    data.append("file", file);
    if (sheet !== undefined) data.append("sheet", String(sheet));
    if (commit) data.append("commit", "1");
    try {
      const res = await fetch("/api/fleet/import", { method: "POST", body: data });
      const body = await res.json();
      if (!res.ok) {
        setPreview(null);
        setMessage(`Error: ${body.error}`);
      } else if (body.committed) {
        setPreview(null);
        setFile(null);
        setMessage(`Imported: ${body.added} added, ${body.updated} updated.${body.warnings?.length ? ` ${body.warnings.length} notes were reported before importing.` : ""}`);
        await load();
      } else {
        setPreview(body);
      }
    } catch (e: any) {
      // "Failed to fetch" is the browser's wording for no reply at all.
      setMessage(
        /failed to fetch|networkerror|load failed/i.test(e.message || "")
          ? "Error: The server did not answer, so nothing was imported. Check the Hub is running and your connection, then try again. If it keeps happening, the file may be open in Excel or still syncing from OneDrive: save a copy to your desktop and choose that."
          : `Error: ${e.message}`
      );
    }
    setImporting(false);
  }

  return (
    <>
      {message && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: message.startsWith("Error") ? "#b3261e" : undefined }}>
          <p style={{ margin: 0, color: message.startsWith("Error") ? "#b3261e" : undefined }}>{message}</p>
        </div>
      )}
      {tableMissing && <p className="error-text">The fleet table is not set up yet. Run the fleet migration in Supabase, then reload.</p>}
      {error && !tableMissing && <p className="error-text">{error}</p>}
      {!vans && !error && <p style={{ color: "var(--muted)" }}>Loading...</p>}

      {vans && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem", marginBottom: "1.25rem" }}>
            {[
              ["Vans on the road", String(totals.vans)],
              ["Total value", euro(totals.value)],
              ["Still owed to lenders", euro(totals.owed)],
              ["Equity (value less owed)", euro(totals.equity)],
              ["Monthly payments", euro(totals.monthly)],
            ].map(([label, value]) => (
              <div className="card" key={label} style={{ padding: "0.75rem 1rem" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{label}</div>
                <div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Due soon</h2>
            {soon.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)" }}>Nothing is overdue or due in the next 30 days.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Van</th>
                      <th>Driver</th>
                      <th>What</th>
                      <th>Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {soon.map((i) => (
                      <tr key={`${i.van.id}-${i.kind}`} style={{ cursor: "pointer" }} onClick={() => open(i.van)}>
                        <td>
                          <strong>{i.van.reg}</strong>
                          <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{i.van.model}</div>
                        </td>
                        <td>{i.van.driver ?? "—"}</td>
                        <td>{DUE_LABEL[i.kind]}</td>
                        <td>{longDate(i.date)}</td>
                        <td style={{ color: LEVEL_COLOR[i.level], fontWeight: 600 }}>{i.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(missing.tax > 0 || missing.doe > 0 || missing.insurance > 0) && totals.vans > 0 && (
              <p style={{ margin: "0.75rem 0 0", fontSize: "0.85rem", color: "#7a4a00" }}>
                Dates not entered yet, so no warning can be given for them: tax for {missing.tax} {missing.tax === 1 ? "van" : "vans"}, DOE for {missing.doe}, insurance for {missing.insurance}. Open a van to enter them.
              </p>
            )}
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Import from Excel</h2>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--muted)" }}>
              Choose the van list as an Excel (.xlsx) or CSV file. New vans are added and the figures for vans already here are updated. A blank cell never wipes what is in the Hub, and a due date typed here is only replaced by a real date in the file, never by a month name such as &ldquo;june&rdquo;.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                }}
              />
              <button className="btn btn-secondary" disabled={!file || importing} onClick={() => sendImport(false)}>
                {importing && !preview ? "Reading..." : "Check the file"}
              </button>
            </div>
            {preview && (
              <div style={{ marginTop: "0.75rem", fontSize: "0.9rem" }}>
                <div style={{ marginBottom: "0.5rem", display: preview.sheets.length > 1 ? "block" : "none" }}>
                  <label style={{ fontSize: "0.82rem", marginRight: "0.5rem" }}>Sheet</label>
                  <select value={preview.sheetIndex} onChange={(e) => sendImport(false, Number(e.target.value))} disabled={importing}>
                    {preview.sheets.map((s, i) => (
                      <option key={s} value={i}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <p style={{ margin: "0 0 0.5rem" }}>
                  <strong>{preview.vans} vans</strong> found: {preview.added} new, {preview.updated} already here.
                  {preview.regsInHubNotInFile > 0 && ` ${preview.regsInHubNotInFile} vans in the Hub are not in this file; they are left as they are.`}
                </p>
                {preview.monthOnly > 0 && (
                  <p style={{ margin: "0 0 0.5rem", color: "#7a4a00" }}>
                    {preview.monthOnly} vans have only a month (such as &ldquo;june&rdquo;) for a tax or DOE date. That is not a date, so it is kept as a note on the van and the real date has to be entered.
                  </p>
                )}
                {preview.warnings.length > 0 && (
                  <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.1rem", color: "#7a4a00", fontSize: "0.85rem" }}>
                    {preview.warnings.slice(0, 8).map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                <button className="btn" disabled={importing} onClick={() => sendImport(true, preview.sheetIndex)}>
                  {importing ? "Importing..." : `Import ${preview.vans} vans`}
                </button>
              </div>
            )}
          </div>

          {editing && (
            <div className="card" style={{ marginBottom: "1.25rem" }}>
              <h2 style={{ marginTop: 0 }}>{editing === "new" ? "Add a van" : `Edit ${form.reg}`}</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.75rem" }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Registration</label>
                  <input value={form.reg} onChange={(e) => change("reg", e.target.value)} placeholder="191 D 30807" />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Model</label>
                  <input {...text("model")} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Driver</label>
                  <input {...text("driver")} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Lender</label>
                  <input {...text("lender")} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Agreement number</label>
                  <input {...text("agreement")} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Value (€)</label>
                  <input {...amount("value_eur")} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Still owed (€, 0 if paid off)</label>
                  <input {...amount("settlement_eur")} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Monthly payment (€)</label>
                  <input {...amount("monthly_eur")} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Weight (kg)</label>
                  <input {...amount("weight_kg")} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Tax PIN</label>
                  <input {...text("tax_pin")} />
                </div>
                {DUE_KINDS.map((kind) => (
                  <div className="field" style={{ margin: 0 }} key={kind}>
                    <label>{DUE_LABEL[kind]} due</label>
                    <input type="date" value={form[dueField(kind)] ?? ""} onChange={(e) => change(dueField(kind), e.target.value || null)} />
                  </div>
                ))}
                <div className="field" style={{ margin: 0 }}>
                  <label>Status</label>
                  <select value={form.status} onChange={(e) => change("status", e.target.value as VanInput["status"])}>
                    <option value="active">On the road</option>
                    <option value="gone">Gone (sold or returned)</option>
                  </select>
                </div>
              </div>
              <div className="field" style={{ marginTop: "0.75rem" }}>
                <label>Notes</label>
                <textarea rows={2} {...text("notes")} />
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button className="btn" onClick={save} disabled={busy}>
                  {busy ? "Saving..." : "Save van"}
                </button>
                <button className="btn btn-secondary" onClick={() => setEditing(null)} disabled={busy}>
                  Cancel
                </button>
                {editing !== "new" && (
                  <button className="btn btn-secondary" onClick={remove} disabled={busy}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, flex: "1 1 auto" }}>Vans</h2>
              <input style={{ maxWidth: 220 }} placeholder="Search reg, model, driver, lender" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select style={{ maxWidth: 150 }} value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
                <option value="active">On the road</option>
                <option value="gone">Gone</option>
                <option value="all">All</option>
              </select>
              <button
                className="btn"
                onClick={() => {
                  setEditing("new");
                  setForm(BLANK);
                  setMessage(null);
                }}
              >
                Add a van
              </button>
            </div>
            {visible.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)" }}>{vans.length === 0 ? "No vans yet. Import the van list above, or add a van." : "No vans match."}</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Van</th>
                      <th>Driver</th>
                      <th>Lender</th>
                      <th style={{ textAlign: "right" }}>Value</th>
                      <th style={{ textAlign: "right" }}>Owed</th>
                      <th style={{ textAlign: "right" }}>Equity</th>
                      <th style={{ textAlign: "right" }}>Monthly</th>
                      {DUE_KINDS.map((k) => (
                        <th key={k}>{DUE_LABEL[k]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((v) => (
                      <tr key={v.id} style={{ cursor: "pointer", opacity: v.status === "gone" ? 0.6 : 1 }} onClick={() => open(v)}>
                        <td>
                          <strong>{v.reg}</strong>
                          <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{v.model ?? ""}</div>
                        </td>
                        <td>{v.driver ?? "—"}</td>
                        <td>{v.lender ?? "—"}</td>
                        <td style={{ textAlign: "right" }}>{euro(v.value_eur)}</td>
                        <td style={{ textAlign: "right" }}>{euro(v.settlement_eur)}</td>
                        <td style={{ textAlign: "right" }}>{euro(equityOf(v))}</td>
                        <td style={{ textAlign: "right" }}>{euro(v.monthly_eur)}</td>
                        {DUE_KINDS.map((k) => (
                          <td key={k}>
                            <DueCell van={v} kind={k} today={today} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
