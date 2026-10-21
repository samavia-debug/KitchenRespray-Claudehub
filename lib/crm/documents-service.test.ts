import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, fakeFrom } from "./fake-db";

// A stand-in for private storage: files by path, with what the real thing would report about each.
const files = new Map<string, { size: number; contentType: string; start: Uint8Array }>();
const storage = {
  failRemove: false,
  removed: [] as string[],
  from: (_bucket: string) => ({
    createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/upload/${path}?token=tok`, token: "tok", path }, error: null }),
    info: async (path: string) => {
      const f = files.get(path);
      return f ? { data: { size: f.size, contentType: f.contentType }, error: null } : { data: null, error: { message: "Object not found" } };
    },
    createSignedUrl: async (path: string, seconds: number, options?: { download?: string }) => ({ data: { signedUrl: `https://storage.test/sign/${path}?s=${seconds}&d=${options?.download ?? ""}` }, error: null }),
    remove: async (paths: string[]) => {
      if (storage.failRemove) return { data: null, error: { message: "storage is down" } };
      for (const p of paths) {
        files.delete(p);
        storage.removed.push(p);
      }
      return { data: [], error: null };
    },
  }),
};
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: fakeFrom, storage }) }));
const tables = fake.tables;

import { storagePath } from "./documents";
import { deleteDocument, downloadLink, finishUpload, listDocuments, removeCompanyFiles, startUpload, type ReadStart } from "./documents-service";
import { deleteCompany } from "./service";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-222222222222";
const ARCHIVED = "11111111-1111-4111-8111-333333333333";
const JOB = "33333333-3333-4333-8333-333333333333";
const OTHER_JOB = "33333333-3333-4333-8333-444444444444";
const id = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2]);
const EXE = Uint8Array.from([0x4d, 0x5a, 0x90, 0]);
const readStart: ReadStart = async (url) => files.get(decodeURIComponent(url.split("/sign/")[1].split("?")[0]))?.start ?? null;

/** Pretends the browser has sent a file to storage, as the first step would have allowed. */
function arrive(n: number, over: { ext?: string; size?: number; start?: Uint8Array; company?: string } = {}) {
  const path = storagePath(over.company ?? COMPANY, id(n), over.ext ?? "pdf");
  files.set(path, { size: over.size ?? 5000, contentType: "application/pdf", start: over.start ?? PDF });
  return path;
}
const finish = (path: string, extra: Record<string, unknown> = {}) => finishUpload({ company_id: COMPANY, opportunity_id: null, path, file_name: "Quote.pdf", note: null, ...extra } as any, USER, readStart);

beforeEach(() => {
  fake.reset();
  files.clear();
  storage.failRemove = false;
  storage.removed = [];
  tables.profiles = [{ id: USER, email: "joanna.byrne@example.test", role: "Staff" }];
  tables.crm_companies = [
    { id: COMPANY, name: "Murphy Joinery", archived_at: null },
    { id: OTHER, name: "Other Ltd", archived_at: null },
    { id: ARCHIVED, name: "Old Ltd", archived_at: "2026-01-01T00:00:00Z" },
  ];
  tables.crm_opportunities = [
    { id: JOB, company_id: COMPANY, title: "Kitchen respray" },
    { id: OTHER_JOB, company_id: OTHER, title: "Someone else's job" },
  ];
  tables.crm_documents = [];
  tables.crm_events = [];
});

describe("starting an upload", () => {
  const request = (over: Record<string, unknown> = {}) => ({ company_id: COMPANY, opportunity_id: null, file_name: "Quote.pdf", size: 5000, content_type: "application/pdf", ...over }) as any;

  it("gives a one-off place in the company's folder, with a name we made up", async () => {
    const r = await startUpload(request({ file_name: "../../My quote (final).PDF" }));
    expect(r).toMatchObject({ token: "tok", contentType: "application/pdf" });
    const path = (r as { path: string }).path;
    expect(path).toMatch(new RegExp(`^${COMPANY}/[0-9a-f-]{36}\\.pdf$`));
    expect(path).not.toContain("quote");
    expect(tables.crm_documents).toHaveLength(0); // nothing is kept until the second step
  });

  it("uses a different place every time", async () => {
    const a = (await startUpload(request())) as { path: string };
    const b = (await startUpload(request())) as { path: string };
    expect(a.path).not.toBe(b.path);
  });

  it("refuses a file that is not accepted, before anything is prepared", async () => {
    expect(await startUpload(request({ file_name: "run.exe" }))).toEqual({ error: expect.stringContaining("not accepted") });
    expect(await startUpload(request({ size: 11 * 1024 * 1024 }))).toEqual({ error: expect.stringContaining("10 MB") });
  });

  it("refuses an unknown or archived company, and a job from another company", async () => {
    expect(await startUpload(request({ company_id: "99999999-9999-4999-8999-999999999999" }))).toEqual({ error: "That company could not be found" });
    expect(await startUpload(request({ company_id: ARCHIVED }))).toEqual({ error: "That company could not be found" });
    expect(await startUpload(request({ opportunity_id: OTHER_JOB }))).toEqual({ error: "That opportunity does not belong to this company" });
    expect(await startUpload(request({ opportunity_id: JOB }))).toHaveProperty("token");
  });
});

