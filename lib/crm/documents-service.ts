import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { PublicError, tableMissing } from "./errors";
import { checkUpload, DOCUMENT_BUCKET, MAX_DOCUMENT_BYTES, matchesSignature, parseStoragePath, storagePath, type FinishRequest, type UploadRequest } from "./documents";
import { fail, logEvent, type Db } from "./service";

export type CrmDocument = {
  id: string;
  company_id: string;
  opportunity_id: string | null;
  opportunity_title: string | null;
  file_name: string;
  size_bytes: number;
  content_type: string;
  note: string | null;
  uploaded_by: string | null;
  uploaded_by_email: string | null;
  created_at: string;
};

const COLUMNS = "id, company_id, opportunity_id, file_name, storage_path, size_bytes, content_type, note, uploaded_by, created_at";

/** Reads the first few bytes of a stored file through a short-lived link. Tests give it a stand-in. */
export type ReadStart = (url: string) => Promise<Uint8Array | null>;

export const readStartOfFile: ReadStart = async (url) => {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-15" }, cache: "no-store" });
    if (!res.ok) return null;
    return new Uint8Array((await res.arrayBuffer()).slice(0, 16));
  } catch {
    return null;
  }
};

const bucket = (db: Db) => db.storage.from(DOCUMENT_BUCKET);


async function companyExists(db: Db, companyId: string): Promise<boolean> {
  const { data } = await db.from("crm_companies").select("id").eq("id", companyId).is("archived_at", null).maybeSingle();
  return !!data;
}

async function opportunityBelongs(db: Db, opportunityId: string, companyId: string): Promise<boolean> {
  const { data } = await db.from("crm_opportunities").select("id").eq("id", opportunityId).eq("company_id", companyId).maybeSingle();
  return !!data;
}

// ---------- adding a file ----------

/**
 * Step one of adding a file: checks the request and hands back a one-off place to upload to. The browser sends the file
 * straight to storage (so its size is not limited by the web server), then asks us to save it with `finishUpload`.
 */
export async function startUpload(input: UploadRequest, db: Db = createServiceClient()): Promise<{ path: string; token: string; contentType: string } | { error: string }> {
  const checked = checkUpload({ file_name: input.file_name, size: input.size, content_type: input.content_type });
  if ("error" in checked) return { error: checked.error };
  if (!(await companyExists(db, input.company_id))) return { error: "That company could not be found" };
  if (input.opportunity_id && !(await opportunityBelongs(db, input.opportunity_id, input.company_id))) return { error: "That opportunity does not belong to this company" };

  const path = storagePath(input.company_id, randomUUID(), checked.value.ext);
  const { data, error } = await bucket(db).createSignedUploadUrl(path);
  if (error || !data) throw new PublicError("Could not prepare the upload. If the documents migration has not been run in Supabase yet, run it first.", error?.message ?? "no upload link");
  return { path, token: data.token, contentType: checked.value.contentType };
}

/**
 * Step two: the file is in storage, so check it really is what it claims (size, then its first bytes) and, only then, keep
 * it. A file that fails is removed from storage again so nothing unchecked is left behind.
 */
export async function finishUpload(input: FinishRequest, userId: string, readStart: ReadStart = readStartOfFile, db: Db = createServiceClient()): Promise<{ document: CrmDocument } | { error: string }> {
  const parts = parseStoragePath(input.path);
  if (!parts || parts.companyId !== input.company_id) return { error: "That upload is not valid" };
  if (!(await companyExists(db, input.company_id))) return { error: "That company could not be found" };
  if (input.opportunity_id && !(await opportunityBelongs(db, input.opportunity_id, input.company_id))) return { error: "That opportunity does not belong to this company" };

  const { data: already } = await db.from("crm_documents").select("id").eq("id", parts.id).maybeSingle();
  if (already) return { error: "That file has already been saved" };

  const reject = async (message: string) => {
    await bucket(db).remove([input.path]);
    return { error: message };
  };

  const { data: info, error: infoError } = await bucket(db).info(input.path);
  if (infoError || !info) return { error: "The file did not arrive. Please try again." };
  const size = Number(info.size ?? 0);
  if (!(size > 0)) return reject("The file is empty");
  if (size > MAX_DOCUMENT_BYTES) return reject("That file is larger than 10 MB, so it was not kept.");

  const { data: link } = await bucket(db).createSignedUrl(input.path, 60);
  const start = link?.signedUrl ? await readStart(link.signedUrl) : null;
  if (!start) return reject("The file could not be checked, so it was not kept. Please try again.");
  if (!matchesSignature(parts.ext, start)) return reject("The file is not what its ending says it is, so it was not kept.");

  const row = { id: parts.id, company_id: input.company_id, opportunity_id: input.opportunity_id, file_name: input.file_name, storage_path: input.path, size_bytes: size, content_type: info.contentType ?? "", note: input.note, uploaded_by: userId };
  const { error } = await db.from("crm_documents").insert(row);
  if (error) {
    await bucket(db).remove([input.path]);
    fail(error, "Could not save the document");
  }
  // The log keeps what kind and how big, never the file's name: names often hold a customer's.
  await logEvent(db, userId, "document_added", "document", parts.id, { type: parts.ext, size });
  const [doc] = await withNames([{ ...row, created_at: new Date().toISOString() }], db);
  return { document: doc };
}

