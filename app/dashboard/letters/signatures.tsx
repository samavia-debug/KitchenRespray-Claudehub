"use client";

import { useCallback, useEffect, useState } from "react";
import type { Signer } from "@/lib/letters/signers";
import SignaturePad from "./signature-pad";
import { prepareSignatureFile } from "./signature-image";

type Form = { name: string; title: string; is_default: boolean; active: boolean };
const BLANK: Form = { name: "", title: "", is_default: false, active: true };

/** The people who sign letters: a typed name and job title, and a picture of their signature, drawn or from a photo or scan. */
export default function Signatures({ onChanged, refreshKey }: { onChanged: () => void; refreshKey: number }) {
  const [signers, setSigners] = useState<Signer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  /** The picture to save: a new one (a data URL), `null` to remove the one there is, `undefined` to leave it. */
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [hasImage, setHasImage] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imgKey, setImgKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/letters/signers");
      const body = await res.json();
      if (!res.ok) setError(body.error || "Could not load the signers");
      else {
        setError(null);
        setSigners(body.signers);
      }
    } catch (e: any) {
      setError(e.message || "Network error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);

  function open(s: Signer) {
    setEditing(s.id);
    setForm({ name: s.name, title: s.title ?? "", is_default: s.is_default, active: s.active });
    setPending(undefined);
    setHasImage(s.has_image);
    setDrawing(false);
    setMessage(null);
  }

  function startNew() {
    setEditing("new");
    setForm({ ...BLANK, is_default: (signers || []).length === 0 });
    setPending(undefined);
    setHasImage(false);
    setDrawing(false);
    setMessage(null);
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    try {
      setPending(await prepareSignatureFile(file));
      setDrawing(false);
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(editing && editing !== "new" ? `/api/letters/signers/${editing}` : "/api/letters/signers", {
        method: editing && editing !== "new" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...(pending !== undefined ? { image: pending } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) setMessage(`Error: ${body.error}`);
      else {
        setEditing(null);
        setImgKey((k) => k + 1);
        setMessage(`${form.name} saved.`);
        await load();
        onChanged();
      }
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
    setBusy(false);
  }

  async function remove() {
    if (!editing || editing === "new" || !window.confirm(`Delete ${form.name}? Letters that used them keep the typed name but lose the signature picture.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/letters/signers/${editing}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) setMessage(`Error: ${body.error}`);
      else {
        setEditing(null);
        setMessage("Signer deleted.");
        await load();
        onChanged();
      }
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
    setBusy(false);
  }

  const showing = pending === undefined ? (hasImage && editing && editing !== "new" ? `/api/letters/signers/${editing}/image?v=${imgKey}` : null) : pending;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.25rem", alignItems: "start" }}>
      <div className="card">
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0, flex: "1 1 auto" }}>Signers</h2>
          <button className="btn" onClick={startNew}>
            Add a signer
          </button>
        </div>
        {tableMissing && <p className="error-text">The signers table is not set up yet. Run the letter signers migration in Supabase, then reload.</p>}
        {error && !tableMissing && <p className="error-text">{error}</p>}
        {!signers && !error && <p style={{ color: "var(--muted)" }}>Loading...</p>}
        {signers && signers.length === 0 && <p style={{ margin: 0, color: "var(--muted)" }}>No signers yet. Letters use the typed name from the Letterhead tab until you add one.</p>}
        {(signers || []).map((s) => (
          <button
            key={s.id}
            type="button"
            className="btn btn-secondary"
            onClick={() => open(s)}
            style={{ display: "block", width: "100%", textAlign: "left", marginBottom: "0.4rem", opacity: s.active ? 1 : 0.6, outline: editing === s.id ? "2px solid var(--accent, #c9792b)" : undefined }}
          >
            <strong>{s.name}</strong>
            {s.is_default && <span style={{ marginLeft: "0.5rem", fontSize: "0.72rem", color: "#2e7d32" }}>default</span>}
            {!s.active && <span style={{ marginLeft: "0.5rem", fontSize: "0.72rem", color: "var(--muted)" }}>not in use</span>}
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              {s.title || "No job title"} · {s.has_image ? "signature picture saved" : "typed name only"}
            </div>
          </button>
        ))}
      </div>

      <div className="card">
        {message && <p style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", color: message.startsWith("Error") ? "#b3261e" : undefined }}>{message}</p>}
        {!editing && <p style={{ margin: 0, color: "var(--muted)" }}>Choose a signer to change them, or add one. When you write a letter you pick who signs it, and their typed name and job title go under the closing.</p>}
        {editing && (
          <>
            <h2 style={{ marginTop: 0 }}>{editing === "new" ? "Add a signer" : `Edit ${form.name}`}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Job title</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Director" />
              </div>
            </div>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", margin: "0.75rem 0 0.25rem", fontSize: "0.9rem" }}>
              <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
              The usual signer (chosen for new letters)
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Can be chosen for letters
            </label>

            <h3 style={{ marginBottom: "0.25rem" }}>Signature picture</h3>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
              Only add someone&apos;s signature with their permission. It is never shown on a draft: a letter shows it once it is finalised (once approved, for a warning or a reference). Without a picture the letter has room to sign by hand above the typed name.
            </p>
            {showing ? (
              <div style={{ margin: "0 0 0.5rem", padding: "0.5rem", border: "1px solid var(--border, #ddd)", borderRadius: 6, background: "#fff", display: "inline-block" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={showing} alt="The signature" style={{ display: "block", maxHeight: 90, maxWidth: "100%" }} />
              </div>
            ) : (
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>No picture yet.</p>
            )}
            {pending && <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "#7a4a00" }}>New picture chosen. It is saved when you press Save signer.</p>}
            {pending === null && <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "#7a4a00" }}>The picture will be removed when you press Save signer.</p>}

            {drawing ? (
              <SignaturePad
                onCancel={() => setDrawing(false)}
                onUse={(url) => {
                  setPending(url);
                  setDrawing(false);
                }}
              />
            ) : (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setDrawing(true)}>
                  Draw it
                </button>
                <label className="btn btn-secondary" style={{ cursor: "pointer", margin: 0 }}>
                  Upload a photo or scan
                  <input type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {(showing || hasImage) && pending !== null && (
                  <button type="button" className="btn btn-secondary" onClick={() => setPending(null)}>
                    Remove the picture
                  </button>
                )}
              </div>
            )}
            <p style={{ margin: "0.5rem 0 1rem", fontSize: "0.75rem", color: "var(--muted)" }}>For a photo or scan, sign in dark ink on plain white paper. The paper is made clear and the picture is trimmed to the signature.</p>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="btn" onClick={save} disabled={busy || !form.name.trim()}>
                {busy ? "Saving..." : "Save signer"}
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
          </>
        )}
      </div>
    </div>
  );
}
