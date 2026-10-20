import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { dublinToday } from "./followups";
import { resolveRange } from "./report-range";
import { buildReport, type ReportData, type ReportFilters, type ReportResult } from "./reports";
import { fail, STAFF_ROLES, type Db } from "./service";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The rows the overview and reports are built from. Only the columns they need, and only what the range calls for. */
async function loadData(db: Db, range: { startIso: string; endIso: string }): Promise<ReportData> {
  const [companies, stages, categories, people, activities, openTasks, doneTasks, stageHistory, opportunities, oppHistory] = await Promise.all([
    fetchAllRows<any>((from, to) =>
      db.from("crm_companies").select("id, name, category_id, assigned_to, created_by, created_at, stage_id, stage_changed_at, last_contacted_at, estimated_value, won_value").is("archived_at", null).order("id").range(from, to)
    ),
    db.from("crm_stages").select("id, name, kind, sort_order, active"),
    db.from("crm_categories").select("id, name, active"),
    db.from("profiles").select("id, email").in("role", STAFF_ROLES),
    fetchAllRows<any>((from, to) => db.from("crm_activities").select("id, company_id, type, occurred_at, user_id").gte("occurred_at", range.startIso).lt("occurred_at", range.endIso).order("id").range(from, to)),
    fetchAllRows<any>((from, to) => db.from("crm_tasks").select("id, company_id, title, due_date, assigned_to, status, completed_at, completed_by").eq("status", "open").order("id").range(from, to)),
    fetchAllRows<any>((from, to) =>
      db.from("crm_tasks").select("id, company_id, title, due_date, assigned_to, status, completed_at, completed_by").eq("status", "done").gte("completed_at", range.startIso).lt("completed_at", range.endIso).order("id").range(from, to)
    ),
    fetchAllRows<any>((from, to) => db.from("crm_stage_history").select("id, company_id, to_stage_id, created_at").order("id").range(from, to)),
    fetchAllRows<any>((from, to) =>
      db.from("crm_opportunities").select("id, company_id, title, status, status_changed_at, estimated_value, won_value, source, assigned_to, created_by, created_at").order("id").range(from, to)
    ),
    fetchAllRows<any>((from, to) => db.from("crm_opportunity_history").select("id, opportunity_id, to_status, created_at").order("id").range(from, to)),
  ]);
  for (const r of [stages, categories, people]) if (r.error) fail(r.error, "Could not load the report data");

  return {
    companies: companies.map((c) => ({ ...c, estimated_value: num(c.estimated_value), won_value: num(c.won_value) })),
    stages: (stages.data ?? []).map((s: any) => ({ ...s, sort_order: Number(s.sort_order) })),
    categories: categories.data ?? [],
    people: people.data ?? [],
    activities,
    tasks: [...openTasks, ...doneTasks],
    stageHistory,
    opportunities: opportunities.map((o) => ({ ...o, estimated_value: num(o.estimated_value), won_value: num(o.won_value) })),
    oppHistory,
  };
}

export type ReportRequest = { range: string | null; from: string | null; to: string | null; category_id: string | null; staff_id: string | null };

/**
 * The overview and reports for a date range, optionally for one category and one person. Everything is worked
 * out on the server from the records, so nothing on the page is a stored or typed-in figure.
 */
export async function loadReport(req: ReportRequest, today: string = dublinToday()): Promise<ReportResult | { error: string }> {
  const range = resolveRange(req.range, today, req.from, req.to);
  if ("error" in range) return range;
  const filters: ReportFilters = { category_id: req.category_id, staff_id: req.staff_id };
  const data = await loadData(createServiceClient(), range);
  return buildReport(data, range, filters, today);
}
