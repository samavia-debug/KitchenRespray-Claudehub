"use client";

import { useState } from "react";

const PRIORITIES = ["critical", "high", "medium", "low"];

export default function AddWebsiteForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("medium");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !domain.trim()) {
      setError("Name and domain are required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/monitoring/websites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, domain, category, priority }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Could not add website");
      } else {
        setName("");
        setDomain("");
        setCategory("");
        setPriority("medium");
        setOpen(false);
        onAdded();
      }
    } catch (err: any) {
      setError(err.message);
    }

    setSaving(false);
  }

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)} style={{ marginBottom: "1.25rem" }}>
        + Add website
      </button>
    );
  }

  return (
    <div className="card">
      <h2>Add website</h2>
      {error && <p className="error-text">{error}</p>}
      <form onSubmit={handleSubmit}>
        <div className="grid-2">
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kitchen Respray" />
          </div>
          <div className="field">
            <label>Domain</label>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="kitchenrespray.com"
            />
          </div>
          <div className="field">
            <label>Category</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Kitchen Respray Services"
            />
          </div>
          <div className="field">
            <label>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.6rem" }}>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Adding..." : "Add website"}
          </button>
          <button
            type="button"
            className="btn-secondary btn"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
