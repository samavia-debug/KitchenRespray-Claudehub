import type { createClient } from "@/lib/supabase/client";
import { fileExtension } from "@/lib/knowledge/bulk";

export const BUCKET = "business-brain-documents";

/** Turns database jargon into something a person can act on. */
export function explainError(message: string): string {
  return /row-level security/i.test(message)
    ? "refused: only signed-in Admins can upload documents. Sign in again and retry."
    : message;
}

/**
 * Uploads one file to the documents bucket under a random name and returns
 * its public address. The name always ends in the file's real extension: the
 * server works out what kind of file it is from that, not from the title.
 */
export async function storeFile(supabase: ReturnType<typeof createClient>, file: File): Promise<string> {
  const ext = fileExtension(file.name);
  const storedName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext ? `.${ext}` : ""}`;

  const { error } = await supabase.storage.from(BUCKET).upload(storedName, file, { upsert: true });
  if (error) {
    throw new Error(
      error.message.includes("not found") || error.message.includes("Bucket")
        ? `storage bucket "${BUCKET}" doesn't exist yet. Create it in the Supabase dashboard (Storage → New bucket) first.`
        : explainError(error.message)
    );
  }

  return supabase.storage.from(BUCKET).getPublicUrl(storedName).data.publicUrl;
}
