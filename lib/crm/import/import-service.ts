import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { companyKeys, contactKeys, type ExistingCompany } from "../duplicates";
import { tableMissing } from "../errors";
import { fail, logEvent, STAFF_ROLES, type Db } from "../service";
import type { Category } from "../types";
import { buildRow, type BuiltRow } from "./mapping";
import { actionFor, countPlan, planImport, type PlanCounts, type PlanRow } from "./plan";
import type { ImportInput } from "./validate";

const CHUNK = 100;
const LIST_LIMIT = 200;

type Prepared = { built: BuiltRow[]; plan: PlanRow[]; categories: Category[] };

async function prepare(db: Db, input: ImportInput): Promise<Prepared | { error: string }> {
  const [cats, existing, contacts] = await Promise.all([
    db.from("crm_categories").select("id, name, sort_order, active").order("sort_order"),
    fetchAllRows<ExistingCompany>((from, to) =>
      db.from("crm_companies").select("id, name, city, name_key, website_domain, email_domain, phone_key, mobile_key, address_key").is("archived_at", null).order("id").range(from, to)
    ),
    fetchAllRows<{ id: string; email_key: string | null; phone_key: string | null }>((from, to) => db.from("crm_contacts").select("id, email_key, phone_key").order("id").range(from, to)),
  ]);
  if (cats.error) fail(cats.error, "Could not load the categories");
  const categories = (cats.data ?? []) as Category[];

  // The defaults must point at something that exists, or every row would fail the same way.
  if (input.defaults.category_id && !categories.some((c) => c.id === input.defaults.category_id && c.active)) return { error: "The default category is not available." };
  if (input.defaults.assigned_to) {
    const { data } = await db.from("profiles").select("id").eq("id", input.defaults.assigned_to).in("role", STAFF_ROLES).maybeSingle();
    if (!data) return { error: "The default owner cannot be assigned companies." };
  }

  const built = input.rows.map((cells) => buildRow(cells, input.headers, input.targets, { categories, defaults: input.defaults }));
  return { built, plan: planImport(built, existing, contacts), categories };
}

export type ImportPreview = { plan: PlanRow[]; counts: PlanCounts };

/** What an import would do, without saving anything. */
export async function previewImport(input: ImportInput): Promise<ImportPreview | { error: string }> {
  const prepared = await prepare(createServiceClient(), input);
  if ("error" in prepared) return prepared;
  return { plan: prepared.plan, counts: countPlan(prepared.plan, input.decisions) };
}

export type ImportResult = {
  batchId: string | null;
  imported: number;
  contactsCreated: number;
  /** Rows left out because they look like something already there, or had an error. */
  skipped: { row: number; label: string; reason: string }[];
  skippedCount: number;
  failed: { row: number; label: string; message: string }[];
  failedCount: number;
  warningCount: number;
};

/** A database error as something a person can act on. */
function friendly(message: string): string {
  if (/foreign key/i.test(message)) return "It refers to a category or person that no longer exists";
  if (/check constraint|violates/i.test(message)) return "A value in this row is not allowed";
  return "It could not be saved";
}

/**
 * Imports the rows the person has approved. Everything is worked out again here from the rows themselves, so the
 * preview cannot be tampered with. Existing companies are never changed: a row that looks like one is skipped unless
 * the person chose to import it anyway. Companies go in groups; if a group is refused, its rows are tried one at a
 * time, so one bad row never loses the others.
 */
