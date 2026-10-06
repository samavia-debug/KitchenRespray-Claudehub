"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fileExtension,
  findDuplicates,
  formatSize,
  MAX_FILES_PER_BATCH,
  titleFromFilename,
  unreadableReason,
} from "@/lib/knowledge/bulk";
import type { WebsiteOption } from "./entry-types";
import { explainError, storeFile } from "./storage";

type ItemState = "waiting" | "uploading" | "reading" | "done" | "stored" | "failed";
type Item = { key: string; file: File; title: string; include: boolean; state: ItemState; detail?: string };

const STATE_COLOR: Record<ItemState, string> = {
  waiting: "#6f6a63",
  uploading: "#b98900",
  reading: "#b98900",
  done: "#2e7d32",
  stored: "#6f6a63",
  failed: "#b3261e",
};

const STATE_LABEL: Record<ItemState, string> = {
  waiting: "Waiting",
  uploading: "Uploading...",
  reading: "Reading content...",
  done: "Uploaded, Eleven can read it",
  stored: "Uploaded, not readable by Eleven",
  failed: "Failed",
};

async function readContent(documentId: string): Promise<{ status: string; error?: string }> {
  const res = await fetch("/api/brain/extract-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { status: "failed", error: data.error || `HTTP ${res.status}` };
  return { status: data.status, error: data.error };
}

export default function BulkUpload({
  websites,
  fixedCategories,
  customCategories,
  existingTitles,
  normalizeCategory,
  onDone,
}: {
  websites: WebsiteOption[];
  fixedCategories: string[];
  customCategories: string[];
  existingTitles: string[];
  normalizeCategory: (input: string) => string;
  onDone: () => void;
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);

  const [items, setItems] = useState<Item[]>([]);
  const [category, setCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [websiteId, setWebsiteId] = useState("");
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const duplicateFlags = findDuplicates(items.map((i) => i.title), existingTitles);

  function addFiles(list: File[]) {
    if (list.length === 0) return;
    const room = Math.max(MAX_FILES_PER_BATCH - items.length, 0);
    const taken = list.slice(0, room);
    setNotice(list.length > room ? `Only ${MAX_FILES_PER_BATCH} files per batch, so ${list.length - room} were left out. Upload this batch, then add the rest.` : null);

    setItems((prev) => {
      const next = [...prev];
      for (const file of taken) {
        const title = titleFromFilename(file.name);
        const isDuplicate = findDuplicates([...next.map((n) => n.title), title], existingTitles).pop() === true;
        next.push({
          key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
          file,
          title,
          include: !isDuplicate,
          state: "waiting",
        });
      }
      return next;
    });
  }

  function patch(key: string, change: Partial<Item>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...change } : i)));
  }

  async function run() {
    const resolvedCategory = normalizeCategory(category === "Other" ? customCategory : category) || null;
    const queue = items.filter((i) => i.include && (i.state === "waiting" || i.state === "failed") && i.title.trim());
    if (queue.length === 0) return;

    setRunning(true);
    setNotice(null);
    stopRef.current = false;
    const tally = { done: 0, stored: 0, failed: 0 };

    for (const item of queue) {
      if (stopRef.current) break;
      try {
        patch(item.key, { state: "uploading", detail: undefined });
        const publicUrl = await storeFile(supabase, item.file);

        const { data: inserted, error: insertError } = await supabase
          .from("knowledge_documents")
          .insert({
            title: item.title.trim(),
            category: resolvedCategory,
            website_id: websiteId || null,
            file_path: publicUrl,
            file_type: item.file.type || fileExtension(item.file.name) || null,
          })
          .select("id")
          .single();
        if (insertError) throw new Error(explainError(insertError.message));

        const cannotRead = unreadableReason(item.file.name, item.file.size);
        if (cannotRead) {
          patch(item.key, { state: "stored", detail: cannotRead });
          tally.stored++;
          continue;
        }

        patch(item.key, { state: "reading" });
        const result = await readContent(inserted.id);
        if (result.status === "done") {
          patch(item.key, { state: "done", detail: undefined });
          tally.done++;
        } else {
          patch(item.key, { state: "stored", detail: `Uploaded, but reading it ${result.status === "unsupported" ? "isn't supported" : `failed${result.error ? `: ${result.error}` : ""}`}. Use Re-extract on the Documents list to retry.` });
          tally.stored++;
        }
      } catch (err: any) {
        patch(item.key, { state: "failed", detail: err?.message || "Upload failed" });
        tally.failed++;
      }
    }

    setRunning(false);
    onDone();
    const parts = [`${tally.done} uploaded and readable`];
    if (tally.stored) parts.push(`${tally.stored} uploaded but not readable by Eleven`);
    if (tally.failed) parts.push(`${tally.failed} failed (you can retry them)`);
    setNotice(`${stopRef.current ? "Stopped. " : "Finished: "}${parts.join(", ")}.`);
  }

  const ready = items.filter((i) => i.include && (i.state === "waiting" || i.state === "failed") && i.title.trim()).length;
  const finished = items.filter((i) => i.state === "done" || i.state === "stored").length;

  return (
    <div className="card" style={{ marginBottom: "1.25rem" }}>
      <h2>Upload many documents at once</h2>
      <p style={{ color: "var(--muted)", marginTop: 0, fontSize: "0.9rem" }}>
        Drop up to {MAX_FILES_PER_BATCH} files, choose one category for the whole batch, and each file is uploaded and read for Eleven
        in turn. Titles come from the file names, and you can edit them first.
      </p>

      <div
        onClick={() => !running && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!running) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!running) addFiles(Array.from(e.dataTransfer.files));
        }}
        style={{
          border: `2px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
          borderRadius: "8px",
          padding: "1.5rem",
          textAlign: "center",
          cursor: running ? "default" : "pointer",
          background: dragging ? "var(--accent-soft)" : undefined,
          marginBottom: "1rem",
        }}
      >
        <strong>Drag files here</strong> or click to choose
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            addFiles(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
      </div>

      <div className="grid-2">
        <div className="field">
          <label>Category for all of these (optional)</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={running}>
            <option value="">No category</option>
            {fixedCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {customCategories.length > 0 && (
              <optgroup label="Your categories">
                {customCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="Other">Other...</option>
          </select>
        </div>
        <div className="field">
          <label>Applies to</label>
          <select value={websiteId} onChange={(e) => setWebsiteId(e.target.value)} disabled={running}>
            <option value="">Company-wide (all sites)</option>
            {websites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} only
              </option>
            ))}
          </select>
        </div>
      </div>
      {category === "Other" && (
        <div className="field">
          <label>Custom category</label>
          <input value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="e.g. Training" disabled={running} />
        </div>
      )}

      {items.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          {items.map((item, idx) => {
            const duplicate = item.state === "waiting" && duplicateFlags[idx];
            const unreadable = item.state === "waiting" ? unreadableReason(item.file.name, item.file.size) : null;
            return (
              <div key={item.key} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", padding: "0.55rem 0", borderTop: "1px solid var(--border)" }}>
                <input
                  type="checkbox"
                  checked={item.include}
                  disabled={running || item.state === "done" || item.state === "stored"}
                  onChange={(e) => patch(item.key, { include: e.target.checked })}
                  title="Include this file"
                  style={{ marginTop: "0.45rem" }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input
                    value={item.title}
                    onChange={(e) => patch(item.key, { title: e.target.value })}
                    disabled={running || item.state === "done" || item.state === "stored"}
                    style={{ width: "100%" }}
                  />
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.2rem" }}>
                    {item.file.name} · {formatSize(item.file.size)}
                  </div>
                  {duplicate && (
                    <div style={{ fontSize: "0.75rem", color: "#b98900" }}>
                      A document with this title already exists. Tick the box to upload it anyway.
                    </div>
                  )}
                  {unreadable && <div style={{ fontSize: "0.75rem", color: "#6f6a63" }}>{unreadable}</div>}
                  {item.detail && <div style={{ fontSize: "0.75rem", color: STATE_COLOR[item.state] }}>{item.detail}</div>}
                </div>
                <div style={{ fontSize: "0.8rem", color: STATE_COLOR[item.state], minWidth: "9rem", textAlign: "right", paddingTop: "0.4rem" }}>
                  {item.state === "waiting" && !item.include ? "Skipped" : STATE_LABEL[item.state]}
                </div>
                <button
                  className="btn-secondary btn"
                  style={{ fontSize: "0.75rem", padding: "0.25rem 0.55rem" }}
                  disabled={running}
                  onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                  title="Remove from this list"
                >
                  ✕
                </button>
              </div>
            );
          })}

          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.9rem" }}>
            <button className="btn" onClick={run} disabled={running || ready === 0}>
              {running ? "Uploading..." : ready > 0 ? `Upload ${ready} document${ready === 1 ? "" : "s"}` : "Nothing to upload"}
            </button>
            {running && (
              <button className="btn-secondary btn" onClick={() => (stopRef.current = true)}>
                Stop after this file
              </button>
            )}
            {!running && finished > 0 && (
              <button className="btn-secondary btn" onClick={() => setItems((prev) => prev.filter((i) => i.state !== "done" && i.state !== "stored"))}>
                Clear finished
              </button>
            )}
            {!running && (
              <button className="btn-secondary btn" onClick={() => { setItems([]); setNotice(null); }}>
                Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {notice && <p style={{ margin: "0.9rem 0 0", fontSize: "0.9rem" }}>{notice}</p>}
    </div>
  );
}
