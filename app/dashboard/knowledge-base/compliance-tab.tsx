"use client";

import { useCallback, useEffect, useState } from "react";
import {
  describeDays,
  HOLDER_LABEL,
  HOLDER_TYPES,
  KIND_LABEL,
  KINDS,
  levelOf,
  type ComplianceItem,
  type ComplianceKind,
  type ComplianceSummary,
  type Gaps,
  type HolderType,
  type Level,
} from "@/lib/compliance/summary";
import { formatDate } from "@/lib/connecteam/vehicles-summary";

type Payload = {
  items: ComplianceItem[];
  summary: ComplianceSummary;
  gaps: Gaps;
  vehicleCount: number;
  driverCount: number;
  unscannedDocuments: number;
};

type Draft = {
  title: string;
  kind: ComplianceKind;
  holder_type: HolderType;
  holder_label: string;
  issued_date: string;
  expiry_date: string;
  notes: string;
};

const EMPTY: Draft = { title: "", kind: "licence", holder_type: "person", holder_label: "", issued_date: "", expiry_date: "", notes: "" };

const COLOR: Record<Level, string | undefined> = { expired: "#b3261e", urgent: "#b3261e", soon: "#b98900", watch: undefined, ok: undefined };

const toDraft = (i: ComplianceItem): Draft => ({
  title: i.title,
  kind: i.kind,
  holder_type: i.holder_type,
  holder_label: i.holder_label ?? "",
  issued_date: i.issued_date ?? "",
  expiry_date: i.expiry_date ?? "",
  notes: i.notes ?? "",
});

