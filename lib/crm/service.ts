import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { companyKeys, contactKeys, matchCompanies, matchContacts, type CompanyKeys, type ExistingCompany, type ExistingContact } from "./duplicates";
import { CLOSING_KINDS, type Assignee, type Category, type Company, type CompanyFields, type CompanyQuery, type Contact, type ContactDuplicateMatch, type ContactFields, type DuplicateMatch, type Stage } from "./types";
import type { BulkChange, StageChange } from "./validate";

export type Db = ReturnType<typeof createServiceClient>;

export const STAFF_ROLES = ["Admin", "Manager", "Staff"];

// The related names come along with each company, so lists and profiles need no second request.
const COMPANY_SELECT =
  "*, category:crm_categories(name), stage:crm_stages(name, kind), assignee:profiles!assigned_to(email), contacts:crm_contacts(count)";

export function fail(error: { message: string } | null | undefined, what: string): never {
  throw new Error(`${what}: ${error?.message ?? "unknown error"}`);
}

/** What the company list and profile show: the stored row with the related names flattened in. */
export type CompanyRow = Company & {
  category_name: string | null;
  stage_name: string | null;
  stage_kind: string | null;
  assignee_email: string | null;
  contact_count: number;
};

function flatten(row: any): CompanyRow {
  const { category, stage, assignee, contacts, name_key, website_domain, email_domain, phone_key, address_key, ...rest } = row;
  return {
    ...rest,
    category_name: category?.name ?? null,
    stage_name: stage?.name ?? null,
    stage_kind: stage?.kind ?? null,
    assignee_email: assignee?.email ?? null,
    contact_count: contacts?.[0]?.count ?? 0,
  };
}

/**
 * The time to stamp a save with. Always later than the previous stamp, so two saves can never share one and the
 * "has someone saved since I opened this" check cannot miss a change.
 */
export function nextStamp(previous?: string | null): string {
  const prev = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(Date.now(), (Number.isFinite(prev) ? prev : 0) + 1)).toISOString();
}

export async function logEvent(db: Db, userId: string, action: string, entity: string, entityId: string | null, meta: Record<string, unknown> = {}) {
  // The trail must never stop the change it describes, and holds only field names and counts.
  await db.from("crm_events").insert({ user_id: userId, action, entity, entity_id: entityId, meta });
}

async function emailsFor(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((i): i is string => !!i)));
  if (unique.length === 0) return new Map();
  const { data } = await db.from("profiles").select("id, email").in("id", unique);
  return new Map((data ?? []).map((p: any) => [p.id, p.email]));
}

// ---------- lists the Admin can change ----------

export async function getMeta(): Promise<{ categories: Category[]; stages: Stage[]; assignees: Assignee[] }> {
  const db = createServiceClient();
  const [cats, stages, people] = await Promise.all([
    db.from("crm_categories").select("id, name, sort_order, active").order("sort_order").order("name"),
    db.from("crm_stages").select("id, name, kind, sort_order, active").order("sort_order"),
    db.from("profiles").select("id, email, role").in("role", STAFF_ROLES).order("email"),
  ]);
  if (cats.error) fail(cats.error, "Could not load the categories");
  if (stages.error) fail(stages.error, "Could not load the stages");
  if (people.error) fail(people.error, "Could not load the team");
  // A numeric column can arrive as text, so the order is turned into a number here.
  const asNumber = <T extends { sort_order: unknown }>(rows: T[]) => rows.map((r) => ({ ...r, sort_order: Number(r.sort_order) }));
  return { categories: asNumber(cats.data as Category[]), stages: asNumber(stages.data as Stage[]), assignees: people.data as Assignee[] };
}

export async function saveCategory(
  userId: string,
  input: { id?: string; name?: string; active?: boolean; sort_order?: number }
): Promise<{ id: string } | { error: string }> {
  const db = createServiceClient();
  const name = input.name?.trim();
  if (name !== undefined && (name.length < 1 || name.length > 80)) return { error: "A category name must be 1 to 80 characters" };

  if (!input.id) {
    if (!name) return { error: "Enter a category name" };
    const { count } = await db.from("crm_categories").select("id", { count: "exact", head: true });
    const { data, error } = await db.from("crm_categories").insert({ name, sort_order: (count ?? 0) + 1 }).select("id").single();
    if (error) return { error: /duplicate|unique/i.test(error.message) ? "There is already a category with that name" : error.message };
    await logEvent(db, userId, "category_created", "category", data.id);
    return { id: data.id };
  }

  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (input.active !== undefined) patch.active = input.active;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  const { error } = await db.from("crm_categories").update(patch).eq("id", input.id);
  if (error) return { error: /duplicate|unique/i.test(error.message) ? "There is already a category with that name" : error.message };
  await logEvent(db, userId, "category_updated", "category", input.id, { fields: Object.keys(patch) });
  return { id: input.id };
}