describe("finishing an upload", () => {
  it("keeps a good file, with its real size, who added it, and the job it belongs to", async () => {
    const path = arrive(1, { size: 4321 });
    const r = await finish(path, { opportunity_id: JOB, note: "after the site visit" });
    expect(r).toMatchObject({ document: { id: id(1), company_id: COMPANY, file_name: "Quote.pdf", size_bytes: 4321, note: "after the site visit", opportunity_id: JOB, opportunity_title: "Kitchen respray", uploaded_by: USER, uploaded_by_email: "joanna.byrne@example.test" } });
    expect(tables.crm_documents).toEqual([expect.objectContaining({ id: id(1), storage_path: path, size_bytes: 4321, uploaded_by: USER })]);
    expect(files.has(path)).toBe(true);
  });

  it("logs the kind and size, never the file's name", async () => {
    await finish(arrive(1), { file_name: "Mary Kelly home extension.pdf" });
    expect(tables.crm_events).toEqual([expect.objectContaining({ action: "document_added", user_id: USER, meta: { type: "pdf", size: 5000 } })]);
    expect(JSON.stringify(tables.crm_events)).not.toContain("Kelly");
  });

  it("removes a file that is not what its ending says, and keeps nothing", async () => {
    const path = arrive(1, { start: EXE });
    expect(await finish(path)).toEqual({ error: expect.stringContaining("not what its ending says") });
    expect(tables.crm_documents).toHaveLength(0);
    expect(files.has(path)).toBe(false);
  });

  it("removes a file that is too big or empty, even though the browser was told 10 MB at most", async () => {
    const big = arrive(1, { size: 11 * 1024 * 1024 });
    expect(await finish(big)).toEqual({ error: expect.stringContaining("larger than 10 MB") });
    const empty = arrive(2, { size: 0 });
    expect(await finish(empty)).toEqual({ error: "The file is empty" });
    expect(files.size).toBe(0);
    expect(tables.crm_documents).toHaveLength(0);
  });

  it("removes a file it cannot read the start of, rather than keeping something unchecked", async () => {
    const path = arrive(1);
    const r = await finishUpload({ company_id: COMPANY, opportunity_id: null, path, file_name: "Quote.pdf", note: null }, USER, async () => null);
    expect(r).toEqual({ error: expect.stringContaining("could not be checked") });
    expect(files.has(path)).toBe(false);
  });

  it("says so when the file never arrived", async () => {
    expect(await finish(storagePath(COMPANY, id(7), "pdf"))).toEqual({ error: "The file did not arrive. Please try again." });
  });

  it("will not save a file twice, or one that belongs to another company, or a job from another company", async () => {
    const path = arrive(1);
    await finish(path);
    expect(await finish(path)).toEqual({ error: "That file has already been saved" });
    expect(tables.crm_documents).toHaveLength(1);

    const theirs = arrive(2, { company: OTHER });
    expect(await finish(theirs)).toEqual({ error: "That upload is not valid" });
    expect(files.has(theirs)).toBe(true); // not ours to touch
    expect(await finish(arrive(3), { opportunity_id: OTHER_JOB })).toEqual({ error: "That opportunity does not belong to this company" });
    expect(await finish(arrive(4), { path: "../../etc/passwd" })).toEqual({ error: "That upload is not valid" });
    expect(tables.crm_documents).toHaveLength(1);
  });

  it("refuses an unknown company", async () => {
    expect(await finish(arrive(1), { company_id: "99999999-9999-4999-8999-999999999999", path: storagePath("99999999-9999-4999-8999-999999999999", id(1), "pdf") })).toEqual({ error: "That company could not be found" });
  });

  it("takes the file out of storage again if the record cannot be saved, with a plain message", async () => {
    const path = arrive(1);
    fake.rejectRow = () => "duplicate key value violates unique constraint crm_documents_storage_path_key";
    await expect(finish(path)).rejects.toMatchObject({ publicMessage: "Could not save the document" });
    expect(files.has(path)).toBe(false);
    expect(tables.crm_documents).toHaveLength(0);
  });
});

