import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { extractDocumentText } from "@/lib/knowledge/extract";

const ENTRY_EXCERPT_CHARS = 4000; // bounded so one document doesn't dominate every Ask-the-Brain prompt

/**
 * Extracts a document's text content and turns it into a linked, searchable
 * knowledge_entries row (entry_type="document", status="review" since
 * auto-extracted text isn't verified fact until a human checks it — same
 * rule Claude Analysis already follows for anything it infers). Re-running
 * this on an already-extracted document updates the same linked entry
 * rather than creating a duplicate.
 */
export async function POST(request: Request) {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  const { documentId } = await request.json();
  if (!documentId) {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: doc, error: docError } = await supabase
    .from("knowledge_documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (docError || !doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const fileResponse = await fetch(doc.file_path);
  if (!fileResponse.ok) {
    await supabase.from("knowledge_documents").update({ extraction_status: "failed" }).eq("id", documentId);
    return NextResponse.json({ error: `Could not download the file (HTTP ${fileResponse.status})` }, { status: 500 });
  }

  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  const result = await extractDocumentText(buffer, doc.title, doc.file_type);

  if (result.status !== "done") {
    await supabase
      .from("knowledge_documents")
      .update({ extraction_status: result.status, extracted_content: result.status === "failed" ? result.error : null })
      .eq("id", documentId);
    return NextResponse.json({ status: result.status, error: result.status === "failed" ? result.error : undefined });
  }

  const entryPayload = {
    entry_type: "document" as const,
    title: doc.title,
    content: result.text.length > ENTRY_EXCERPT_CHARS ? `${result.text.slice(0, ENTRY_EXCERPT_CHARS)}\n\n[truncated — see full document]` : result.text,
    website_id: doc.website_id,
    status: "review" as const,
    source: `Auto-extracted from uploaded document: ${doc.title}`,
    tags: ["auto-extracted"],
    updated_at: new Date().toISOString(),
  };

  let entryId = doc.knowledge_entry_id as string | null;

  if (entryId) {
    const { error: updateError } = await supabase.from("knowledge_entries").update(entryPayload).eq("id", entryId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("knowledge_entries")
      .insert(entryPayload)
      .select("id")
      .single();
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
    entryId = inserted.id;
  }

  const { error: docUpdateError } = await supabase
    .from("knowledge_documents")
    .update({ extraction_status: "done", extracted_content: result.text, knowledge_entry_id: entryId })
    .eq("id", documentId);

  if (docUpdateError) {
    return NextResponse.json({ error: docUpdateError.message }, { status: 500 });
  }

  return NextResponse.json({ status: "done", knowledgeEntryId: entryId, charCount: result.text.length });
}