export async function saveStage(
  userId: string,
  input: { id?: string; name?: string; active?: boolean; sort_order?: number }
): Promise<{ id: string } | { error: string }> {
  const db = createServiceClient();
  const name = input.name?.trim();
  if (name !== undefined && (name.length < 1 || name.length > 80)) return { error: "A stage name must be 1 to 80 characters" };

  if (!input.id) {
    if (!name) return { error: "Enter a stage name" };
    // New stages are ordinary working stages, placed before Won. Won, Lost and Not Suitable keep their meaning.
    const { data: closing } = await db.from("crm_stages").select("sort_order").neq("kind", "open").order("sort_order").limit(1);
    const { data: last } = await db.from("crm_stages").select("sort_order").eq("kind", "open").order("sort_order", { ascending: false }).limit(1);
    const lastOpen = Number(last?.[0]?.sort_order ?? 0);
    const firstClosing = closing?.[0] ? Number(closing[0].sort_order) : null;
    const sort = firstClosing !== null && firstClosing > lastOpen ? (lastOpen + firstClosing) / 2 : lastOpen + 1;
    const { data, error } = await db.from("crm_stages").insert({ name, kind: "open", sort_order: sort }).select("id").single();
    if (error) return { error: /duplicate|unique/i.test(error.message) ? "There is already a stage with that name" : error.message };
    await logEvent(db, userId, "stage_created", "stage", data.id);
    return { id: data.id };
  }

  const { data: current } = await db.from("crm_stages").select("kind").eq("id", input.id).maybeSingle();
  if (!current) return { error: "That stage no longer exists" };
  if (input.active === false && current.kind !== "open") return { error: "Won, Lost and Not Suitable are needed to close a deal, so they cannot be switched off" };

  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (input.active !== undefined) patch.active = input.active;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  const { error } = await db.from("crm_stages").update(patch).eq("id", input.id);
  if (error) return { error: /duplicate|unique/i.test(error.message) ? "There is already a stage with that name" : error.message };
  await logEvent(db, userId, "stage_updated", "stage", input.id, { fields: Object.keys(patch) });
  return { id: input.id };
}

// ---------- duplicates ----------

async function candidateCompanies(db: Db, keys: CompanyKeys): Promise<ExistingCompany[]> {
  // Every key is lower-case letters, digits, spaces, dots or dashes, so it is safe to put in a filter.
  const clauses: string[] = [];
  if (keys.name_key) {
    clauses.push(`name_key.eq.${keys.name_key}`);
    const first = keys.name_key.split(" ")[0];
    if (first.length >= 3) clauses.push(`name_key.like.${first} %`);
  }
  if (keys.website_domain) clauses.push(`website_domain.eq.${keys.website_domain}`);
  if (keys.email_domain) clauses.push(`email_domain.eq.${keys.email_domain}`);
  if (keys.phone_key) clauses.push(`phone_key.eq.${keys.phone_key}`);
  if (keys.address_key) clauses.push(`address_key.eq.${keys.address_key}`);
  if (clauses.length === 0) return [];

  const { data, error } = await db
    .from("crm_companies")
    .select("id, name, city, name_key, website_domain, email_domain, phone_key, address_key")
    .is("archived_at", null)
    .or(clauses.join(","))
    .limit(200);
  if (error) fail(error, "Could not check for duplicates");
  return (data ?? []) as ExistingCompany[];
}

export async function findDuplicateCompanies(keys: CompanyKeys, ignoreId?: string): Promise<DuplicateMatch[]> {
  return matchCompanies(keys, await candidateCompanies(createServiceClient(), keys), ignoreId);
}