// ---------- reading, downloading, removing ----------

async function withNames(rows: any[], db: Db): Promise<CrmDocument[]> {
  const people = Array.from(new Set(rows.map((r) => r.uploaded_by).filter(Boolean)));
  const jobs = Array.from(new Set(rows.map((r) => r.opportunity_id).filter(Boolean)));
  const [{ data: profiles }, { data: opportunities }] = await Promise.all([
    people.length ? db.from("profiles").select("id, email").in("id", people) : Promise.resolve({ data: [] as any[] }),
    jobs.length ? db.from("crm_opportunities").select("id, title").in("id", jobs) : Promise.resolve({ data: [] as any[] }),
  ]);
  const email = new Map((profiles ?? []).map((p: any) => [p.id as string, p.email as string]));
  const title = new Map((opportunities ?? []).map((o: any) => [o.id as string, o.title as string]));
  return rows.map((r) => ({
    id: r.id,
    company_id: r.company_id,
    opportunity_id: r.opportunity_id ?? null,
    opportunity_title: r.opportunity_id ? title.get(r.opportunity_id) ?? null : null,
    file_name: r.file_name,
    size_bytes: Number(r.size_bytes),
    content_type: r.content_type,
    note: r.note ?? null,
    uploaded_by: r.uploaded_by ?? null,
    uploaded_by_email: r.uploaded_by ? email.get(r.uploaded_by) ?? null : null,
    created_at: r.created_at,
  }));
}

/** A company's documents, newest first. */
export async function listDocuments(companyId: string, db: Db = createServiceClient()): Promise<CrmDocument[]> {
  const { data, error } = await db.from("crm_documents").select(COLUMNS).eq("company_id", companyId).order("created_at", { ascending: false }).order("id");
  if (error) fail(error, "Could not load the documents");
  return withNames(data ?? [], db);
}

/** A link that downloads the file and stops working after a minute, or null when there is no such document. */
export async function downloadLink(id: string, userId: string, db: Db = createServiceClient()): Promise<{ url: string } | null> {
  const { data: row, error } = await db.from("crm_documents").select("id, company_id, file_name, storage_path").eq("id", id).maybeSingle();
  if (error) fail(error, "Could not find the document");
  if (!row) return null;
  const { data, error: linkError } = await bucket(db).createSignedUrl(row.storage_path, 60, { download: row.file_name });
  if (linkError || !data?.signedUrl) throw new PublicError("Could not open the document", linkError?.message ?? "no link");
  await logEvent(db, userId, "document_downloaded", "document", id, {});
  return { url: data.signedUrl };
}

/** Removes the file from storage and then the record. If storage will not let go of the file, the record stays so nothing is orphaned. */
export async function deleteDocument(id: string, userId: string, db: Db = createServiceClient()): Promise<boolean> {
  const { data: row, error } = await db.from("crm_documents").select("id, storage_path").eq("id", id).maybeSingle();
  if (error) fail(error, "Could not find the document");
  if (!row) return false;
  const removed = await bucket(db).remove([row.storage_path]);
  if (removed.error) throw new PublicError("Could not delete the file", removed.error.message);
  const { error: deleteError } = await db.from("crm_documents").delete().eq("id", id);
  if (deleteError) fail(deleteError, "Could not delete the document");
  await logEvent(db, userId, "document_deleted", "document", id, {});
  return true;
}

/**
 * Removes every file a company has from storage, for when the company is being erased for good. Done before the company
 * goes: if a file cannot be removed the erase stops, rather than leaving a customer's files behind with nothing to find them by.
 */
export async function removeCompanyFiles(companyId: string, db: Db = createServiceClient()): Promise<void> {
  const { data, error } = await db.from("crm_documents").select("id, storage_path").eq("company_id", companyId);
  // Before the documents migration has been run there is nothing to remove.
  if (error && tableMissing(error.message)) return;
  if (error) fail(error, "Could not check the company's documents");
  const paths = (data ?? []).map((d: any) => d.storage_path as string);
  for (let i = 0; i < paths.length; i += 100) {
    const removed = await bucket(db).remove(paths.slice(i, i + 100));
    if (removed.error) throw new PublicError("Could not delete the company's documents, so the company was not erased", removed.error.message);
  }
}
