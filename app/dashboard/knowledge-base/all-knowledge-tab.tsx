"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ENTRY_TYPES,
  ENTRY_TYPE_LABELS,
  ENTRY_STATUSES,
  STATUS_COLOR,
  type EntryType,
  type EntryStatus,
  type KnowledgeEntry,
  type WebsiteOption,
} from "./entry-types";

const EMPTY_DRAFT = {
  id: null as string | null,
  entry_type: "company_fact" as EntryType,
  title: "",
  content: "",
  website_id: "",
  tags: "",
  status: "verified" as EntryStatus,
  owner_name: "",
  source: "",
  review_date: "",
};

export default function AllKnowledgeTab({
  initialType,
  initialQuery,
}: {
  initialType?: EntryType;
  initialQuery?: string;
}) {
  const supabase = createClient();

  const [entries, setEntries] = useState<KnowledgeEntry[] | null>(null);
  const [websites, setWebsites] = useState<WebsiteOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [typeFilter, setTypeFilter] = useState<EntryType | "all">(initialType || "all");
  const [siteFilter, setSiteFilter] = useState<string>("all"); // "all" | "company" | website_id
  const [statusFilter, setStatusFilter] = useState<EntryStatus | "all">("all");
  const [queryText, setQueryText] = useState(initialQuery || "");

  const [draft, setDraft] = useState(initialType ? { ...EMPTY_DRAFT, entry_type: initialType } : EMPTY_DRAFT);
  const [showForm, setShowForm] = useState(!!initialType);

  const load = useCallback(async () => {
    setError(null);
    const [{ data: entryData, error: entryError }, { data: websiteData }] = await Promise.all([
      supabase.from("knowledge_entries").select("*").order("updated_at", { ascending: false }),
      supabase.from("websites").select("id, name").order("name", { ascending: true }),
    ]);

    if (entryError) {
      setError(entryError.message);
      return;
    }

    setEntries((entryData || []) as KnowledgeEntry[]);
    setWebsites((websiteData || []) as WebsiteOption[]);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function websiteName(websiteId: string | null): string {
    if (!websiteId) return "Company-wide";
    return websites.find((w) => w.id === websiteId)?.name || "Unknown site";
  }

  function startNew() {
    setDraft(EMPTY_DRAFT);
    setShowForm(true);
    setSavedMessage(null);
  }

  function startEdit(entry: KnowledgeEntry) {
    setDraft({
      id: entry.id,
      entry_type: entry.entry_type,
      title: entry.title,
      content: entry.content,
      website_id: entry.website_id || "",
      tags: (entry.tags || []).join(", "),
      status: entry.status || "verified",
      owner_name: entry.owner_name || "",
      source: entry.source || "",
      review_date: entry.review_date || "",
    });
    setShowForm(true);
    setSavedMessage(null);
  }

  async function saveDraft() {
    if (!draft.title.trim() || !draft.content.trim()) {
      setSavedMessage("Error: title and content are required.");
      return;
    }

    setSaving(true);
    setSavedMessage(null);

    const payload = {
      entry_type: draft.entry_type,
      title: draft.title.trim(),
      content: draft.content.trim(),
      website_id: draft.website_id || null,
      tags: draft.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      status: draft.status,
      owner_name: draft.owner_name.trim() || null,
      source: draft.source.trim() || null,
      review_date: draft.review_date || null,
      updated_at: new Date().toISOString(),
    };

    const { error: saveError } = draft.id
      ? await supabase.from("knowledge_entries").update(payload).eq("id", draft.id)
      : await supabase.from("knowledge_entries").insert(payload);

    setSaving(false);

    if (saveError) {
      setSavedMessage(`Error: ${saveError.message}`);
      return;
    }

    setSavedMessage(draft.id ? "Entry updated." : "Entry added.");
    setShowForm(false);
    setDraft(EMPTY_DRAFT);
    load();
  }

  async function deleteEntry(id: string) {
    if (!confirm("Delete this entry? This can't be undone.")) return;
    const { error: deleteError } = await supabase.from("knowledge_entries").delete().eq("id", id);
    if (deleteError) {
      setSavedMessage(`Error: ${deleteError.message}`);
      return;
    }
    load();
  }

  if (error) {
    return (
      <div className="card">
        <p className="error-text">Failed to load: {error}</p>
      </div>
    );
  }

  if (!entries) {
    return <p style={{ color: "var(--muted)" }}>Loading...</p>;
  }

  const q = queryText.trim().toLowerCase();
  const visibleEntries = entries.filter((e) => {
    if (typeFilter !== "all" && e.entry_type !== typeFilter) return false;
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (siteFilter === "company" && e.website_id !== null) return false;
    if (siteFilter !== "all" && siteFilter !== "company" && e.website_id !== siteFilter) return false;
    if (q && !(e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) || (e.tags || []).some((t) => t.toLowerCase().includes(q))))
      return false;
    return true;
  });

  return (
    <>
      {savedMessage && (
        <div
          className="card"
          style={{ padding: "0.75rem 1rem", marginBottom: "1rem", background: "var(--accent-soft)", border: "1px solid var(--accent)" }}
        >
          {savedMessage}
        </div>
      )}

      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <input placeholder="Search title, content, tags..." value={queryText} onChange={(e) => setQueryText(e.target.value)} style={{ minWidth: "220px" }} />
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as EntryType | "all")}>
              <option value="all">All types</option>
              {ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ENTRY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as EntryStatus | "all")}>
              <option value="all">All statuses</option>
              {ENTRY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="all">All entries</option>
              <option value="company">Company-wide only</option>
              {websites.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} only
                </option>
              ))}
            </select>
          </div>
          <button className="btn" onClick={startNew}>
            + Add knowledge
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <h2>{draft.id ? "Edit entry" : "New entry"}</h2>

          <div className="grid-2">
            <div className="field">
              <label>Type</label>
              <select value={draft.entry_type} onChange={(e) => setDraft({ ...draft, entry_type: e.target.value as EntryType })}>
                {ENTRY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ENTRY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Applies to</label>
              <select value={draft.website_id} onChange={(e) => setDraft({ ...draft, website_id: e.target.value })}>
                <option value="">Company-wide (all sites)</option>
                {websites.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} only
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>{draft.entry_type === "faq" ? "Question" : "Title"}</label>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>

          <div className="field">
            <label>{draft.entry_type === "faq" ? "Answer" : "Content"}</label>
            <textarea rows={8} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Tags (comma-separated)</label>
              <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="e.g. kitchen, pricing, dublin" />
            </div>
            <div className="field">
              <label>Owner</label>
              <input value={draft.owner_name} onChange={(e) => setDraft({ ...draft, owner_name: e.target.value })} placeholder="Who's responsible for this?" />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Status</label>
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as EntryStatus })}>
                {ENTRY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Review date (optional)</label>
              <input type="date" value={draft.review_date} onChange={(e) => setDraft({ ...draft, review_date: e.target.value })} />
            </div>
          </div>

          <div className="field">
            <label>Source (optional)</label>
            <input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder="e.g. Team discussion, uploaded document name" />
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn" onClick={saveDraft} disabled={saving}>
              {saving ? "Saving..." : draft.id ? "Save changes" : "Add entry"}
            </button>
            <button
              className="btn-secondary btn"
              onClick={() => {
                setShowForm(false);
                setDraft(EMPTY_DRAFT);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {visibleEntries.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>
            {entries.length > 0 ? "No entries match the current filters." : "No knowledge entries yet — add the first one above."}
          </p>
        </div>
      ) : (
        visibleEntries.map((entry) => (
          <div key={entry.id} className="card" style={{ marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
              <div>
                <span style={{ fontSize: "0.7rem", border: "1px solid var(--border)", borderRadius: "4px", padding: "0.1rem 0.45rem", marginRight: "0.4rem" }}>
                  {ENTRY_TYPE_LABELS[entry.entry_type]}
                </span>
                <span style={{ fontSize: "0.7rem", color: STATUS_COLOR[entry.status] || "var(--muted)", fontWeight: 600, textTransform: "capitalize" }}>
                  {entry.status}
                </span>
                <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>{websiteName(entry.website_id)}</span>
                <h3 style={{ margin: "0.35rem 0 0.25rem" }}>{entry.title}</h3>
                {entry.owner_name && <p style={{ margin: "0 0 0.25rem", fontSize: "0.8rem", color: "var(--muted)" }}>Owner: {entry.owner_name}</p>}
                {entry.tags && entry.tags.length > 0 && (
                  <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>{entry.tags.map((t) => `#${t}`).join(" ")}</p>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                <button className="btn-secondary btn" style={{ fontSize: "0.8rem", padding: "0.35rem 0.7rem" }} onClick={() => startEdit(entry)}>
                  Edit
                </button>
                <button className="btn-secondary btn" style={{ fontSize: "0.8rem", padding: "0.35rem 0.7rem" }} onClick={() => deleteEntry(entry.id)}>
                  Delete
                </button>
              </div>
            </div>
            <p style={{ whiteSpace: "pre-wrap", fontSize: "0.9rem", color: "var(--muted)", marginTop: "0.5rem" }}>{entry.content}</p>
          </div>
        ))
      )}
    </>
  );
}
