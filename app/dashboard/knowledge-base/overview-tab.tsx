"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ENTRY_TYPES, ENTRY_TYPE_LABELS, type EntryType, type KnowledgeEntry } from "./entry-types";

const SNAPSHOT_TYPES: EntryType[] = ["brand", "service", "person", "sop", "decision", "document"];

export default function OverviewTab({
  onQuickAdd,
  onGoToAsk,
}: {
  onQuickAdd: (type: EntryType) => void;
  onGoToAsk: () => void;
}) {
  const supabase = createClient();
  const [entries, setEntries] = useState<KnowledgeEntry[] | null>(null);
  const [documentCount, setDocumentCount] = useState(0);

  const load = useCallback(async () => {
    const [{ data }, { count }] = await Promise.all([
      supabase.from("knowledge_entries").select("*").order("updated_at", { ascending: false }),
      supabase.from("knowledge_documents").select("id", { count: "exact", head: true }),
    ]);
    setEntries((data || []) as KnowledgeEntry[]);
    setDocumentCount(count || 0);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (!entries) {
    return <p style={{ color: "var(--muted)" }}>Loading...</p>;
  }

  const countByType = new Map<EntryType, number>();
  ENTRY_TYPES.forEach((t) => countByType.set(t, 0));
  entries.forEach((e) => countByType.set(e.entry_type, (countByType.get(e.entry_type) || 0) + 1));

  const gaps = SNAPSHOT_TYPES.filter((t) => (countByType.get(t) || 0) === 0);
  const recentlyUpdated = entries.slice(0, 5);
  const recentDecisions = entries.filter((e) => e.entry_type === "decision").slice(0, 5);

  return (
    <>
      <div className="card" style={{ marginBottom: "1.25rem", textAlign: "center", padding: "2rem" }}>
        <h2 style={{ marginTop: 0 }}>🧠 Ask the Business Brain</h2>
        <p style={{ color: "var(--muted)", marginBottom: "1.25rem" }}>
          Ask a question in plain English — Claude will answer using everything recorded here, with sources.
        </p>
        <button className="btn" onClick={onGoToAsk}>
          Ask a question
        </button>
      </div>

      <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
        <div className="stat-card">
          <div className="stat-value">{entries.length}</div>
          <div className="stat-label">Total knowledge items</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{documentCount}</div>
          <div className="stat-label">Documents</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{countByType.get("sop") || 0}</div>
          <div className="stat-label">SOPs</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{countByType.get("decision") || 0}</div>
          <div className="stat-label">Decisions</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: "1.25rem" }}>
        <div className="card">
          <h2>Recently updated</h2>
          {recentlyUpdated.length > 0 ? (
            recentlyUpdated.map((e) => (
              <div key={e.id} style={{ padding: "0.4rem 0", borderBottom: "1px solid var(--border)", fontSize: "0.9rem" }}>
                <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>{ENTRY_TYPE_LABELS[e.entry_type]}</span>
                <div>{e.title}</div>
              </div>
            ))
          ) : (
            <p style={{ color: "var(--muted)" }}>Nothing recorded yet.</p>
          )}
        </div>

        <div className="card">
          <h2>Recent decisions</h2>
          {recentDecisions.length > 0 ? (
            recentDecisions.map((e) => (
              <div key={e.id} style={{ padding: "0.4rem 0", borderBottom: "1px solid var(--border)", fontSize: "0.9rem" }}>
                <div style={{ fontWeight: 600 }}>{e.title}</div>
                <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{new Date(e.created_at).toLocaleDateString()}</div>
              </div>
            ))
          ) : (
            <p style={{ color: "var(--muted)" }}>No decisions recorded yet.</p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <h2>Knowledge gaps</h2>
        {gaps.length > 0 ? (
          <p style={{ fontSize: "0.9rem" }}>
            No entries yet for:{" "}
            {gaps.map((t, i) => (
              <span key={t}>
                <strong>{ENTRY_TYPE_LABELS[t]}</strong>
                {i < gaps.length - 1 ? ", " : ""}
              </span>
            ))}
            .
          </p>
        ) : (
          <p style={{ color: "var(--muted)" }}>The core knowledge types all have at least one entry.</p>
        )}
      </div>

      <div className="card">
        <h2>Quick add</h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(["decision", "sop", "person", "brand", "service", "faq"] as EntryType[]).map((t) => (
            <button key={t} className="btn-secondary btn" style={{ fontSize: "0.85rem" }} onClick={() => onQuickAdd(t)}>
              + {ENTRY_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