describe("listing documents", () => {
  it("shows a company's documents newest first, with who added them and the job, and none of another company's", async () => {
    await finish(arrive(1), { file_name: "First.pdf" });
    tables.crm_documents[0].created_at = "2026-10-01T10:00:00.000Z";
    await finish(arrive(2), { file_name: "Second.pdf", opportunity_id: JOB });
    tables.crm_documents[1].created_at = "2026-10-05T10:00:00.000Z";
    tables.crm_documents.push({ id: id(9), company_id: OTHER, file_name: "Theirs.pdf", storage_path: "x", size_bytes: 1, content_type: "application/pdf", note: null, uploaded_by: null, opportunity_id: null, created_at: "2026-10-09T10:00:00.000Z" });

    const list = await listDocuments(COMPANY);
    expect(list.map((d) => d.file_name)).toEqual(["Second.pdf", "First.pdf"]);
    expect(list[0]).toMatchObject({ opportunity_title: "Kitchen respray", uploaded_by_email: "joanna.byrne@example.test" });
    expect(list[1]).toMatchObject({ opportunity_id: null, opportunity_title: null });
    expect(list[0]).not.toHaveProperty("storage_path");
  });

  it("is empty for a company with none", async () => {
    expect(await listDocuments(OTHER)).toEqual([]);
  });
});

describe("downloading", () => {
  it("gives a link that lasts a minute and saves under the file's own name", async () => {
    const path = arrive(1);
    await finish(path, { file_name: "Murphy quote.pdf" });
    const r = await downloadLink(id(1), USER);
    expect(r).toEqual({ url: `https://storage.test/sign/${path}?s=60&d=Murphy quote.pdf` });
    expect(tables.crm_events.map((e) => e.action)).toContain("document_downloaded");
  });

  it("says there is nothing there for an unknown document", async () => {
    expect(await downloadLink(id(5), USER)).toBeNull();
  });
});

describe("deleting", () => {
  it("removes the file from storage and the record", async () => {
    const path = arrive(1);
    await finish(path);
    expect(await deleteDocument(id(1), USER)).toBe(true);
    expect(files.has(path)).toBe(false);
    expect(tables.crm_documents).toHaveLength(0);
    expect(tables.crm_events.map((e) => e.action)).toContain("document_deleted");
    expect(await deleteDocument(id(1), USER)).toBe(false);
  });

  it("keeps the record if storage will not let go of the file, so nothing is left behind with no way to find it", async () => {
    await finish(arrive(1));
    storage.failRemove = true;
    await expect(deleteDocument(id(1), USER)).rejects.toMatchObject({ publicMessage: "Could not delete the file" });
    expect(tables.crm_documents).toHaveLength(1);
  });
});

describe("erasing a company for good", () => {
  it("removes all its files first, and leaves other companies' files alone", async () => {
    const mine = [arrive(1), arrive(2)];
    for (let i = 0; i < mine.length; i++) await finish(mine[i], { file_name: `Mine${i}.pdf` });
    const theirs = arrive(3, { company: OTHER });
    tables.crm_documents.push({ id: id(3), company_id: OTHER, storage_path: theirs, file_name: "Theirs.pdf", size_bytes: 5000, content_type: "application/pdf", note: null, uploaded_by: null, opportunity_id: null, created_at: "x" });

    expect(await deleteCompany(COMPANY, USER)).toBe(true);
    expect(mine.every((p) => !files.has(p))).toBe(true);
    expect(files.has(theirs)).toBe(true);
    expect(tables.crm_companies.map((c) => c.id)).not.toContain(COMPANY);
  });

  it("stops, and does not erase the company, if a file cannot be removed", async () => {
    await finish(arrive(1));
    storage.failRemove = true;
    await expect(deleteCompany(COMPANY, USER)).rejects.toMatchObject({ publicMessage: expect.stringContaining("company was not erased") });
    expect(tables.crm_companies.map((c) => c.id)).toContain(COMPANY);
  });

  it("works for a company with no documents, and for one that is not there", async () => {
    expect(await deleteCompany(OTHER, USER)).toBe(true);
    expect(await deleteCompany("99999999-9999-4999-8999-999999999999", USER)).toBe(false);
    await expect(removeCompanyFiles(COMPANY)).resolves.toBeUndefined();
  });
});
