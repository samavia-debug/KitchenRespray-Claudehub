"use client";

import { useCallback, useEffect, useState } from "react";
import { dublinToday } from "@/lib/crm/followups";
import type { CountRow } from "@/lib/crm/reports";
import type { SpecialResult } from "@/lib/crm/specials-service";
import { describeDates, specialStatus } from "@/lib/crm/specials";
import { LEINSTER_COUNTIES } from "@/lib/crm/territories";
import type { Special, SpecialStatus } from "@/lib/crm/types";
import { api } from "./api";
import { useCrm } from "./crm-context";
import { fmtDate, fmtMoney } from "./fmt";

/** Every special, and (for Admin and Manager) what happened while each one ran. */
export function useSpecials(withResults: boolean) {
  const [specials, setSpecials] = useState<Special[]>([]);
  const [results, setResults] = useState<Record<string, SpecialResult>>({});
  const [today, setToday] = useState(dublinToday());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const res = await api(`/api/crm/specials${withResults ? "?results=1" : ""}`);
    setLoaded(true);
    if (!res.ok) return setError(res.body.error || "Could not load the specials");
    setError(null);
    setSpecials(res.body.specials);
    setResults(res.body.results ?? {});
    setToday(res.body.today ?? dublinToday());
  }, [withResults]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { specials, results, today, error, loaded, reload };
}

const BADGE: Record<SpecialStatus, { label: string; bg: string; fg: string }> = {
  running: { label: "Running", bg: "var(--healthy-soft)", fg: "var(--healthy)" },
  upcoming: { label: "Upcoming", bg: "var(--attention-soft)", fg: "var(--attention)" },
  ended: { label: "Ended", bg: "var(--offline-soft)", fg: "var(--offline)" },
  off: { label: "Switched off", bg: "var(--offline-soft)", fg: "var(--offline)" },
};

function Badge({ status }: { status: SpecialStatus }) {
  const b = BADGE[status];
  return <span style={{ background: b.bg, color: b.fg, borderRadius: 999, padding: "0.1rem 0.55rem", fontSize: "0.72rem", fontWeight: 600 }}>{b.label}</span>;
}

type Draft = { id: string | null; title: string; county: string; offer: string; code: string; starts_on: string; ends_on: string; active: boolean };

const blank = (): Draft => ({ id: null, title: "", county: "", offer: "", code: "", starts_on: dublinToday(), ends_on: "", active: true });
const draftOf = (s: Special): Draft => ({ id: s.id, title: s.title, county: s.county ?? "", offer: s.offer, code: s.code ?? "", starts_on: s.starts_on, ends_on: s.ends_on ?? "", active: s.active });