async function findDuplicateContacts(db: Db, companyId: string, keys: { name_key: string; email_key: string | null; phone_key: string | null }, ignoreId?: string): Promise<ContactDuplicateMatch[]> {
  const clauses: string[] = [];
  if (keys.email_key) clauses.push(`email_key.eq.${keys.email_key.replace(/[,()]/g, "")}`);
  if (keys.phone_key) clauses.push(`phone_key.eq.${keys.phone_key}`);
  if (keys.name_key) clauses.push(`and(company_id.eq.${companyId},name_key.eq.${keys.name_key})`);
  if (clauses.length === 0) return [];

  const { data, error } = await db
    .from("crm_contacts")
    .select("id, full_name, company_id, name_key, email_key, phone_key, company:crm_companies(name)")
    .or(clauses.join(","))
    .limit(50);
  if (error) fail(error, "Could not check for duplicates");
  const existing: ExistingContact[] = (data ?? []).map((c: any) => ({ ...c, company_name: c.company?.name ?? null }));
  return matchContacts(keys, companyId, existing, ignoreId);
}

// ---------- companies ----------

/** Company ids with a contact that matches the search text, so searching a person's name finds their company. */
async function companyIdsForContactSearch(db: Db, term: string): Promise<string[]> {
  const digits = term.replace(/\D/g, "");
  const clauses = [`full_name.ilike.%${term}%`, `email.ilike.%${term}%`, `phone.ilike.%${term}%`, `job_title.ilike.%${term}%`];
  if (digits.length >= 4) clauses.push(`phone_key.ilike.%${digits}%`);
  const { data, error } = await db.from("crm_contacts").select("company_id").or(clauses.join(",")).limit(300);
  if (error) fail(error, "Could not search contacts");
  return Array.from(new Set((data ?? []).map((c: any) => c.company_id as string)));
}

export async function listCompanies(q: CompanyQuery): Promise<{ companies: CompanyRow[]; total: number }> {
  const db = createServiceClient();
  let query = db.from("crm_companies").select(COMPANY_SELECT, { count: "exact" }).is("archived_at", null);

  if (q.q) {
    const digits = q.q.replace(/\D/g, "");
    const clauses = [`name.ilike.%${q.q}%`, `city.ilike.%${q.q}%`, `email.ilike.%${q.q}%`, `address.ilike.%${q.q}%`, `phone.ilike.%${q.q}%`, `website.ilike.%${q.q}%`];
    if (digits.length >= 4) clauses.push(`phone_key.ilike.%${digits}%`);
    const ids = await companyIdsForContactSearch(db, q.q);
    if (ids.length) clauses.push(`id.in.(${ids.join(",")})`);
    query = query.or(clauses.join(","));
  }
  if (q.location) query = query.or(["city", "county", "address", "postcode"].map((f) => `${f}.ilike.%${q.location}%`).join(","));
  if (q.category_id) query = query.eq("category_id", q.category_id);
  if (q.stage_id) query = query.eq("stage_id", q.stage_id);
  if (q.assigned_to === "none") query = query.is("assigned_to", null);
  else if (q.assigned_to) query = query.eq("assigned_to", q.assigned_to);
  if (q.priority) query = query.eq("priority", q.priority);
  if (q.source) query = query.ilike("source", `%${q.source}%`);
  // "Not contacted since" includes companies that have never been contacted.
  if (q.contacted_before) query = query.or(`last_contacted_at.is.null,last_contacted_at.lt.${q.contacted_before}`);
  if (q.follow_up_before) query = query.lte("next_follow_up", q.follow_up_before);
  if (q.min_value !== null) query = query.gte("estimated_value", q.min_value);
  if (q.max_value !== null) query = query.lte("estimated_value", q.max_value);

  const from = (q.page - 1) * q.pageSize;
  const { data, count, error } = await query
    .order(q.sort, { ascending: q.dir === "asc", nullsFirst: false })
    .order("name")
    .order("id")
    .range(from, from + q.pageSize - 1);
  if (error) fail(error, "Could not load the companies");
  return { companies: (data ?? []).map(flatten), total: count ?? 0 };
}

export type StageHistoryRow = {
  id: string;
  from_stage: string | null;
  to_stage: string | null;
  user_email: string | null;
  outcome_note: string | null;
  won_value: number | null;
  created_at: string;
};

export type ContactRow = Contact & { assignee_email: string | null };

