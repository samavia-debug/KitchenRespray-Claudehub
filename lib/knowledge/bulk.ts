// Pure helpers for the bulk document upload, kept free of browser and
// Supabase code so they can be tested on their own.

export const MAX_FILES_PER_BATCH = 50;

// Must match what extractDocumentText can actually read.
export const READABLE_EXTENSIONS = ["pdf", "docx", "txt", "csv", "md"];
export const MAX_READABLE_BYTES = 15 * 1024 * 1024;

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLowerCase() : "";
}

export function isReadableName(fileName: string): boolean {
  return READABLE_EXTENSIONS.includes(fileExtension(fileName));
}

/** "Chadwicks_Kitchen  price list.pdf" -> "Chadwicks Kitchen price list" */
export function titleFromFilename(fileName: string): string {
  const ext = fileExtension(fileName);
  const base = ext ? fileName.slice(0, fileName.length - ext.length - 1) : fileName;
  const title = base.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return title || "Untitled document";
}

/**
 * For each title, true when an earlier title in the list, or an existing
 * document, already uses it (case-insensitive). The first of two identical
 * titles in one batch is not a duplicate; the second is.
 */
export function findDuplicates(titles: string[], existingTitles: string[]): boolean[] {
  const seen = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  return titles.map((t) => {
    const key = t.trim().toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Why Eleven won't be able to read a file's contents, or null when it can. */
export function unreadableReason(fileName: string, size: number): string | null {
  if (!isReadableName(fileName)) {
    const ext = fileExtension(fileName);
    return `${ext ? `.${ext}` : "This"} files are stored but Eleven can't read inside them (PDF, Word, TXT, CSV and MD are readable)`;
  }
  if (size > MAX_READABLE_BYTES) return "Too large for Eleven to read (over 15 MB), it will be stored only";
  return null;
}
