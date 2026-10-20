import { createServiceClient } from "@/lib/supabase/service";
import { dublinToday, dueRange } from "./followups";
import { fail, logEvent, nextStamp, STAFF_ROLES, type Db } from "./service";
import {
  CONTACT_ACTIVITY_TYPES,
  type Activity,
  type FollowUpView,
  type Opportunity,
  type OpportunityFields,
  type OpportunityStatus,
  type Task,
  type TaskFields,
} from "./types";
import { FOLLOW_UP_VIEWS } from "./types";
import type { CleanActivity, OpportunityStatusChange, TaskCompletion, TaskQuery } from "./validate";

const TASK_SELECT = "*, company:crm_companies!inner(name, archived_at, last_activity_type, last_activity_at), contact:crm_contacts(full_name), assignee:profiles!assigned_to(email)";

// ---------- shared checks ----------

/** True when `a` is a later moment than `b` (or `b` is not set). Compared as dates, as the database and JavaScript write times differently. */
function isLater(a: string, b: string | null | undefined, orEqual = false): boolean {
  if (!b) return true;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return orEqual ? x >= y : x > y;
}

async function isTeamMember(db: Db, id: string): Promise<boolean> {
  const { data } = await db.from("profiles").select("id").eq("id", id).in("role", STAFF_ROLES).maybeSingle();
  return !!data;
}

async function activeCompany(db: Db, id: string): Promise<boolean> {
  const { data } = await db.from("crm_companies").select("id").eq("id", id).is("archived_at", null).maybeSingle();
  return !!data;
}

/** A contact must belong to the company it is attached to. */
async function contactBelongs(db: Db, contactId: string, companyId: string): Promise<boolean> {
  const { data } = await db.from("crm_contacts").select("id").eq("id", contactId).eq("company_id", companyId).maybeSingle();
  return !!data;
}

/**
 * A company's (and a contact's) "next follow-up" is the earliest open task, so the date shown in lists and the
 * list of follow-ups can never disagree. Called after anything that adds, moves, completes or removes a task.
 */
async function syncNextFollowUp(db: Db, companyId: string, contactIds: (string | null | undefined)[] = []) {
  const earliest = async (column: "company_id" | "contact_id", id: string) => {
    const { data } = await db.from("crm_tasks").select("due_date").eq(column, id).eq("status", "open").order("due_date").limit(1);
    return (data?.[0]?.due_date as string | undefined) ?? null;
  };
  await db.from("crm_companies").update({ next_follow_up: await earliest("company_id", companyId) }).eq("id", companyId);
  for (const id of Array.from(new Set(contactIds.filter((c): c is string => !!c)))) {
    await db.from("crm_contacts").update({ next_follow_up: await earliest("contact_id", id) }).eq("id", id);
  }
}

/** Re-derives "last activity" and "last contacted" from what is recorded, after an activity is removed. */
async function recomputeLastActivity(db: Db, companyId: string) {
  const { data: latest } = await db.from("crm_activities").select("type, occurred_at").eq("company_id", companyId).order("occurred_at", { ascending: false }).limit(1);
  const { data: contacts } = await db.from("crm_activities").select("occurred_at").eq("company_id", companyId).in("type", CONTACT_ACTIVITY_TYPES).order("occurred_at", { ascending: false }).limit(1);
  await db
    .from("crm_companies")
    .update({ last_activity_type: latest?.[0]?.type ?? null, last_activity_at: latest?.[0]?.occurred_at ?? null, last_contacted_at: contacts?.[0]?.occurred_at ?? null })
    .eq("id", companyId);
}

// ---------- activities ----------

export type LogResult = { id: string; taskId: string | null } | { notFound: true } | { error: string };

/**
 * Records something a person did. It moves "last contacted" only for activities that are real contact, never
 * backwards when something is entered late, and creates a follow-up when a date is given.
 */
