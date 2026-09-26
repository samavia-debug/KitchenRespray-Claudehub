"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ServiceLine = {
  id: number;
  name: string;
};

type Block = {
  type: string;
  text?: string;
  stat?: string;
  label?: string;
};

type DesignRequest = {
  id: number;
  service_line: string;
  design_type: string;
  platform: string;
  brief: string;
  additional_instructions: string | null;
  status: string;
  created_at: string;
  generated_headline: string | null;
  generated_caption: string | null;
  generated_cta: string | null;
  generated_post_type: string | null;
  generated_blocks: Block[] | null;
  rendered_image_url: string | null;
  photo_url: string | null;
  photo_before_url: string | null;
  photo_after_url: string | null;
  canva_design_id: string | null;
  canva_design_url: string | null;
  canva_edit_url: string | null;
  canva_thumbnail_url: string | null;
  canva_download_url: string | null;
};

const designTypes = [
  "Before & After",
  "Project Showcase",
  "Educational Content",
  "Inspiration",
  "Customer Review",
  "Promotional",
  "Showroom",
];

const platforms = ["Instagram", "Facebook", "TikTok", "Pinterest", "Other"];

export default function ClaudeDesignPage() {
  const supabase = createClient();

  const [services, setServices] = useState<ServiceLine[]>([]);
  const [requests, setRequests] = useState<DesignRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [renderingId, setRenderingId] = useState<number | null>(null);
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [serviceLine, setServiceLine] = useState("");
  const [designType, setDesignType] = useState("");
  const [platform, setPlatform] = useState("");
  const [brief, setBrief] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [beforeFile, setBeforeFile] = useState<File | null>(null);
  const [afterFile, setAfterFile] = useState<File | null>(null);

  async function loadData() {
    const { data: serviceData } = await supabase
      .from("service_lines")
      .select("id, name")
      .order("id", { ascending: true });

    const { data: requestData } = await supabase
      .from("design_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (serviceData) {
      setServices(serviceData as ServiceLine[]);
      if (serviceData.length > 0) setServiceLine(serviceData[0].name);
    }
    if (requestData) setRequests(requestData as DesignRequest[]);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function uploadPhoto(file: File, label: string): Promise<string | null> {
    const fileExt = file.name.split(".").pop();
    const fileName = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("request-photos")
      .upload(fileName, file, { upsert: true });

    if (uploadError) {
      setMessage(`Photo upload error: ${uploadError.message}`);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from("request-photos")
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!serviceLine || !designType || !platform || !brief.trim()) {
      setMessage("Please fill in service, design type, platform, and the brief.");
      return;
    }

    setSubmitting(true);
    setMessage(null);

    let photoUrl: string | null = null;
    let beforeUrl: string | null = null;
    let afterUrl: string | null = null;

    if (photoFile) {
      photoUrl = await uploadPhoto(photoFile, "photo");
    }
    if (beforeFile) {
      beforeUrl = await uploadPhoto(beforeFile, "before");
    }
    if (afterFile) {
      afterUrl = await uploadPhoto(afterFile, "after");
    }

    const { error } = await supabase.from("design_requests").insert({
      service_line: serviceLine,
      design_type: designType,
      platform: platform,
      brief: brief.trim(),
      additional_instructions: additionalInstructions.trim() || null,
      status: "pending",
      photo_url: photoUrl,
      photo_before_url: beforeUrl,
      photo_after_url: afterUrl,
    });

    setSubmitting(false);

    if (error) {
      setMessage(`Error: ${error.message}`);
      return;
    }

    setMessage("Request submitted.");
    setBrief("");
    setAdditionalInstructions("");
    setPhotoFile(null);
    setBeforeFile(null);
    setAfterFile(null);
    loadData();
  }

  async function handleGenerate(id: number) {
    setGeneratingId(id);
    setMessage(null);

    try {
      const res = await fetch("/api/generate-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(`Error generating: ${data.error || "Unknown error"}`);
      } else {
        setMessage("Content generated.");
        loadData();
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }

    setGeneratingId(null);
  }

  async function handleRenderDesign(id: number) {
    setRenderingId(id);
    setMessage(null);

    try {
      const res = await fetch("/api/render-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(`Error rendering design: ${data.error || "Unknown error"}`);
      } else {
        setMessage("Design rendered.");
        loadData();
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }

    setRenderingId(null);
  }

  async function handleCreateCanvaDesign(id: number) {
    setGeneratingId(id);
    setMessage(null);

    try {
      const res = await fetch("/api/canva/create-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(`Error creating Canva design: ${data.error || "Unknown error"}`);
      } else {
        setMessage("Canva design created.");
        loadData();
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }

    setGeneratingId(null);
  }

  async function handleExportDesign(id: number) {
    setExportingId(id);
    setMessage(null);

    try {
      const res = await fetch("/api/canva/export-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(`Error preparing download: ${data.error || "Unknown error"}`);
      } else {
        setMessage("Download ready.");
        loadData();
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }

    setExportingId(null);
  }

  if (loading) {
    return (
      <>
        <div className="page-header">
          <h1>Claude Design</h1>
        </div>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Claude Design</h1>
        <p>Submit a request and let Claude generate on-brand copy and layout.</p>
      </div>

      {message && (
        <div
          className="card"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
          }}
        >
          {message}
        </div>
      )}

      <div className="card">
        <h2>New request</h2>
        <form onSubmit={handleSubmit}>
          <div className="grid-2">
            <div className="field">
              <label>Service</label>
              <select value={serviceLine} onChange={(e) => setServiceLine(e.target.value)}>
                {services.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Design type</label>
              <select value={designType} onChange={(e) => setDesignType(e.target.value)}>
                <option value="">Select...</option>
                {designTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Platform</label>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">Select...</option>
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>What would you like to create?</label>
            <textarea
              rows={3}
              placeholder="e.g. A before-and-after post for a kitchen we resprayed in Dublin this week"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Additional instructions (optional)</label>
            <textarea
              rows={2}
              value={additionalInstructions}
              onChange={(e) => setAdditionalInstructions(e.target.value)}
            />
          </div>

          <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0 0 0.75rem" }}>
            Adding a photo unlocks two more layouts (full-bleed photo and side-by-side before/after) — without one,
            Claude can only choose from the text-only layouts, which is the main reason posts can start to look
            similar to each other. Even one photo makes a real difference.
          </p>

          <div className="grid-2">
            <div className="field">
              <label>Before photo (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setBeforeFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="field">
              <label>After photo (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setAfterFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>

          <div className="field">
            <label>Single photo (optional — for posts that aren't before/after)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
            />
          </div>

          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Create Design"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Recent requests</h2>
        {requests.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No requests yet.</p>
        )}
        {requests.map((r) => (
          <div
            key={r.id}
            style={{
              padding: "0.85rem 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
              <strong>
                {r.service_line} - {r.design_type} - {r.platform}
              </strong>
              <span style={{ color: "var(--muted)" }}>{r.status}</span>
            </div>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.9rem", color: "var(--muted)" }}>
              {r.brief}
            </p>

            {r.status === "generated" && (
              <div
                style={{
                  marginTop: "0.6rem",
                  background: "var(--paper)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "0.75rem 1rem",
                  fontSize: "0.9rem",
                }}
              >
                {r.generated_post_type && (
                  <p style={{ margin: "0 0 0.4rem" }}>
                    <strong>Post type:</strong> {r.generated_post_type}
                  </p>
                )}
                <p style={{ margin: "0 0 0.4rem" }}>
                  <strong>Headline:</strong> {r.generated_headline}
                </p>
                <p style={{ margin: "0 0 0.4rem" }}>
                  <strong>Caption:</strong> {r.generated_caption}
                </p>
                <p style={{ margin: r.generated_blocks?.length ? "0 0 0.4rem" : 0 }}>
                  <strong>CTA:</strong> {r.generated_cta}
                </p>
                {r.generated_blocks && r.generated_blocks.length > 0 && (
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.85rem" }}>
                    <strong>Layout:</strong>{" "}
                    {r.generated_blocks.map((b) => b.type).join(" \u2192 ")}
                  </p>
                )}
              </div>
            )}

            {r.rendered_image_url ? (
              <img
                src={r.rendered_image_url}
                alt="Rendered design"
                style={{
                  marginTop: "0.6rem",
                  maxWidth: "320px",
                  width: "100%",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  display: "block",
                }}
              />
            ) : (
              r.canva_thumbnail_url && (
                <img
                  src={r.canva_thumbnail_url}
                  alt="Design preview"
                  style={{
                    marginTop: "0.6rem",
                    maxWidth: "260px",
                    width: "100%",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    display: "block",
                  }}
                />
              )
            )}

            <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
              {r.status === "pending" && (
                <button
                  className="btn"
                  style={{ fontSize: "0.85rem", padding: "0.45rem 0.8rem" }}
                  onClick={() => handleGenerate(r.id)}
                  disabled={generatingId === r.id}
                >
                  {generatingId === r.id ? "Generating..." : "Generate content"}
                </button>
              )}

              {r.status === "generated" && r.generated_blocks && r.generated_blocks.length > 0 && (
                <button
                  className="btn"
                  style={{ fontSize: "0.85rem", padding: "0.45rem 0.8rem" }}
                  onClick={() => handleRenderDesign(r.id)}
                  disabled={renderingId === r.id}
                >
                  {renderingId === r.id
                    ? "Rendering..."
                    : r.rendered_image_url
                    ? "Re-render design"
                    : "Render design"}
                </button>
              )}

              {r.status === "generated" && !r.canva_edit_url && (
                <button
                  className="btn-secondary btn"
                  style={{ fontSize: "0.85rem", padding: "0.45rem 0.8rem" }}
                  onClick={() => handleCreateCanvaDesign(r.id)}
                  disabled={generatingId === r.id}
                >
                  {generatingId === r.id ? "Creating design..." : "Also create in Canva"}
                </button>
              )}

              {r.canva_edit_url && (
                <>
                  <a
                    href={r.canva_edit_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn"
                    style={{ fontSize: "0.85rem", padding: "0.45rem 0.8rem" }}
                  >
                    Edit in Canva
                  </a>
                  <a
                    href={r.canva_design_url || r.canva_edit_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary btn"
                    style={{ fontSize: "0.85rem", padding: "0.45rem 0.8rem" }}
                  >
                    View design
                  </a>

                  {r.canva_download_url && (
                    <a
                      href={r.canva_download_url}
                      download
                      className="btn-secondary btn"
                      style={{ fontSize: "0.85rem", padding: "0.45rem 0.8rem" }}
                    >
                      Download image
                    </a>
                  )}

                  {!r.canva_download_url && (
                    <button
                      className="btn-secondary btn"
                      style={{ fontSize: "0.85rem", padding: "0.45rem 0.8rem" }}
                      onClick={() => handleExportDesign(r.id)}
                      disabled={exportingId === r.id}
                    >
                      {exportingId === r.id ? "Preparing..." : "Prepare download"}
                    </button>
                  )}
                </>
              )}

              {r.rendered_image_url && (
                <a
                  href={r.rendered_image_url}
                  download
                  className="btn-secondary btn"
                  style={{ fontSize: "0.85rem", padding: "0.45rem 0.8rem" }}
                >
                  Download image
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