function SpecialDialog({ initial, onClose, onSaved }: { initial: Draft; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setV((d) => ({ ...d, ...patch }));

  async function save() {
    setBusy(true);
    setError(null);
    const body = { title: v.title, offer: v.offer, code: v.code, county: v.county || null, starts_on: v.starts_on, ends_on: v.ends_on || null, active: v.active };
    const res = await api(v.id ? `/api/crm/specials/${v.id}` : "/api/crm/specials", { method: v.id ? "PATCH" : "POST", body });
    setBusy(false);
    if (!res.ok) return setError(res.body.error || "Could not save the special");
    onSaved();
  }

  return (
    <div className="crm-modal" role="dialog" aria-modal="true" aria-label={v.id ? "Edit special" : "Add special"}>
      <div style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <h2 style={{ marginTop: 0 }}>{v.id ? "Edit special" : "Add a special"}</h2>

        <div className="field">
          <label>Title</label>
          <input value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} placeholder="e.g. Kilkenny spring offer" autoFocus />
        </div>
        <div className="field">
          <label>Where it applies</label>
          <select value={v.county} onChange={(e) => set({ county: e.target.value })}>
            <option value="">All counties</option>
            {LEINSTER_COUNTIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>The offer, exactly as it should be told to people</label>
          <textarea rows={4} value={v.offer} onChange={(e) => set({ offer: e.target.value })} maxLength={1000} placeholder="e.g. 15% off kitchen doors sprayed in March" />
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>The message drafter uses this wording and nothing else, so put the percentage, price or conditions here.</div>
        </div>
        <div className="field">
          <label>Code (optional)</label>
          <input value={v.code} onChange={(e) => set({ code: e.target.value })} maxLength={40} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div className="field">
            <label>Starts</label>
            <input type="date" value={v.starts_on} onChange={(e) => set({ starts_on: e.target.value })} />
          </div>
          <div className="field">
            <label>Last day (optional)</label>
            <input type="date" value={v.ends_on} min={v.starts_on || undefined} onChange={(e) => set({ ends_on: e.target.value })} />
          </div>
        </div>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.9rem", margin: "0.25rem 0 1rem" }}>
          <input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} style={{ width: "auto" }} />
          Switched on (untick to withdraw it early)
        </label>

        {error && <p className="error-text" style={{ marginTop: 0 }}>{error}</p>}
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultTable({ result }: { result: SpecialResult }) {
  const rows: [string, (c: CountRow) => string][] = [
    ["Contacts made", (c) => String(c.contactsMade)],
    ["Companies contacted", (c) => String(c.contacted)],
    ["Opportunities", (c) => String(c.opportunities)],
    ["Won", (c) => String(c.won)],
    ["Confirmed sales", (c) => (c.wonValue ? fmtMoney(c.wonValue) : "—")],
  ];
  return (
    <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th></th>
            <th>
              During
              <div style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: "0.72rem" }}>
                {fmtDate(result.during.from)} to {fmtDate(result.during.to)}
              </div>
            </th>
            <th>
              Before
              <div style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, fontSize: "0.72rem" }}>
                {fmtDate(result.before.from)} to {fmtDate(result.before.to)}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get]) => (
            <tr key={label} style={{ cursor: "default" }}>
              <td>{label}</td>
              <td style={{ fontWeight: 600 }}>{get(result.during.counts)}</td>
              <td>{get(result.before.counts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: "0.4rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
        The same number of days ({result.days}) on each side. This shows what happened alongside the special, not that the special caused it.
      </p>
    </div>
  );
}

/** The specials: what is running, what is coming, what has finished, and (for Admin and Manager) how each one went. */
export default function SpecialsSection({ specials, results, today, reload, canEdit }: { specials: Special[]; results: Record<string, SpecialResult>; today: string; reload: () => void; canEdit: boolean }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const status = (s: Special) => specialStatus(s, today);
  const groups: { title: string; items: Special[] }[] = [
    { title: "Running now", items: specials.filter((s) => status(s) === "running") },
    { title: "Upcoming", items: specials.filter((s) => status(s) === "upcoming").sort((a, b) => (a.starts_on < b.starts_on ? -1 : 1)) },
    { title: "Ended or switched off", items: specials.filter((s) => ["ended", "off"].includes(status(s))) },
  ];

  async function toggle(s: Special) {
    setBusyId(s.id);
    setMessage(null);
    const res = await api(`/api/crm/specials/${s.id}`, { method: "PATCH", body: { active: !s.active } });
    setBusyId(null);
    if (!res.ok) return setMessage(res.body.error || "Could not change the special");
    reload();
  }

  async function remove(s: Special) {
    if (!window.confirm(`Delete "${s.title}"? Its results disappear with it. To keep them, switch it off instead.`)) return;
    setBusyId(s.id);
    setMessage(null);
    const res = await api(`/api/crm/specials/${s.id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) return setMessage(res.body.error || "Could not delete the special");
    reload();
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Specials</h2>
        {canEdit && (
          <button className="btn" onClick={() => setEditing(blank())}>
            + Add special
          </button>
        )}
      </div>
      <p style={{ margin: "0 0 0.9rem", fontSize: "0.88rem", color: "var(--muted)" }}>
        Offers that differ by county and by time. People see the specials running where a company is, and the message drafter uses their wording.
        {canEdit ? " Results show what happened in the county while each ran, next to the same number of days before." : ""}
      </p>
      {message && <p className="error-text">{message}</p>}

      {specials.length === 0 && <p style={{ color: "var(--muted)", margin: 0 }}>No specials yet.{canEdit ? " Add one to start." : ""}</p>}

      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.title} style={{ marginBottom: "1rem" }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>{g.title}</h3>
            {g.items.map((s) => {
              const result = results[s.id];
              return (
                <div key={s.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "0.8rem 0.95rem", marginBottom: "0.6rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{s.title}</strong>
                      <Badge status={status(s)} />
                      <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>{s.county ?? "All counties"}</span>
                    </div>
                    <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
                      {fmtDate(s.starts_on)}
                      {s.ends_on ? ` to ${fmtDate(s.ends_on)}` : " onwards"}
                    </span>
                  </div>
                  <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{s.offer}</p>
                  {s.code && (
                    <p style={{ margin: "0.3rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
                      Code: <strong>{s.code}</strong>
                    </p>
                  )}
                  {canEdit && (
                    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
                      <button className="btn btn-secondary" style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }} onClick={() => setEditing(draftOf(s))}>
                        Edit
                      </button>
                      <button className="btn btn-secondary" style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }} disabled={busyId === s.id} onClick={() => toggle(s)}>
                        {s.active ? "Switch off" : "Switch on"}
                      </button>
                      <button className="btn btn-secondary" style={{ padding: "0.3rem 0.65rem", fontSize: "0.8rem" }} disabled={busyId === s.id} onClick={() => remove(s)}>
                        Delete
                      </button>
                    </div>
                  )}
                  {canEdit && result && <ResultTable result={result} />}
                </div>
              );
            })}
          </div>
        ))}

      {editing && (
        <SpecialDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** On a company's page: the specials running in its county, so whoever contacts it knows what is on offer. Nothing shows when there is none. */
export function CompanySpecials({ county }: { county: string | null }) {
  const { meta } = useCrm();
  const today = dublinToday();
  const [items, setItems] = useState<Special[]>([]);

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    api(`/api/crm/specials?running=1&county=${encodeURIComponent(county ?? "")}`).then((res) => {
      if (!cancelled && res.ok) setItems(res.body.specials);
    });
    return () => {
      cancelled = true;
    };
  }, [county, meta]);

  if (items.length === 0) return null;
  return (
    <div className="card" style={{ borderColor: "var(--accent)" }}>
      <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>{items.length === 1 ? "Special running" : "Specials running"}{county ? ` in ${county}` : ""}</h2>
      {items.map((s) => (
        <div key={s.id} style={{ marginBottom: "0.5rem" }}>
          <strong>{s.title}</strong>
          {s.county === null && <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}> (all counties)</span>}
          <div style={{ fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{s.offer}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            {s.code ? `Code ${s.code} · ` : ""}
            {describeDates(s, today, fmtDate)}
          </div>
        </div>
      ))}
    </div>
  );
}
