// Documents and quotes attached to a company: which files are accepted, what they are called, and the checks that happen
// before and after a file is uploaded. Kept apart from the screen and the database so the rules can be tested.

export const DOCUMENT_BUCKET = "crm-documents";
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const NOTE_MAX = 500;

type Kind = { mime: string; label: string };

/** The only files accepted, by extension. Macro-enabled Office files and anything that can run are not on the list. */
export const DOCUMENT_TYPES: Record<string, Kind> = {
  pdf: { mime: "application/pdf", label: "PDF" },
  jpg: { mime: "image/jpeg", label: "Picture" },
  jpeg: { mime: "image/jpeg", label: "Picture" },
  png: { mime: "image/png", label: "Picture" },
  doc: { mime: "application/msword", label: "Word" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word" },
  xls: { mime: "application/vnd.ms-excel", label: "Excel" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel" },
};

/** For the file box's `accept` attribute and for telling people what is allowed. */
export const ACCEPT = Object.keys(DOCUMENT_TYPES).map((e) => `.${e}`).join(",");
export const ALLOWED_TEXT = "PDF, Word, Excel, JPG or PNG, up to 10 MB";

export const bucketMimeTypes = () => Array.from(new Set(Object.keys(DOCUMENT_TYPES).map((e) => DOCUMENT_TYPES[e].mime)));

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH = new RegExp(`^(${UUID})/(${UUID})\\.([a-z]+)$`);

export const isUuidText = (v: unknown): v is string => typeof v === "string" && new RegExp(`^${UUID}$`, "i").test(v);

/** The lower-case ending of a file name ("Quote.PDF" -> "pdf"), or null when it has none. */
export function fileExtension(name: string): string | null {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * A file name fit to show and to save: folders and odd characters taken out, tidy spacing, a sensible length that keeps
 * the ending. The name is only ever shown and used as the download name; the stored file's name is made up by us.
 */
export function cleanFileName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const last = raw.split(/[\\/]/).pop() ?? "";
  const name = last.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim();
  if (!name || name === "." || name === "..") return null;
  if (name.length <= 150) return name;
  const ext = fileExtension(name);
  return ext ? `${name.slice(0, 150 - ext.length - 1).trim()}.${ext}` : name.slice(0, 150);
}

export function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type UploadCheck = { file_name: string; ext: string; contentType: string };

/**
 * Whether a file about to be uploaded is acceptable, going by its name and size. The type the browser reports is not
 * used (browsers often get it wrong for Office files); what counts is the ending, and the file's first bytes, which are
 * checked again once it has been uploaded.
 */
export function checkUpload(input: { file_name: unknown; size: unknown; content_type?: unknown }): { value: UploadCheck } | { error: string } {
  const file_name = cleanFileName(input.file_name);
  if (!file_name) return { error: "The file has no usable name" };
  const ext = fileExtension(file_name);
  const kind = ext ? DOCUMENT_TYPES[ext] : undefined;
  if (!ext || !kind) return { error: `That kind of file is not accepted. Use ${ALLOWED_TEXT}.` };
  const size = input.size;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return { error: "The file is empty" };
  if (size > MAX_DOCUMENT_BYTES) return { error: `That file is ${describeSize(size)}. The most that can be added is 10 MB.` };
  return { value: { file_name, ext, contentType: kind.mime } };
}

/** Where a file is kept: the company's folder, and a name we make up (never the person's file name). */
export const storagePath = (companyId: string, id: string, ext: string) => `${companyId}/${id}.${ext}`;

/** Splits a stored path back into its parts, or null when it is not one we would have made. */
export function parseStoragePath(path: unknown): { companyId: string; id: string; ext: string } | null {
  if (typeof path !== "string") return null;
  const m = PATH.exec(path);
  return m && DOCUMENT_TYPES[m[3]] ? { companyId: m[1], id: m[2], ext: m[3] } : null;
}

/** Whether the first bytes of a file are what its ending says (a PDF starts "%PDF", a modern Office file is a zip, and so on). */
export function matchesSignature(ext: string, bytes: Uint8Array): boolean {
  const starts = (...sig: number[]) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
  switch (ext) {
    case "pdf":
      return starts(0x25, 0x50, 0x44, 0x46, 0x2d); // %PDF-
    case "png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "jpg":
    case "jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "docx":
    case "xlsx":
      return starts(0x50, 0x4b, 0x03, 0x04); // a zip
    case "doc":
    case "xls":
      return starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1); // the old Office container
    default:
      return false;
  }
}

export type UploadRequest = { company_id: string; opportunity_id: string | null; file_name: string; size: number; content_type: string | undefined };
export type FinishRequest = { company_id: string; opportunity_id: string | null; path: string; file_name: string; note: string | null };

type Cleaned<T> = { value: T } | { error: string };
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function optionalId(raw: Record<string, unknown>, key: string): string | null | undefined {
  const v = raw[key];
  if (v === undefined || v === null || v === "") return null;
  return isUuidText(v) ? v : undefined;
}

export function cleanUploadRequest(input: unknown): Cleaned<UploadRequest> {
  const raw = obj(input);
  if (!raw) return { error: "Nothing was sent" };
  if (!isUuidText(raw.company_id)) return { error: "Choose a company" };
  const opportunity_id = optionalId(raw, "opportunity_id");
  if (opportunity_id === undefined) return { error: "That opportunity is not valid" };
  const checked = checkUpload({ file_name: raw.file_name, size: raw.size, content_type: raw.content_type });
  if ("error" in checked) return { error: checked.error };
  return { value: { company_id: raw.company_id, opportunity_id, file_name: checked.value.file_name, size: raw.size as number, content_type: typeof raw.content_type === "string" ? raw.content_type : undefined } };
}

export function cleanFinishRequest(input: unknown): Cleaned<FinishRequest> {
  const raw = obj(input);
  if (!raw) return { error: "Nothing was sent" };
  if (!isUuidText(raw.company_id)) return { error: "Choose a company" };
  const opportunity_id = optionalId(raw, "opportunity_id");
  if (opportunity_id === undefined) return { error: "That opportunity is not valid" };
  const parts = parseStoragePath(raw.path);
  if (!parts || parts.companyId !== raw.company_id) return { error: "That upload is not valid" };
  const file_name = cleanFileName(raw.file_name);
  if (!file_name || fileExtension(file_name) !== parts.ext) return { error: "The file name does not match the upload" };
  let note: string | null = null;
  if (raw.note !== undefined && raw.note !== null) {
    if (typeof raw.note !== "string") return { error: "The note must be text" };
    note = raw.note.replace(/\s+/g, " ").trim() || null;
    if (note && note.length > NOTE_MAX) return { error: `Keep the note to ${NOTE_MAX} characters` };
  }
  return { value: { company_id: raw.company_id, opportunity_id, path: raw.path as string, file_name, note } };
}
