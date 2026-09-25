"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ENTRY_TYPE_LABELS, type KnowledgeEntry } from "./entry-types";

export default function HealthTab() {
  const supabase = createClient();
  const [entries, setEntries] = useState<KnowledgeEntry[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("knowledge_entries").select("*").order("updated_at", { ascending: false });
    setEntries((data || []) as KnowledgeEntry[]);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (!entries) {
    return <p style={{ color: "var(--muted)" }}>Loading...</p>;
  }

  const today = new Date().toISOString().slice(0, 10);
  const overdue = entries.filter((e) => e.review_date && e.review_date < today);
  const needsReview = entries.filter((e) => e.status === "review");
  const missingOwner = entries.filter((e) => !e.owner_name);
  const missingSource = entries.filter((e) => !e.source);
  const outdated = entries.filter((e) => e.status === "outdated");

  function Row({ e, note }: { e: KnowledgeEntry; note: string }) {
    return (
      <div style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)", fontSize: "0.9rem" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{ENTRY_TYPE_LABELS[e.entry_type]}</span>
        <div>{e.title}</div>
        <div style={{ fontSize: "0.8rem", color: "#b98900" }}>{note}</div>
      </div>
    );
  }

  const sections = [
    { title: "Overdue for review", rows: overdue, note: (e: KnowledgeEntry) => `Review date was ${e.review_date}.` },
    { title: "Marked as outdated", rows: outdated, note: () => "Marked outdated — verify or archive." },
    { title: "Awaiting review", rows: needsReview, note: () => "Status is \"review\" — hasn't been verified yet." },
    { title: "No owner assigned", rows: missingOwner, note: () => "Nobody is listed as responsible for this." },
    { title: "No source recorded", rows: missingSource, note: () => "Where this came from isn't recorded." },
  ];

  const totalIssues = sections.reduce((sum, s) => sum + s.rows.length, 0);

  return (
    <>
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <h2>Knowledge Health</h2>
        <p style={{ color: "var(--muted)" }}>
          {totalIssues === 0
            ? "No issues detected — everything has an owner, a source, and is up to date."
            : `${totalIssues} item${totalIssues === 1 ? "" : "s"} flagged across ${sections.filter((s) => s.rows.length > 0).length} categories.`}
        </p>
      </div>

      {sections
        .filter((s) => s.rows.length > 0)
        .map((s) => (
          <div key={s.title} className="card" style={{ marginBottom: "1rem" }}>
            <h2>
              {s.title} ({s.rows.length})
            </h2>
            {s.rows.slice(0, 10).map((e) => (
              <Row key={e.id} e={e} note={s.note(e)} />
            ))}
            {s.rows.length > 10 && (
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.5rem" }}>+{s.rows.length - 10} more.</p>
            )}
          </div>
        ))}
    </>
  );
}
