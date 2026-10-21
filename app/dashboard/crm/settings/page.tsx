"use client";

import { useState } from "react";
import { api } from "../api";
import AiSettings from "../ai-settings";
import { useCrm } from "../crm-context";
import WhatsappSettings from "../whatsapp-settings";

type Item = { id: string; name: string; active: boolean; sort_order: number; kind?: string };

function List({ kind, title, help, items, reload }: { kind: "category" | "stage"; title: string; help: string; items: Item[]; reload: () => Promise<void> }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    const res = await api("/api/crm/settings", { method: "POST", body: { kind, ...body } });
    setBusy(null);
    if (!res.ok) return setError(res.body.error || "Could not save");
    await reload();
    return true;
  }

  async function swap(i: number, dir: -1 | 1) {
    const a = items[i];
    const b = items[i + dir];
    if (!b) return;
    // Two neighbours trade places by trading their order numbers.
    const first = await save({ id: a.id, sort_order: b.sort_order }, a.id);
    if (first) await save({ id: b.id, sort_order: a.sort_order }, b.id);
  }

  return (
    <div className="card">
      <h2>{title}</h2>
      <p style={{ margin: "0 0 1rem", fontSize: "0.85rem", color: "var(--muted)" }}>{help}</p>
      {items.map((it, i) => {
        const protectedStage = kind === "stage" && it.kind !== "open";
        const edited = names[it.id] !== undefined && names[it.id].trim() !== it.name;
        return (
          <div key={it.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.5rem", opacity: it.active ? 1 : 0.6 }}>
            <input style={{ flex: "1 1 200px", maxWidth: 320 }} value={names[it.id] ?? it.name} maxLength={80} onChange={(e) => setNames({ ...names, [it.id]: e.target.value })} aria-label={`${title} name`} />
            <button className="btn btn-secondary" style={{ padding: "0.4rem 0.7rem", fontSize: "0.8rem" }} disabled={!edited || busy === it.id} onClick={() => save({ id: it.id, name: names[it.id] }, it.id).then(() => setNames(({ [it.id]: _gone, ...rest }) => rest))}>
              Rename
            </button>
            <label style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center", fontSize: "0.82rem" }} title={protectedStage ? "Needed to close a deal, so it cannot be switched off" : undefined}>
              <input type="checkbox" checked={it.active} disabled={protectedStage || busy === it.id} onChange={(e) => save({ id: it.id, active: e.target.checked }, it.id)} />
              In use
            </label>
            {kind === "stage" && protectedStage && <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>closes a deal</span>}
            <button className="btn btn-secondary" style={{ padding: "0.3rem 0.55rem", fontSize: "0.8rem" }} disabled={i === 0 || !!busy} onClick={() => swap(i, -1)} aria-label="Move up">
              ↑
            </button>
            <button className="btn btn-secondary" style={{ padding: "0.3rem 0.55rem", fontSize: "0.8rem" }} disabled={i === items.length - 1 || !!busy} onClick={() => swap(i, 1)} aria-label="Move down">
              ↓
            </button>
          </div>
        );
      })}

      <form
        style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          if (await save({ name: newName }, "new")) setNewName("");
        }}
      >
        <input style={{ flex: "1 1 200px", maxWidth: 320 }} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={kind === "category" ? "New category" : "New stage"} maxLength={80} />
        <button className="btn" type="submit" disabled={busy === "new" || !newName.trim()}>
          Add
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export default function CrmSettingsPage() {
  const { meta, reload } = useCrm();
  if (!meta) return null;
  if (meta.role !== "Admin") return <div className="card">Only an Admin can change the CRM's categories and stages.</div>;

  return (
    <>
      <List
        kind="category"
        title="Customer categories"
        help="Rename them, switch ones off that you no longer use (companies keep their category), or add new ones. No code change is needed."
        items={meta.categories}
        reload={reload}
      />
      <List
        kind="stage"
        title="Pipeline stages"
        help="Rename or reorder the stages, or add your own. Won, Lost and Not Suitable close a deal, so they stay but can be renamed. New stages go before Won."
        items={meta.stages}
        reload={reload}
      />
      <AiSettings />
      <WhatsappSettings />
    </>
  );
}