export async function commitImport(input: ImportInput, userId: string): Promise<ImportResult | { error: string }> {
  if (!input.confirmed) return { error: "The import needs to be confirmed" };
  const db = createServiceClient();
  const prepared = await prepare(db, input);
  if ("error" in prepared) return prepared;
  const { built, plan } = prepared;

  const skipped: ImportResult["skipped"] = [];
  const toImport: PlanRow[] = [];
  for (const p of plan) {
    if (actionFor(p, input.decisions) === "import") toImport.push(p);
    else {
      const why = p.status === "error" ? p.errors[0] : p.matches[0] ? `Looks like ${p.matches[0].name} (${p.matches[0].reasons.join(", ")})` : p.fileMatches[0] ? `Looks like row ${p.fileMatches[0].row + 2} of this file` : "Skipped";
      skipped.push({ row: p.index + 2, label: p.label, reason: why });
    }
  }
  const warningCount = plan.filter((p) => p.warnings.length > 0).length;
  const empty: ImportResult = { batchId: null, imported: 0, contactsCreated: 0, skipped: skipped.slice(0, LIST_LIMIT), skippedCount: skipped.length, failed: [], failedCount: 0, warningCount };
  if (toImport.length === 0) return empty;

  const now = new Date().toISOString();
  const { data: batch, error: batchError } = await db.from("crm_import_batches").insert({ filename: input.filename || null, row_count: input.rows.length, created_by: userId, created_at: now }).select("id").single();
  if (batchError) fail(batchError, "Could not start the import");

  const { data: first } = await db.from("crm_stages").select("id").eq("active", true).eq("kind", "open").order("sort_order").limit(1);
  const stageId = first?.[0]?.id ?? null;

  const records = toImport.map((p) => {
    const b = built[p.index];
    const company = b.company!;
    return {
      p,
      id: randomUUID(),
      row: {
        ...company,
        ...companyKeys(company),
        extra: b.extra,
        stage_id: stageId,
        stage_changed_at: now,
        import_batch_id: batch.id,
        created_by: userId,
        updated_by: userId,
        // Equal on purpose: it is how an import is told apart from a record that has been worked on since.
        created_at: now,
        updated_at: now,
      } as Record<string, unknown>,
    };
  });

  const failed: ImportResult["failed"] = [];
  const saved: typeof records = [];
  for (let i = 0; i < records.length; i += CHUNK) {
    const group = records.slice(i, i + CHUNK);
    const { error } = await db.from("crm_companies").insert(group.map((r) => ({ id: r.id, ...r.row })));
    if (!error) {
      saved.push(...group);
      continue;
    }
    for (const r of group) {
      const one = await db.from("crm_companies").insert({ id: r.id, ...r.row });
      if (one.error) failed.push({ row: r.p.index + 2, label: r.p.label, message: friendly(one.error.message) });
      else saved.push(r);
    }
  }

  const contactRows = saved
    .filter((r) => built[r.p.index].contact && !r.p.contactNote)
    .map((r) => ({ id: randomUUID(), company_id: r.id, ...built[r.p.index].contact, ...contactKeys(built[r.p.index].contact!), import_batch_id: batch.id, created_by: userId, updated_by: userId, created_at: now, updated_at: now }));
  let contactsCreated = 0;
  for (let i = 0; i < contactRows.length; i += CHUNK) {
    const group = contactRows.slice(i, i + CHUNK);
    const { error } = await db.from("crm_contacts").insert(group);
    if (!error) contactsCreated += group.length;
    else
      for (const c of group) {
        const one = await db.from("crm_contacts").insert(c);
        if (!one.error) contactsCreated++;
      }
  }

  await db
    .from("crm_import_batches")
    .update({ imported_count: saved.length, skipped_count: skipped.length, failed_count: failed.length, contact_count: contactsCreated })
    .eq("id", batch.id);
  // Counts only: the trail never holds what was in the file.
  await logEvent(db, userId, "import_committed", "import", batch.id, { imported: saved.length, skipped: skipped.length, failed: failed.length, contacts: contactsCreated });

  return {
    batchId: batch.id,
    imported: saved.length,
    contactsCreated,
    skipped: skipped.slice(0, LIST_LIMIT),
    skippedCount: skipped.length,
    failed: failed.slice(0, LIST_LIMIT),
    failedCount: failed.length,
    warningCount,
  };
}

