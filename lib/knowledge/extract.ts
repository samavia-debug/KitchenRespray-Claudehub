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

/**
 * Recovers the real uploaded file's name (with its real extension) from
 * the storage public URL — the Documents tab uploads to a randomly
 * generated `${timestamp}-${random}.${realExtension}` path, so the last
 * URL segment always carries the genuine extension. This matters because
 * the document's user-typed title (e.g. "Employee Handbook") is *not* a
 * filename and almost never ends in a real extension, which is exactly
 * what made every upload register as "unsupported" regardless of its
 * actual type until this was traced back from a live bug report.
 */
export function extractFileNameFromPath(pathOrUrl: string): string {
  try {
    const pathname = new URL(pathOrUrl).pathname;
    return decodeURIComponent(pathname.split("/").pop() || "");
  } catch {
    return "";
  }
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
      // pdf-parse's underlying pdfjs-dist expects a browser-style DOMMatrix
      // global (used internally for text-position matrix math even for
      // plain text extraction). It normally gets this via the native
      // @napi-rs/canvas addon, but that addon's platform binary isn't
      // reliably traced into a serverless function bundle (works in local
      // dev, fails in production with "DOMMatrix is not defined") — a pure
      // JS shim sidesteps needing that native binary at all.
      if (typeof (globalThis as any).DOMMatrix === "undefined") {
        const { default: DOMMatrixShim } = await import("dommatrix");
        (globalThis as any).DOMMatrix = DOMMatrixShim;
      }
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
