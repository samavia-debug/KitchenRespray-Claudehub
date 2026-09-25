"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { WebsiteOption } from "./entry-types";

const BUCKET = "business-brain-documents";

type ExtractionStatus = "pending" | "done" | "failed" | "unsupported";

type Document = {
  id: string;
  website_id: string | null;
  title: string;
  category: string | null;
  description: string | null;
  file_path: string;
  file_type: string | null;
  status: string;
  extraction_status: ExtractionStatus;
  created_at: string;
};

const EXTRACTION_LABEL: Record<ExtractionStatus, string> = {
  pending: "Not extracted yet",
  done: "Content extracted — searchable by Ask the Brain",
  failed: "Extraction failed",
  unsupported: "File type not supported for extraction",
};

const EXTRACTION_COLOR: Record<ExtractionStatus, string> = {
  pending: "#6f6a63",
  done: "#2e7d32",
  failed: "#b3261e",
  unsupported: "#6f6a63",
};

export default function DocumentsTab() {
  const supabase = createClient();
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [websites, setWebsites] = useState<WebsiteOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [websiteId, setWebsiteId] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    const [{ data, error: loadError }, { data: websiteData }] = await Promise.all([
      supabase.from("knowledge_documents").select("*").order("created_at", { ascending: false }),
      supabase.from("websites").select("id, name").order("name", { ascending: true }),
    ]);
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setDocuments((data || []) as Document[]);
    setWebsites((websiteData || []) as WebsiteOption[]);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function websiteName(websiteId: string | null): string {
    if (!websiteId) return "Company-wide";
    return websites.find((w) => w.id === websiteId)?.name || "Unknown site";
  }

  async function handleUpload() {
    if (!file || !title.trim()) {
      setMessage("Error: a title and a file are required.");
      return;
    }

    setUploading(true);
    setMessage(null);

    const fileExt = file.name.split(".").pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(fileName, file, { upsert: true });

    if (uploadError) {
      setUploading(false);
      setMessage(
        uploadError.message.includes("not found") || uploadError.message.includes("Bucket")
          ? `Error: storage bucket "${BUCKET}" doesn't exist yet — create it in the Supabase dashboard (Storage → New bucket) first.`
          : `Upload error: ${uploadError.message}`
      );
      return;
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);

    const { data: inserted, error: insertError } = await supabase
      .from("knowledge_documents")
      .insert({
        title: title.trim(),
        category: category.trim() || null,
        description: description.trim() || null,
        website_id: websiteId || null,
        file_path: publicUrlData.publicUrl,
        file_type: file.type || fileExt || null,
      })
      .select("id")
      .single();

    setUploading(false);

    if (insertError) {
      setMessage(`Error: ${insertError.message}`);
      return;
    }

    setMessage("Document uploaded — extracting its content now...");
    setTitle("");
    setCategory("");
    setDescription("");
    setWebsiteId("");
    setFile(null);
    load();

    if (inserted?.id) {
      extractContent(inserted.id);
    }
  }

  async function extractContent(id: string) {
    setExtractingIds((s) => new Set(s).add(id));
    try {
      const res = await fetch("/api/brain/extract-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Extraction error: ${data.error}`);
      } else if (data.status === "unsupported") {
        setMessage("This file type isn't supported for content extraction yet (PDF, DOCX, TXT, CSV, and MD are).");
      } else if (data.status === "failed") {
        setMessage(`Extraction failed: ${data.error}`);
      } else {
        setMessage("Content extracted — it's now searchable by Ask the Brain (marked for review).");
      }
    } catch (err: any) {
      setMessage(`Extraction error: ${err.message}`);
    } finally {
      setExtractingIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      load();
    }
  }

  async function deleteDocument(id: string) {
    if (!confirm("Delete this document record? The uploaded file itself will remain in storage.")) return;
    const { error: deleteError } = await supabase.from("knowledge_documents").delete().eq("id", id);
    if (deleteError) {
      setMessage(`Error: ${deleteError.message}`);
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

  if (!documents) {
    return <p style={{ color: "var(--muted)" }}>Loading...</p>;
  }

  return (
    <>
      {message && (
        <div
          className="card"
          style={{ padding: "0.75rem 1rem", marginBottom: "1rem", background: "var(--accent-soft)", border: "1px solid var(--accent)" }}
        >
          {message}
        </div>
      )}

      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <h2>Upload a document</h2>
        <div className="grid-2">
          <div className="field">
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Category (optional)</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Training, Policy, Pricing" />
          </div>
        </div>
        <div className="field">
          <label>Description (optional)</label>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Applies to</label>
            <select value={websiteId} onChange={(e) => setWebsiteId(e.target.value)}>
              <option value="">Company-wide (all sites)</option>
              {websites.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} only
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>File</label>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
        </div>
        <button className="btn" onClick={handleUpload} disabled={uploading}>
          {uploading ? "Uploading..." : "Upload document"}
        </button>
      </div>

      {documents.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>No documents uploaded yet.</p>
        </div>
      ) : (
        documents.map((doc) => (
          <div key={doc.id} className="card" style={{ marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
              <div>
                {doc.category && (
                  <span style={{ fontSize: "0.7rem", border: "1px solid var(--border)", borderRadius: "4px", padding: "0.1rem 0.45rem", marginRight: "0.4rem" }}>
                    {doc.category}
                  </span>
                )}
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{websiteName(doc.website_id)}</span>
                <h3 style={{ margin: "0.35rem 0 0.25rem" }}>
                  <a href={doc.file_path} target="_blank" rel="noreferrer">
                    {doc.title}
                  </a>
                </h3>
                {doc.description && <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>{doc.description}</p>}
                <p style={{ margin: "0.35rem 0 0", fontSize: "0.75rem", color: EXTRACTION_COLOR[doc.extraction_status] || "var(--muted)" }}>
                  {extractingIds.has(doc.id) ? "Extracting content..." : EXTRACTION_LABEL[doc.extraction_status] || "Not extracted yet"}
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                {doc.extraction_status !== "unsupported" && (
                  <button
                    className="btn-secondary btn"
                    style={{ fontSize: "0.8rem", padding: "0.35rem 0.7rem" }}
                    onClick={() => extractContent(doc.id)}
                    disabled={extractingIds.has(doc.id)}
                  >
                    {doc.extraction_status === "done" ? "Re-extract" : "Extract content"}
                  </button>
                )}
                <button className="btn-secondary btn" style={{ fontSize: "0.8rem", padding: "0.35rem 0.7rem" }} onClick={() => deleteDocument(doc.id)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </>
  );
}