export type BatchRow = {
  id: string;
  filename: string | null;
  created_at: string;
  created_by_email: string | null;
  row_count: number;
  imported_count: number;
  skipped_count: number;
  failed_count: number;
  contact_count: number;
  undone_at: string | null;
};

export async function listBatches(limit = 20): Promise<BatchRow[]> {
  const db = createServiceClient();
  const { data, error } = await db.from("crm_import_batches").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) fail(error, "Could not load the imports");
  const ids = Array.from(new Set((data ?? []).map((b: any) => b.created_by).filter(Boolean)));
  const people = ids.length ? (await db.from("profiles").select("id, email").in("id", ids)).data ?? [] : [];
  const email = new Map<string, string>(people.map((p: any) => [p.id, p.email]));
  return (data ?? []).map((b: any) => ({
    id: b.id,
    filename: b.filename,
    created_at: b.created_at,
    created_by_email: email.get(b.created_by) ?? null,
    row_count: b.row_count,
    imported_count: b.imported_count,
    skipped_count: b.skipped_count,
    failed_count: b.failed_count,
    contact_count: b.contact_count,
    undone_at: b.undone_at ?? null,
  }));
}

const IN_CHUNK = 150;

/**
 * Removes the companies an import created, but only the ones nobody has touched since: not edited, no activity,
 * follow-up, opportunity or stage change, and no contact added by hand. Anything that has been worked on stays.
 */
export async function undoBatch(batchId: string, userId: string): Promise<{ removed: number; kept: number } | { notFound: true } | { error: string }> {
  const db = createServiceClient();
  const { data: batch } = await db.from("crm_import_batches").select("id, undone_at").eq("id", batchId).maybeSingle();
  if (!batch) return { notFound: true };
  if (batch.undone_at) return { error: "This import has already been undone." };

  const companies = await fetchAllRows<{ id: string; created_at: string; updated_at: string }>((from, to) =>
    db.from("crm_companies").select("id, created_at, updated_at").eq("import_batch_id", batchId).order("id").range(from, to)
  );

  const touched = new Set<string>();
  for (const c of companies) if (Date.parse(c.updated_at) !== Date.parse(c.created_at)) touched.add(c.id);

  for (let i = 0; i < companies.length; i += IN_CHUNK) {
    const ids = companies.slice(i, i + IN_CHUNK).map((c) => c.id);
    // A company with a document attached has been worked on, and its file would be left behind if the company went.
    for (const table of ["crm_activities", "crm_tasks", "crm_opportunities", "crm_stage_history", "crm_documents"]) {
      let rows: { id: string; company_id: string }[] = [];
      try {
        rows = await fetchAllRows<{ id: string; company_id: string }>((from, to) => db.from(table).select("id, company_id").in("company_id", ids).order("id").range(from, to));
      } catch (err: any) {
        // Only the documents table may be missing (its migration not run yet); any other failure stops the undo.
        if (!(table === "crm_documents" && tableMissing(err?.message))) throw err;
      }
      rows.forEach((r) => touched.add(r.company_id));
    }
    const contacts = await fetchAllRows<{ id: string; company_id: string; import_batch_id: string | null }>((from, to) => db.from("crm_contacts").select("id, company_id, import_batch_id").in("company_id", ids).order("id").range(from, to));
    contacts.filter((c) => c.import_batch_id !== batchId).forEach((c) => touched.add(c.company_id));
  }

  const removable = companies.filter((c) => !touched.has(c.id)).map((c) => c.id);
  for (let i = 0; i < removable.length; i += IN_CHUNK) {
    const { error } = await db.from("crm_companies").delete().in("id", removable.slice(i, i + IN_CHUNK));
    if (error) fail(error, "Could not undo the import");
  }

  await db.from("crm_import_batches").update({ undone_at: new Date().toISOString(), undone_by: userId }).eq("id", batchId);
  await logEvent(db, userId, "import_undone", "import", batchId, { removed: removable.length, kept: companies.length - removable.length });
  return { removed: removable.length, kept: companies.length - removable.length };
}