export async function logActivity(input: CleanActivity, userId: string): Promise<LogResult> {
  const db = createServiceClient();
  if (!(await activeCompany(db, input.company_id))) return { notFound: true };
  if (input.contact_id && !(await contactBelongs(db, input.contact_id, input.company_id))) return { error: "That contact does not belong to this company" };
  const doneBy = input.user_id ?? userId;
  if (doneBy !== userId && !(await isTeamMember(db, doneBy))) return { error: "That person cannot be recorded against an activity" };

  const occurred = input.occurred_at ?? new Date().toISOString();
  const { data, error } = await db
    .from("crm_activities")
    .insert({
      company_id: input.company_id,
      contact_id: input.contact_id ?? null,
      type: input.type,
      occurred_at: occurred,
      user_id: doneBy,
      outcome: input.outcome ?? null,
      notes: input.notes ?? null,
      next_action: input.next_action ?? null,
      next_follow_up: input.next_follow_up ?? null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) fail(error, "Could not save the activity");

  // Move the company's (and contact's) "last" markers forward, never back.
  const { data: company } = await db.from("crm_companies").select("last_activity_at, last_contacted_at").eq("id", input.company_id).maybeSingle();
  const patch: Record<string, unknown> = {};
  if (isLater(occurred, company?.last_activity_at, true)) {
    patch.last_activity_type = input.type;
    patch.last_activity_at = occurred;
  }
  const isContact = CONTACT_ACTIVITY_TYPES.includes(input.type);
  if (isContact && isLater(occurred, company?.last_contacted_at)) patch.last_contacted_at = occurred;
  if (Object.keys(patch).length) await db.from("crm_companies").update(patch).eq("id", input.company_id);

  if (isContact && input.contact_id) {
    const { data: contact } = await db.from("crm_contacts").select("last_contacted_at").eq("id", input.contact_id).maybeSingle();
    if (isLater(occurred, contact?.last_contacted_at)) await db.from("crm_contacts").update({ last_contacted_at: occurred }).eq("id", input.contact_id);
  }

  let taskId: string | null = null;
  if (input.next_follow_up) {
    const task = await db
      .from("crm_tasks")
      .insert({
        company_id: input.company_id,
        contact_id: input.contact_id ?? null,
        title: input.next_action ?? "Follow up",
        due_date: input.next_follow_up,
        assigned_to: doneBy,
        status: "open",
        source_activity_id: data.id,
        created_by: userId,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (task.error) fail(task.error, "The activity was saved but its follow-up could not be created");
    taskId = task.data.id;
    await syncNextFollowUp(db, input.company_id, [input.contact_id]);
  }

  await logEvent(db, userId, "activity_logged", "activity", data.id, { type: input.type, follow_up_created: !!taskId });
  return { id: data.id, taskId };
}

export async function listActivities(companyId: string, limit = 100): Promise<Activity[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("crm_activities")
    .select("*, contact:crm_contacts(full_name), user:profiles!user_id(email)")
    .eq("company_id", companyId)
    .order("occurred_at", { ascending: false })
    .order("id")
    .limit(limit);
  if (error) fail(error, "Could not load the activity history");
  return (data ?? []).map((a: any) => {
    const { contact, user, created_by, ...rest } = a;
    return { ...rest, contact_name: contact?.full_name ?? null, user_email: user?.email ?? null } as Activity;
  });
}

export async function deleteActivity(id: string, userId: string): Promise<boolean> {
  const db = createServiceClient();
  const { data, error } = await db.from("crm_activities").delete().eq("id", id).select("id, company_id");
  if (error) fail(error, "Could not delete the activity");
  if (!data || data.length === 0) return false;
  await recomputeLastActivity(db, data[0].company_id);
  await logEvent(db, userId, "activity_deleted", "activity", id);
  return true;
}

// ---------- follow-up tasks ----------

function toTask(row: any): Task {
  const { company, contact, assignee, created_by, updated_by, completed_by, source_activity_id, ...rest } = row;
  return {
    ...rest,
    company_name: company?.name ?? null,
    contact_name: contact?.full_name ?? null,
    assignee_email: assignee?.email ?? null,
    last_activity_type: company?.last_activity_type ?? null,
    last_activity_at: company?.last_activity_at ?? null,
  } as Task;
}

export async function createTask(input: Partial<TaskFields> & { company_id: string; title: string; due_date: string }, userId: string): Promise<{ id: string } | { notFound: true } | { error: string }> {
  const db = createServiceClient();
  if (!(await activeCompany(db, input.company_id))) return { notFound: true };
  if (input.contact_id && !(await contactBelongs(db, input.contact_id, input.company_id))) return { error: "That contact does not belong to this company" };
  // A follow-up always has an owner: whoever it was not given to is the person setting it.
  const owner = input.assigned_to ?? userId;
  if (owner !== userId && !(await isTeamMember(db, owner))) return { error: "That person cannot be assigned follow-ups" };

  const { data, error } = await db
    .from("crm_tasks")
    .insert({ company_id: input.company_id, contact_id: input.contact_id ?? null, title: input.title, due_date: input.due_date, assigned_to: owner, status: "open", created_by: userId, updated_by: userId, updated_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error) fail(error, "Could not save the follow-up");
  await syncNextFollowUp(db, input.company_id, [input.contact_id]);
  await logEvent(db, userId, "task_created", "task", data.id);
  return { id: data.id };
}

export async function updateTask(id: string, input: Partial<TaskFields>, userId: string): Promise<{ ok: true } | { notFound: true } | { error: string }> {
  const db = createServiceClient();
  const { data: current } = await db.from("crm_tasks").select("*").eq("id", id).eq("status", "open").maybeSingle();
  if (!current) return { notFound: true };
  if (input.assigned_to && input.assigned_to !== userId && !(await isTeamMember(db, input.assigned_to))) return { error: "That person cannot be assigned follow-ups" };
  if (input.contact_id && !(await contactBelongs(db, input.contact_id, current.company_id))) return { error: "That contact does not belong to this company" };

  // A follow-up stays with its company; only what it is, when it is due, who has it and who it is for can change.
  const { company_id: _ignored, ...changes } = input;
  const { data: saved, error } = await db
    .from("crm_tasks")
    .update({ ...changes, updated_by: userId, updated_at: nextStamp(current.updated_at) })
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (error) fail(error, "Could not save the follow-up");
  if (!saved || saved.length === 0) return { notFound: true };
  await syncNextFollowUp(db, current.company_id, [current.contact_id, input.contact_id]);
  await logEvent(db, userId, "task_updated", "task", id, { fields: Object.keys(changes) });
  return { ok: true };
}

export type CompleteResult = { ok: true; nextTaskId: string | null; activityId: string | null } | { notFound: true } | { error: string };

/**
 * Marks a follow-up done and records the result. It only adds an activity (a call made, an email sent) when the
 * person says so, and can set the next follow-up in the same step.
 */
export async function completeTask(id: string, completion: TaskCompletion, userId: string): Promise<CompleteResult> {
  const db = createServiceClient();
  const now = new Date().toISOString();
  // Only an open follow-up can be completed, and only once, even if two people click at the same moment.
  const { data: done, error } = await db
    .from("crm_tasks")
    .update({ status: "done", completed_at: now, completed_by: userId, result: completion.result, updated_by: userId, updated_at: now })
    .eq("id", id)
    .eq("status", "open")
    .select("id, company_id, contact_id, title, assigned_to");
  if (error) fail(error, "Could not complete the follow-up");
  if (!done || done.length === 0) return { notFound: true };
  const task = done[0];

  let activityId: string | null = null;
  if (completion.activity_type) {
    const logged = await logActivity({ company_id: task.company_id, contact_id: task.contact_id, type: completion.activity_type, outcome: completion.result ?? undefined, user_id: userId }, userId);
    if ("id" in logged) activityId = logged.id;
  }

  let nextTaskId: string | null = null;
  if (completion.next) {
    const created = await createTask(
      { company_id: task.company_id, contact_id: task.contact_id, title: completion.next.title ?? task.title, due_date: completion.next.due_date, assigned_to: completion.next.assigned_to ?? task.assigned_to ?? userId },
      userId
    );
    if ("id" in created) nextTaskId = created.id;
    else return { error: "The follow-up was completed but the next one could not be set. Add it again." };
  }
  await syncNextFollowUp(db, task.company_id, [task.contact_id]);
  await logEvent(db, userId, "task_completed", "task", id, { activity_recorded: !!activityId, next_set: !!nextTaskId });
  return { ok: true, nextTaskId, activityId };
}

/** Drops a follow-up that is no longer needed (it is kept as cancelled, not deleted). */
export async function cancelTask(id: string, userId: string): Promise<boolean> {
  const db = createServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await db.from("crm_tasks").update({ status: "cancelled", updated_by: userId, updated_at: now }).eq("id", id).eq("status", "open").select("id, company_id, contact_id");
  if (error) fail(error, "Could not cancel the follow-up");
  if (!data || data.length === 0) return false;
  await syncNextFollowUp(db, data[0].company_id, [data[0].contact_id]);
  await logEvent(db, userId, "task_cancelled", "task", id);
  return true;
}

function forView(db: Db, view: FollowUpView, today: string, assigned: string | null, withCount: boolean) {
  const range = dueRange(view, today);
  let q = db.from("crm_tasks").select(TASK_SELECT, withCount ? { count: "exact", head: false } : { count: "exact", head: true }).eq("status", range.status).is("company.archived_at", null);
  if (range.from) q = q.gte("due_date", range.from);
  if (range.to) q = q.lte("due_date", range.to);
  if (assigned === "none") q = q.is("assigned_to", null);
  else if (assigned) q = q.eq("assigned_to", assigned);
  return q;
}

export type FollowUpCounts = Record<FollowUpView, number>;

/** One list of follow-ups (overdue, today, this week, upcoming or completed), with how many are in each list. */
export async function listTasks(q: TaskQuery, today: string = dublinToday()): Promise<{ tasks: Task[]; total: number; counts: FollowUpCounts }> {
  const db = createServiceClient();
  const from = (q.page - 1) * q.pageSize;
  let list = forView(db, q.view, today, q.assigned_to, true);
  list = q.view === "completed" ? list.order("completed_at", { ascending: false }) : list.order("due_date").order("created_at");
  const { data, count, error } = await list.order("id").range(from, from + q.pageSize - 1);
  if (error) fail(error, "Could not load the follow-ups");

  const counts = {} as FollowUpCounts;
  await Promise.all(
    FOLLOW_UP_VIEWS.map(async (v) => {
      const r = await forView(db, v, today, q.assigned_to, false);
      if (r.error) fail(r.error, "Could not count the follow-ups");
      counts[v] = r.count ?? 0;
    })
  );
  return { tasks: (data ?? []).map(toTask), total: count ?? 0, counts };
}

/** What is still to do at one company, and the last few things that were done. */
export async function companyTasks(companyId: string): Promise<{ open: Task[]; done: Task[] }> {
  const db = createServiceClient();
  const [open, done] = await Promise.all([
    db.from("crm_tasks").select(TASK_SELECT).eq("company_id", companyId).eq("status", "open").order("due_date").order("id"),
    db.from("crm_tasks").select(TASK_SELECT).eq("company_id", companyId).eq("status", "done").order("completed_at", { ascending: false }).limit(10),
  ]);
  if (open.error) fail(open.error, "Could not load the follow-ups");
  if (done.error) fail(done.error, "Could not load the follow-ups");
  return { open: (open.data ?? []).map(toTask), done: (done.data ?? []).map(toTask) };
}

// ---------- opportunities ----------

function toOpportunity(row: any): Opportunity {
  const { assignee, created_by, updated_by, ...rest } = row;
  return { ...rest, assignee_email: assignee?.email ?? null } as Opportunity;
}

export async function listOpportunities(companyId: string): Promise<Opportunity[]> {
  const db = createServiceClient();
  const { data, error } = await db.from("crm_opportunities").select("*, assignee:profiles!assigned_to(email)").eq("company_id", companyId).order("created_at", { ascending: false }).order("id");
  if (error) fail(error, "Could not load the opportunities");
  return (data ?? []).map(toOpportunity);
}

export async function createOpportunity(input: Partial<OpportunityFields> & { company_id: string; title: string }, userId: string): Promise<{ id: string } | { notFound: true } | { error: string }> {
  const db = createServiceClient();
  if (!(await activeCompany(db, input.company_id))) return { notFound: true };
  if (input.assigned_to && input.assigned_to !== userId && !(await isTeamMember(db, input.assigned_to))) return { error: "That person cannot be assigned opportunities" };

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("crm_opportunities")
    .insert({ ...input, status: "identified", status_changed_at: now, created_by: userId, updated_by: userId, updated_at: now })
    .select("id")
    .single();
  if (error) fail(error, "Could not save the opportunity");
  await logEvent(db, userId, "opportunity_created", "opportunity", data.id);
  return { id: data.id };
}

export async function updateOpportunity(id: string, input: Partial<OpportunityFields>, expectedUpdatedAt: string | null, userId: string): Promise<{ ok: true } | { notFound: true } | { conflict: true } | { error: string }> {
  const db = createServiceClient();
  const { data: current, error } = await db.from("crm_opportunities").select("*").eq("id", id).maybeSingle();
  if (error) fail(error, "Could not load the opportunity");
  if (!current) return { notFound: true };
  if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) return { conflict: true };
  if (input.assigned_to && input.assigned_to !== userId && !(await isTeamMember(db, input.assigned_to))) return { error: "That person cannot be assigned opportunities" };

  const { company_id: _ignored, ...changes } = input;
  const { data: saved, error: updateError } = await db
    .from("crm_opportunities")
    .update({ ...changes, updated_by: userId, updated_at: nextStamp(current.updated_at) })
    .eq("id", id)
    .eq("updated_at", current.updated_at)
    .select("id");
  if (updateError) fail(updateError, "Could not save the opportunity");
  if (!saved || saved.length === 0) return { conflict: true };
  await logEvent(db, userId, "opportunity_updated", "opportunity", id, { fields: Object.keys(changes) });
  return { ok: true };
}

/**
 * Moves an opportunity along. Won and Lost close it and must be confirmed; the value won is recorded only
 * against a win, and reopening clears it, so an estimate is never mistaken for sales.
 */
export async function setOpportunityStatus(id: string, change: OpportunityStatusChange, userId: string): Promise<{ ok: true } | { notFound: true } | { error: string; status: number }> {
  const db = createServiceClient();
  const { data: current } = await db.from("crm_opportunities").select("id, status").eq("id", id).maybeSingle();
  if (!current) return { notFound: true };
  if (current.status === change.status) return { error: "It is already at that status", status: 400 };

  const closing = change.status === "won" || change.status === "lost";
  if (closing && !change.confirmed) return { error: `Marking an opportunity ${change.status} needs to be confirmed`, status: 400 };

  const now = new Date().toISOString();
  const { error } = await db
    .from("crm_opportunities")
    .update({
      status: change.status as OpportunityStatus,
      status_changed_at: now,
      won_value: change.status === "won" ? change.won_value : null,
      outcome_note: closing ? change.outcome_note : null,
      updated_by: userId,
      updated_at: now,
    })
    .eq("id", id);
  if (error) fail(error, "Could not change the status");
  await logEvent(db, userId, "opportunity_status", "opportunity", id, { to: change.status });
  return { ok: true };
}

export async function deleteOpportunity(id: string, userId: string): Promise<boolean> {
  const db = createServiceClient();
  const { data, error } = await db.from("crm_opportunities").delete().eq("id", id).select("id");
  if (error) fail(error, "Could not delete the opportunity");
  if (!data || data.length === 0) return false;
  await logEvent(db, userId, "opportunity_deleted", "opportunity", id);
  return true;
}