export async function getCompany(id: string): Promise<{ company: CompanyRow; contacts: ContactRow[]; history: StageHistoryRow[] } | null> {
  const db = createServiceClient();
  const { data, error } = await db.from("crm_companies").select(COMPANY_SELECT).eq("id", id).is("archived_at", null).maybeSingle();
  if (error) fail(error, "Could not load the company");
  if (!data) return null;

  const [contacts, history] = await Promise.all([
    db.from("crm_contacts").select("*, assignee:profiles!assigned_to(email)").eq("company_id", id).order("full_name"),
    db
      .from("crm_stage_history")
      .select("id, user_id, outcome_note, won_value, created_at, from_stage:crm_stages!from_stage_id(name), to_stage:crm_stages!to_stage_id(name)")
      .eq("company_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (contacts.error) fail(contacts.error, "Could not load the contacts");
  if (history.error) fail(history.error, "Could not load the history");

  const emails = await emailsFor(db, (history.data ?? []).map((h: any) => h.user_id));
  return {
    company: flatten(data),
    contacts: (contacts.data ?? []).map((c: any) => {
      const { name_key, email_key, phone_key, assignee, ...rest } = c;
      return { ...rest, assignee_email: assignee?.email ?? null } as ContactRow;
    }),
    history: (history.data ?? []).map((h: any) => ({
      id: h.id,
      from_stage: h.from_stage?.name ?? null,
      to_stage: h.to_stage?.name ?? null,
      user_email: emails.get(h.user_id) ?? null,
      outcome_note: h.outcome_note,
      won_value: h.won_value,
      created_at: h.created_at,
    })),
  };
}

export async function createCompany(
  input: Partial<CompanyFields>,
  userId: string,
  confirmDuplicate: boolean
): Promise<{ id: string } | { duplicates: DuplicateMatch[] }> {
  const db = createServiceClient();
  const keys = companyKeys(input);

  if (!confirmDuplicate) {
    const duplicates = matchCompanies(keys, await candidateCompanies(db, keys));
    if (duplicates.length > 0) return { duplicates };
  }

  // New companies start at the first working stage.
  const { data: first } = await db.from("crm_stages").select("id").eq("active", true).eq("kind", "open").order("sort_order").limit(1);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("crm_companies")
    .insert({ ...input, ...keys, stage_id: first?.[0]?.id ?? null, stage_changed_at: now, created_by: userId, updated_by: userId, updated_at: now })
    .select("id")
    .single();
  if (error) fail(error, "Could not save the company");
  await logEvent(db, userId, "company_created", "company", data.id, { duplicate_warning_overridden: confirmDuplicate });
  return { id: data.id };
}

/**
 * Saves changes to a company. `expectedUpdatedAt` is the version the person was looking at; if somebody else
 * has saved since, nothing is overwritten and the caller is told so.
 */
export async function updateCompany(
  id: string,
  input: Partial<CompanyFields>,
  expectedUpdatedAt: string | null,
  userId: string
): Promise<{ company: CompanyRow } | { notFound: true } | { conflict: true }> {
  const db = createServiceClient();
  const { data: current, error } = await db.from("crm_companies").select("*").eq("id", id).is("archived_at", null).maybeSingle();
  if (error) fail(error, "Could not load the company");
  if (!current) return { notFound: true };
  if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) return { conflict: true };

  const merged = { ...current, ...input };
  const keys = companyKeys(merged);
  const { data: saved, error: updateError } = await db
    .from("crm_companies")
    .update({ ...input, ...keys, updated_by: userId, updated_at: nextStamp(current.updated_at) })
    .eq("id", id)
    // Only if nobody saved between the read above and this write.
    .eq("updated_at", current.updated_at)
    .select("id");
  if (updateError) fail(updateError, "Could not save the company");
  if (!saved || saved.length === 0) return { conflict: true };

  await logEvent(db, userId, "company_updated", "company", id, { fields: Object.keys(input) });
  const fresh = await getCompany(id);
  return { company: fresh!.company };
}

export async function changeStage(id: string, change: StageChange, userId: string): Promise<{ company: CompanyRow } | { error: string; status: number }> {
  const db = createServiceClient();
  const [{ data: current }, { data: target }] = await Promise.all([
    db.from("crm_companies").select("id, stage_id").eq("id", id).is("archived_at", null).maybeSingle(),
    db.from("crm_stages").select("id, name, kind, active").eq("id", change.stage_id).maybeSingle(),
  ]);
  if (!current) return { error: "That company no longer exists", status: 404 };
  if (!target || !target.active) return { error: "That stage is not available", status: 400 };
  if (current.stage_id === target.id) return { error: "It is already at that stage", status: 400 };

  const closing = CLOSING_KINDS.includes(target.kind);
  if (closing && !change.confirmed) return { error: `Moving a company to ${target.name} needs to be confirmed`, status: 400 };

  const now = new Date().toISOString();
  // Value won is only ever recorded against a win, and the outcome notes only against a closed deal.
  const won_value = target.kind === "won" ? change.won_value : null;
  const outcome_note = closing ? change.outcome_note : null;

  const { error } = await db
    .from("crm_companies")
    .update({ stage_id: target.id, stage_changed_at: now, won_value, outcome_note, updated_by: userId, updated_at: now })
    .eq("id", id);
  if (error) fail(error, "Could not change the stage");

  const { error: historyError } = await db
    .from("crm_stage_history")
    .insert({ company_id: id, from_stage_id: current.stage_id, to_stage_id: target.id, user_id: userId, outcome_note, won_value });
  if (historyError) fail(historyError, "The stage changed but its history could not be recorded");

  await logEvent(db, userId, "stage_changed", "company", id, { to: target.name, kind: target.kind });
  const fresh = await getCompany(id);
  return { company: fresh!.company };
}

export async function bulkUpdate(change: BulkChange, userId: string): Promise<{ updated: number } | { error: string }> {
  if (!change.confirmed) return { error: "The change needs to be confirmed" };
  const db = createServiceClient();

  if (change.action === "assign" && change.value) {
    const { data } = await db.from("profiles").select("id").eq("id", change.value).in("role", STAFF_ROLES).maybeSingle();
    if (!data) return { error: "That person cannot be assigned companies" };
  }
  if (change.action === "category" && change.value) {
    const { data } = await db.from("crm_categories").select("id").eq("id", change.value).eq("active", true).maybeSingle();
    if (!data) return { error: "That category is not available" };
  }

  const patch = { [change.action === "assign" ? "assigned_to" : "category_id"]: change.value, updated_by: userId, updated_at: new Date().toISOString() };
  const { data, error } = await db.from("crm_companies").update(patch).in("id", change.ids).is("archived_at", null).select("id");
  if (error) fail(error, "Could not apply the change");
  await logEvent(db, userId, `bulk_${change.action}`, "company", null, { count: data?.length ?? 0 });
  return { updated: data?.length ?? 0 };
}

/** Hides a company from every list without deleting anything. */
export async function archiveCompany(id: string, userId: string): Promise<boolean> {
  const db = createServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await db.from("crm_companies").update({ archived_at: now, updated_by: userId, updated_at: now }).eq("id", id).is("archived_at", null).select("id");
  if (error) fail(error, "Could not archive the company");
  if (!data || data.length === 0) return false;
  await logEvent(db, userId, "company_archived", "company", id);
  return true;
}

/** Removes a company and its contacts for good, for when a business or a person asks for their details to be erased. */
export async function deleteCompany(id: string, userId: string): Promise<boolean> {
  const db = createServiceClient();
  const { data, error } = await db.from("crm_companies").delete().eq("id", id).select("id");
  if (error) fail(error, "Could not delete the company");
  if (!data || data.length === 0) return false;
  await logEvent(db, userId, "company_deleted", "company", id);
  return true;
}

// ---------- contacts ----------

export type ContactListRow = ContactRow & { company_name: string | null };

export async function listContacts(opts: { q: string; companyId?: string | null; page: number; pageSize: number }): Promise<{ contacts: ContactListRow[]; total: number }> {
  const db = createServiceClient();
  let query = db.from("crm_contacts").select("*, company:crm_companies!inner(name, archived_at), assignee:profiles!assigned_to(email)", { count: "exact" }).is("company.archived_at", null);

  if (opts.companyId) query = query.eq("company_id", opts.companyId);
  if (opts.q) {
    const digits = opts.q.replace(/\D/g, "");
    const clauses = [`full_name.ilike.%${opts.q}%`, `email.ilike.%${opts.q}%`, `phone.ilike.%${opts.q}%`, `job_title.ilike.%${opts.q}%`];
    if (digits.length >= 4) clauses.push(`phone_key.ilike.%${digits}%`);
    query = query.or(clauses.join(","));
  }
  const from = (opts.page - 1) * opts.pageSize;
  const { data, count, error } = await query.order("full_name").order("id").range(from, from + opts.pageSize - 1);
  if (error) fail(error, "Could not load the contacts");

  return {
    contacts: (data ?? []).map((c: any) => {
      const { name_key, email_key, phone_key, company, assignee, ...rest } = c;
      return { ...rest, company_name: company?.name ?? null, assignee_email: assignee?.email ?? null } as ContactListRow;
    }),
    total: count ?? 0,
  };
}

export async function createContact(
  input: Partial<ContactFields> & { company_id: string; full_name: string },
  userId: string,
  confirmDuplicate: boolean
): Promise<{ id: string } | { duplicates: ContactDuplicateMatch[] } | { notFound: true }> {
  const db = createServiceClient();
  const { data: company } = await db.from("crm_companies").select("id").eq("id", input.company_id).is("archived_at", null).maybeSingle();
  if (!company) return { notFound: true };

  const keys = contactKeys(input);
  if (!confirmDuplicate) {
    const duplicates = await findDuplicateContacts(db, input.company_id, keys);
    if (duplicates.length > 0) return { duplicates };
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("crm_contacts")
    .insert({ ...input, ...keys, created_by: userId, updated_by: userId, updated_at: now })
    .select("id")
    .single();
  if (error) fail(error, "Could not save the contact");
  await logEvent(db, userId, "contact_created", "contact", data.id, { duplicate_warning_overridden: confirmDuplicate });
  return { id: data.id };
}

export async function updateContact(
  id: string,
  input: Partial<ContactFields>,
  expectedUpdatedAt: string | null,
  userId: string
): Promise<{ ok: true; updated_at: string } | { notFound: true } | { conflict: true }> {
  const db = createServiceClient();
  const { data: current, error } = await db.from("crm_contacts").select("*").eq("id", id).maybeSingle();
  if (error) fail(error, "Could not load the contact");
  if (!current) return { notFound: true };
  if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) return { conflict: true };

  // A contact stays with its company; moving one is a separate decision.
  const { company_id: _ignored, ...changes } = input;
  const keys = contactKeys({ ...current, ...changes });
  const updated_at = nextStamp(current.updated_at);
  const { data: saved, error: updateError } = await db
    .from("crm_contacts")
    .update({ ...changes, ...keys, updated_by: userId, updated_at })
    .eq("id", id)
    .eq("updated_at", current.updated_at)
    .select("id");
  if (updateError) fail(updateError, "Could not save the contact");
  if (!saved || saved.length === 0) return { conflict: true };

  await logEvent(db, userId, "contact_updated", "contact", id, { fields: Object.keys(changes) });
  return { ok: true, updated_at };
}

export async function deleteContact(id: string, userId: string): Promise<boolean> {
  const db = createServiceClient();
  const { data, error } = await db.from("crm_contacts").delete().eq("id", id).select("id");
  if (error) fail(error, "Could not delete the contact");
  if (!data || data.length === 0) return false;
  await logEvent(db, userId, "contact_deleted", "contact", id);
  return true;
}

// ---------- pipeline ----------

export type StageSummary = { stage_id: string | null; count: number; estimated_total: number; won_total: number };

/**
 * How many companies are at each stage, with the estimated value of the open ones and the value actually won,
 * kept apart: an estimate is never counted as sales.
 */
export async function pipelineSummary(filters: { assigned_to: string | null; category_id: string | null }): Promise<StageSummary[]> {
  const db = createServiceClient();
  const rows = await fetchAllRows<{ stage_id: string | null; estimated_value: number | null; won_value: number | null }>((from, to) => {
    let q = db.from("crm_companies").select("id, stage_id, estimated_value, won_value").is("archived_at", null);
    if (filters.assigned_to === "none") q = q.is("assigned_to", null);
    else if (filters.assigned_to) q = q.eq("assigned_to", filters.assigned_to);
    if (filters.category_id) q = q.eq("category_id", filters.category_id);
    return q.order("id").range(from, to);
  });

  const byStage = new Map<string | null, StageSummary>();
  for (const r of rows) {
    const s = byStage.get(r.stage_id) ?? { stage_id: r.stage_id, count: 0, estimated_total: 0, won_total: 0 };
    s.count += 1;
    s.estimated_total += Number(r.estimated_value ?? 0);
    s.won_total += Number(r.won_value ?? 0);
    byStage.set(r.stage_id, s);
  }
  return Array.from(byStage.values());
}