function ItemForm({ initial, submitLabel, busy, onSubmit, onCancel }: { initial: Draft; submitLabel: string; busy: boolean; onSubmit: (d: Draft) => void; onCancel?: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((prev) => ({ ...prev, [key]: value }));
  const company = d.holder_type === "company";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(d);
      }}
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.75rem", alignItems: "end" }}
    >
      <div className="field" style={{ margin: 0 }}>
        <label>Name</label>
        <input value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="Driving licence" required />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>Type</label>
        <select value={d.kind} onChange={(e) => set("kind", e.target.value as ComplianceKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>Belongs to</label>
        <select value={d.holder_type} onChange={(e) => set("holder_type", e.target.value as HolderType)}>
          {HOLDER_TYPES.map((h) => (
            <option key={h} value={h}>
              {HOLDER_LABEL[h]}
            </option>
          ))}
        </select>
      </div>
      {!company && (
        <div className="field" style={{ margin: 0 }}>
          <label>{d.holder_type === "person" ? "Person's name" : "Registration"}</label>
          <input value={d.holder_label} onChange={(e) => set("holder_label", e.target.value)} placeholder={d.holder_type === "person" ? "Sean O'Brien" : "191-D-12345"} required />
        </div>
      )}
      <div className="field" style={{ margin: 0 }}>
        <label>Issued (optional)</label>
        <input type="date" value={d.issued_date} onChange={(e) => set("issued_date", e.target.value)} />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>Expires</label>
        <input type="date" value={d.expiry_date} onChange={(e) => set("expiry_date", e.target.value)} required />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>Note (optional)</label>
        <input value={d.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving..." : submitLabel}
        </button>
        {onCancel && (
          <button className="btn btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// What the API takes: blank optional fields are sent as null so an edit can clear them.
const body = (d: Draft) => ({
  title: d.title,
  kind: d.kind,
  holder_type: d.holder_type,
  holder_label: d.holder_type === "company" ? null : d.holder_label,
  issued_date: d.issued_date || null,
  expiry_date: d.expiry_date,
  notes: d.notes || null,
});

export default function ComplianceTab() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/compliance");
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Could not load the register");
        return;
      }
      setError(null);
      setData(json);
    } catch (err: any) {
      setError(err.message || "Network error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function call(url: string, method: string, payload?: unknown): Promise<boolean> {
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(`Error: ${json.error || "Something went wrong"}`);
        return false;
      }
      return true;
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
      return false;
    }
  }

  async function act(id: string, run: () => Promise<boolean>, done?: string) {
    setBusy(id);
    setMessage(null);
    if (await run()) {
      setEditing(null);
      if (done) setMessage(done);
      await load();
    }
    setBusy(null);
  }

  async function scan() {
    setScanning(true);
    setMessage(null);
    let suggested = 0;
    let read = 0;
    const errors: string[] = [];
    try {
      // A few documents per request keeps each call short; ask again until none are left.
      for (let round = 0; round < 60; round++) {
        const res = await fetch("/api/compliance/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const json = await res.json();
        if (!res.ok) {
          errors.push(json.error || "Scan failed");
          break;
        }
        suggested += json.suggested;
        read += json.scanned;
        errors.push(...json.errors);
        setMessage(`Reading documents... ${read} done, ${json.remaining} to go`);
        if (json.remaining === 0 || json.scanned === 0) break;
      }
    } catch (err: any) {
      errors.push(err.message);
    }
    setMessage(
      `Read ${read} document${read === 1 ? "" : "s"}, found ${suggested} possible item${suggested === 1 ? "" : "s"} to check.${errors.length ? ` Problems: ${errors.slice(0, 3).join("; ")}` : ""}`
    );
    setScanning(false);
    await load();
  }

  const tableMissing = !!error && /does not exist|could not find the table|schema cache|compliance_scanned_at/i.test(error);
  const s = data?.summary;
  const suggested = (data?.items || []).filter((i) => i.status === "suggested");
  const confirmed = s?.dated || [];
  const undated = (data?.items || []).filter((i) => i.status === "confirmed" && !i.expiry_date);
  const g = data?.gaps;
  const gapCount = g ? g.vehiclesWithoutInsurance.length + g.vehiclesWithoutRegistration.length + g.driversWithoutLicence.length : 0;

  return (
    <>
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Compliance register</h2>
            <p style={{ color: "var(--muted)", margin: "0.35rem 0 0", fontSize: "0.9rem" }}>
              Licences, insurance, certificates and anything else that expires. Eleven reads the dates from uploaded documents and suggests them; nothing counts, and
              no warning is sent, until you confirm it.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-secondary" onClick={() => setAdding((a) => !a)} disabled={tableMissing}>
              {adding ? "Close" : "Add one"}
            </button>
            <button className="btn" onClick={scan} disabled={scanning || tableMissing}>
              {scanning ? "Reading..." : data && data.unscannedDocuments > 0 ? `Read ${data.unscannedDocuments} document${data.unscannedDocuments === 1 ? "" : "s"}` : "Check documents"}
            </button>
          </div>
        </div>
        {message && <p style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>{message}</p>}
        {error && (
          <p className="error-text" style={{ margin: "0.6rem 0 0" }}>
            {tableMissing ? "The compliance register isn't set up yet. Run the compliance_items migration in Supabase, then reload." : error}
          </p>
        )}
        {adding && (
          <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
            <ItemForm
              initial={EMPTY}
              submitLabel="Add to register"
              busy={busy === "new"}
              onSubmit={(d) =>
                act("new", async () => {
                  const ok = await call("/api/compliance", "POST", body(d));
                  if (ok) setAdding(false);
                  return ok;
                }, "Added.")
              }
              onCancel={() => setAdding(false)}
            />
          </div>
        )}
      </div>

      {s && data && (
        <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
          <div className="stat-card">
            <div className="stat-value" style={s.expired > 0 ? { color: "#b3261e" } : undefined}>{s.expired}</div>
            <div className="stat-label">Expired</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={s.within7 > 0 ? { color: "#b3261e" } : undefined}>{s.within7}</div>
            <div className="stat-label">Within 7 days</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={s.within30 > 0 ? { color: "#b98900" } : undefined}>{s.within30}</div>
            <div className="stat-label">Within 30 days</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{s.confirmed}</div>
            <div className="stat-label">Items on the register</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={s.suggested > 0 ? { color: "#b98900" } : undefined}>{s.suggested}</div>
            <div className="stat-label">Waiting for you to check</div>
          </div>
        </div>
      )}

      {suggested.length > 0 && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <h2 style={{ marginTop: 0 }}>Eleven found these — please check</h2>
          <p style={{ color: "var(--muted)", margin: "0 0 1rem", fontSize: "0.9rem" }}>
            Compare each date with the wording quoted from the document. A &ldquo;check carefully&rdquo; flag means the quoted words weren&apos;t found exactly as written, or
            something looked odd.
          </p>
          {suggested.map((i) => (
            <div key={i.id} style={{ padding: "0.9rem 0", borderTop: "1px solid var(--border)" }}>
              {editing === i.id ? (
                <ItemForm
                  initial={toDraft(i)}
                  submitLabel="Confirm"
                  busy={busy === i.id}
                  onSubmit={(d) => act(i.id, () => call(`/api/compliance/${i.id}`, "PATCH", { ...body(d), status: "confirmed" }), "Confirmed.")}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 240, flex: 1 }}>
                    <strong>{i.title}</strong>{" "}
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                      {KIND_LABEL[i.kind]} · {i.holder_label || HOLDER_LABEL[i.holder_type]}
                    </span>
                    {i.needs_check && <span style={{ marginLeft: "0.5rem", color: "#b98900", fontSize: "0.8rem", fontWeight: 600 }}>check carefully</span>}
                    <div style={{ marginTop: "0.25rem" }}>
                      Expires <strong>{i.expiry_date ? formatDate(i.expiry_date) : "—"}</strong>
                      {i.issued_date && <span style={{ color: "var(--muted)" }}> · issued {formatDate(i.issued_date)}</span>}
                    </div>
                    {i.evidence && <div style={{ marginTop: "0.25rem", fontSize: "0.82rem", color: "var(--muted)" }}>From the document: &ldquo;{i.evidence}&rdquo;</div>}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                    {!i.needs_check && (
                      <button className="btn" disabled={busy === i.id} onClick={() => act(i.id, () => call(`/api/compliance/${i.id}`, "PATCH", { status: "confirmed" }), "Confirmed.")}>
                        Looks right
                      </button>
                    )}
                    <button className="btn btn-secondary" onClick={() => setEditing(i.id)}>
                      {i.needs_check ? "Check & confirm" : "Edit"}
                    </button>
                    <button className="btn btn-secondary" disabled={busy === i.id} onClick={() => act(i.id, () => call(`/api/compliance/${i.id}`, "PATCH", { status: "dismissed" }), "Dismissed.")}>
                      Not right
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {data && g && (gapCount > 0 || data.vehicleCount > 0) && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <h2 style={{ marginTop: 0 }}>Nothing recorded for</h2>
          {gapCount === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>Every regular van has insurance and registration on the register, and every regular driver has a licence.</p>
          ) : (
            <>
              <p style={{ color: "var(--muted)", margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
                From the vehicle checks: {data.vehicleCount} regular vans and {data.driverCount} regular drivers. This only means nothing is on the register yet, not that
                it doesn&apos;t exist.
              </p>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.9rem" }}>
                {g.vehiclesWithoutInsurance.length > 0 && (
                  <li>
                    <strong>Insurance:</strong> {g.vehiclesWithoutInsurance.join(", ")}
                  </li>
                )}
                {g.vehiclesWithoutRegistration.length > 0 && (
                  <li>
                    <strong>Registration / NCT / tax:</strong> {g.vehiclesWithoutRegistration.join(", ")}
                  </li>
                )}
                {g.driversWithoutLicence.length > 0 && (
                  <li>
                    <strong>Driving licence:</strong> {g.driversWithoutLicence.join(", ")}
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}

      {data && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>On the register</h2>
          {confirmed.length === 0 && undated.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>
              Nothing confirmed yet. Click &ldquo;Check documents&rdquo; to have Eleven read the uploaded documents, or &ldquo;Add one&rdquo; to type one in.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Type</th>
                    <th>Belongs to</th>
                    <th>Expires</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...confirmed, ...undated.map((u) => ({ ...u, days: Infinity }))].map((i) =>
                    editing === i.id ? (
                      <tr key={i.id}>
                        <td colSpan={5}>
                          <ItemForm
                            initial={toDraft(i)}
                            submitLabel="Save"
                            busy={busy === i.id}
                            onSubmit={(d) => act(i.id, () => call(`/api/compliance/${i.id}`, "PATCH", body(d)), "Saved.")}
                            onCancel={() => setEditing(null)}
                          />
                        </td>
                      </tr>
                    ) : (
                      <tr key={i.id}>
                        <td>
                          <strong>{i.title}</strong>
                          {i.notes && <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{i.notes}</div>}
                        </td>
                        <td>{KIND_LABEL[i.kind]}</td>
                        <td>{i.holder_label || HOLDER_LABEL[i.holder_type]}</td>
                        <td>
                          {i.expiry_date ? (
                            <>
                              {formatDate(i.expiry_date)}
                              <div style={{ fontSize: "0.78rem", fontWeight: 600, color: COLOR[levelOf(i.days)] ?? "var(--muted)" }}>{describeDays(i.days)}</div>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button className="btn btn-secondary" onClick={() => setEditing(i.id)}>
                            Edit
                          </button>{" "}
                          <button
                            className="btn btn-secondary"
                            disabled={busy === i.id}
                            onClick={() => {
                              if (window.confirm(`Remove "${i.title}" from the register? Its warnings stop.`)) act(i.id, () => call(`/api/compliance/${i.id}`, "DELETE"), "Removed.");
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "1rem 0 0" }}>
            Warnings go to Slack / WhatsApp once each, at 30, 14 and 7 days before an item expires and again once it has expired (working hours only). Changing a date or
            confirming an item restarts its warnings.
          </p>
        </div>
      )}
      {!data && !error && <p style={{ color: "var(--muted)" }}>Loading...</p>}
    </>
  );
}
