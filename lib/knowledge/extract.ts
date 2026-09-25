// Document content extraction for the Business Brain's Documents tab.
// Pure text extraction only — no auto-tagging/categorization (that would
// need its own Claude call and is a deliberate phase-2 scope cut).

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB — keeps this well within a serverless function's memory/time budget
const MAX_STORED_CHARS = 50_000; // full text kept on knowledge_documents.extracted_content, for reference

export type ExtractResult =
  | { status: "done"; text: string }
  | { status: "failed"; error: string }
  | { status: "unsupported" };

function extensionOf(fileName: string, fileType: string | null): string {
  const fromType = (fileType || "").split("/").pop() || "";
  const fromName = fileName.split(".").pop() || "";
  return (fromName || fromType).toLowerCase();
}

export async function extractDocumentText(
  buffer: Buffer,
  fileName: string,
  fileType: string | null
): Promise<ExtractResult> {
  if (buffer.byteLength > MAX_FILE_BYTES) {
    return { status: "failed", error: `File too large to extract (${Math.round(buffer.byteLength / 1024 / 1024)}MB, limit 15MB).` };
  }

  const ext = extensionOf(fileName, fileType);

  try {
    if (ext === "pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return { status: "done", text: result.text.slice(0, MAX_STORED_CHARS) };
    }

    if (ext === "docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return { status: "done", text: result.value.slice(0, MAX_STORED_CHARS) };
    }

    if (ext === "txt" || ext === "csv" || ext === "md") {
      return { status: "done", text: buffer.toString("utf-8").slice(0, MAX_STORED_CHARS) };
    }

    return { status: "unsupported" };
  } catch (err: any) {
    return { status: "failed", error: err.message || "Extraction failed" };
  }
}
