"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ACCEPT, ALLOWED_TEXT, checkUpload, describeSize, DOCUMENT_BUCKET, DOCUMENT_TYPES, fileExtension, NOTE_MAX } from "@/lib/crm/documents";
import type { CrmDocument } from "@/lib/crm/documents-service";
import { createClient } from "@/lib/supabase/client";
import { api } from "./api";
import { useCrm } from "./crm-context";
import { fmtDate, personName } from "./fmt";

type Job = { id: string; title: string };

/**
 * Quotes and other documents for a company: PDF, Word, Excel or a picture, up to 10 MB. Files go straight into private
 * storage and are checked again by the server before they are kept. Nobody gets a public link: every download is made
 * on request, for a minute, after the server has checked who is asking.
 */
export default function DocumentsSection({ companyId }: { companyId: string }) {
  const { meta } = useCrm();
  const isOverseer = meta?.role === "Admin" || meta?.role === "Manager";
  const [docs, setDocs] = useState<CrmDocument[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState("");
  const [note, setNote] = useState("");
  const [stage, setStage] = useState<"idle" | "preparing" | "uploading" | "saving">("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [d, o] = await Promise.all([api(`/api/crm/documents?company_id=${companyId}`), api(`/api/crm/opportunities?company_id=${companyId}`)]);
    if (!d.ok) return setError(d.body.error || "Could not load the documents");
    setError(null);
    setDocs(d.body.documents);
    if (o.ok) setJobs((o.body.opportunities as Job[]).map((x) => ({ id: x.id, title: x.title })));
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  const busy = stage !== "idle";

  function reset() {
    setOpen(false);
    setFile(null);
    setJobId("");
    setNote("");
    setFormError(null);
    if (input.current) input.current.value = "";
  }

  function choose(f: File | null) {
    setFile(f);
    setFormError(null);
    if (f) {
      const checked = checkUpload({ file_name: f.name, size: f.size, content_type: f.type });
      if ("error" in checked) setFormError(checked.error);
    }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setFormError("Choose a file first");
    const checked = checkUpload({ file_name: file.name, size: file.size, content_type: file.type });
    if ("error" in checked) return setFormError(checked.error);

    setFormError(null);
    setMessage(null);
    setStage("preparing");
    const start = await api("/api/crm/documents/upload-url", { method: "POST", body: { company_id: companyId, opportunity_id: jobId || null, file_name: file.name, size: file.size, content_type: file.type } });
    if (!start.ok) {
      setStage("idle");
      return setFormError(start.body.error || "Could not prepare the upload");
    }

    setStage("uploading");
    // The browser's own idea of the type is often empty or wrong for Office files; storage is told the real one.
    const sent = await createClient().storage.from(DOCUMENT_BUCKET).uploadToSignedUrl(start.body.path, start.body.token, new File([file], file.name, { type: start.body.contentType }), { contentType: start.body.contentType });
    if (sent.error) {
      setStage("idle");
      return setFormError("The file could not be uploaded. Check your connection and try again.");
    }

    setStage("saving");
    const done = await api("/api/crm/documents", { method: "POST", body: { company_id: companyId, opportunity_id: jobId || null, path: start.body.path, file_name: checked.value.file_name, note: note.trim() || null } });
    setStage("idle");
    if (!done.ok) return setFormError(done.body.error || "The file was uploaded but could not be saved");
    reset();
    setMessage(`Added ${checked.value.file_name}.`);
    await load();
  }

  async function remove(d: CrmDocument) {
    if (!window.confirm(`Delete "${d.file_name}" for good? The file is removed and cannot be recovered.`)) return;
    const res = await api(`/api/crm/documents/${d.id}`, { method: "DELETE" });
    if (!res.ok) return setMessage(res.body.error || "Could not delete the document");
    setMessage(`Deleted ${d.file_name}.`);
    await load();
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <h2 style={{ margin: 0 }}>Documents and quotes{docs ? ` (${docs.length})` : ""}</h2>
        {!open && (
          <button className="btn" onClick={() => { setOpen(true); setMessage(null); }}>
            + Add a document
          </button>
        )}
      </div>
      {message && <p style={{ margin: "0 0 0.6rem", fontSize: "0.85rem" }}>{message}</p>}

      {open && (
        <form onSubmit={upload} style={{ background: "var(--accent-soft)", borderRadius: 10, padding: "1rem", margin: "0.5rem 0 1rem" }}>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "var(--muted)" }}>
            {ALLOWED_TEXT}. Only add a document you are happy for the team to see. It is kept privately and nothing is shared or sent from here.
          </p>
          <div className="crm-form-grid">
            <div className="field wide-field">
              <label>File *</label>
              <input ref={input} type="file" accept={ACCEPT} disabled={busy} onChange={(e) => choose(e.target.files?.[0] ?? null)} />
              {file && !formError && <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>{describeSize(file.size)}</div>}
            </div>
            <div className="field">
              <label>Belongs to a job (optional)</label>
              <select value={jobId} onChange={(e) => setJobId(e.target.value)} disabled={busy}>
                <option value="">The company in general</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} placeholder="e.g. Quote v2 after the site visit" disabled={busy} />
            </div>
          </div>
          {formError && <p className="error-text">{formError}</p>}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.9rem", alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn" type="submit" disabled={busy || !file || !!formError}>
              {stage === "preparing" ? "Preparing..." : stage === "uploading" ? "Uploading..." : stage === "saving" ? "Checking and saving..." : "Upload"}
            </button>
            <button className="btn btn-secondary" type="button" onClick={reset} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="error-text">{error}</p>}
      {!docs && !error && <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>}
      {docs && docs.length === 0 && !open && <p style={{ color: "var(--muted)", margin: 0 }}>No documents yet. Add a quote or any paperwork for this company.</p>}

      {docs?.map((d) => {
        const kind = DOCUMENT_TYPES[fileExtension(d.file_name) ?? ""]?.label ?? "File";
        return (
          <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.7rem 0", borderTop: "1px solid var(--border)" }}>
            <div style={{ minWidth: 0 }}>
              <a href={`/api/crm/documents/${d.id}/download`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, wordBreak: "break-word" }}>
                {d.file_name}
              </a>
              <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                {kind} · {describeSize(d.size_bytes)} · added {fmtDate(d.created_at)} by {personName(d.uploaded_by_email)}
                {d.opportunity_title ? ` · job: ${d.opportunity_title}` : ""}
              </div>
              {d.note && <div style={{ fontSize: "0.85rem", marginTop: 3 }}>{d.note}</div>}
            </div>
            {isOverseer && (
              <button className="btn btn-secondary" style={{ padding: "0.25rem 0.55rem", fontSize: "0.75rem", color: "#b3261e", alignSelf: "flex-start" }} onClick={() => remove(d)}>
                Delete
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
