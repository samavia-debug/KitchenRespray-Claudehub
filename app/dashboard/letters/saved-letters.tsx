"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LETTER_TYPE_BY_KEY, LETTER_STATUSES, STATUS_LABEL } from "@/lib/letters/config";
import { formatLongDate } from "@/lib/letters/facts";
import type { LetterRow } from "@/lib/letters/service";

const STATUS_COLOR: Record<string, string> = { draft: "#6f6a63", finalised: "#97690a", approved: "#2e7d32" };

export default function SavedLetters({ onOpen, refreshKey }: { onOpen: (id: string) => void; refreshKey: number }) {
  const [letters, setLetters] = useState<Partial<LetterRow>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/letters");
      const body = await res.json();
      if (!res.ok) setError(body.error || "Could not load letters");
      else {
        setError(null);
        setLetters(body.letters);
      }
    } catch (e: any) {
      setError(e.message || "Network error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (letters || []).filter(
      (l) => (!status || l.status === status) && (!q || `${l.technician_name} ${l.subject} ${LETTER_TYPE_BY_KEY[l.letter_type as string]?.label ?? ""}`.toLowerCase().includes(q))
    );
  }, [letters, status, search]);

  async function duplicate(id: string) {
    setBusy(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/letters/${id}/duplicate`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) setMessage(`Error: ${body.error}`);
      else onOpen(body.id);
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
    setBusy(null);
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    setBusy(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/letters/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) setMessage(`Error: ${body.error}`);
      else await load();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    }
    setBusy(null);
  }

  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);

  return (
    <div className="card">
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, flex: "1 1 auto" }}>Saved letters</h2>
        <input style={{ maxWidth: 220 }} placeholder="Search name or subject" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={{ maxWidth: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {LETTER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {tableMissing && <p className="error-text">The letters tables are not set up yet. Run the letters migration in Supabase, then reload.</p>}
      {error && !tableMissing && <p className="error-text">{error}</p>}
      {message && <p style={{ fontSize: "0.85rem" }}>{message}</p>}
      {!letters && !error && <p style={{ color: "var(--muted)" }}>Loading...</p>}
      {letters && visible.length === 0 && <p style={{ color: "var(--muted)", margin: 0 }}>{letters.length === 0 ? "No letters saved yet." : "No letters match."}</p>}

      {visible.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>For</th>
                <th>Letter</th>
                <th>Date</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.technician_name}</strong>
                    {l.technician_former && <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>former employee</div>}
                  </td>
                  <td>
                    {LETTER_TYPE_BY_KEY[l.letter_type as string]?.label ?? l.letter_type}
                    <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{l.subject || "No subject yet"}</div>
                  </td>
                  <td>{l.letter_date ? formatLongDate(l.letter_date) : "—"}</td>
                  <td style={{ color: STATUS_COLOR[l.status as string], fontWeight: 600 }}>{STATUS_LABEL[l.status as keyof typeof STATUS_LABEL] ?? l.status}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-secondary" onClick={() => onOpen(l.id as string)}>
                      Open
                    </button>{" "}
                    <button className="btn btn-secondary" disabled={busy === l.id} onClick={() => duplicate(l.id as string)}>
                      Duplicate
                    </button>
                    {l.status === "draft" && (
                      <>
                        {" "}
                        <button className="btn btn-secondary" disabled={busy === l.id} onClick={() => remove(l.id as string)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
