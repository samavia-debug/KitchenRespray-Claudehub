import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { COMPANY_SELECT, companyFilter, flatten, logEvent, fail, type CompanyRow } from "../service";
import type { CompanyQuery } from "../types";
import { buildXlsx, toCsv, type Cell } from "./files";

export const EXPORT_TYPES = ["companies", "contacts", "activities", "opportunities"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
export type ExportFormat = "csv" | "xlsx";

const MAX_EXPORT_ROWS = 20_000;

export type ExportTable = { headers: string[]; rows: Cell[][] };

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** A date as 2026-10-22, or a moment as 2026-10-22 14:30 (Irish time), so a sheet sorts and filters properly. */
function day(v: string | null | undefined): string {
  return v ? (v.length === 10 ? v : dateFmt.format(new Date(v))) : "";
}
function moment(v: string | null | undefined): string {
  return v ? `${dateFmt.format(new Date(v))} ${timeFmt.format(new Date(v))}` : "";
}
const money = (v: number | string | null | undefined): Cell => (v === null || v === undefined ? null : Number(v));
const details = (extra: Record<string, unknown> | null | undefined) => Object.entries(extra ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");

const COMPANY_HEADERS = [
  "Company", "Category", "Stage", "Priority", "Assigned to", "Telephone", "Mobile", "Email", "Website", "Address", "Town or city", "County", "Postcode", "Country",
  "Potential services", "Business description", "Estimated value (EUR, a guess)", "Value won (EUR)", "Source", "Last contacted", "Last activity", "Next follow-up",
  "Notes", "Imported details", "Contacts", "Added",
];

function companyRow(c: CompanyRow): Cell[] {
  return [
    c.name, c.category_name, c.stage_name, c.priority, c.assignee_email, c.phone, c.mobile, c.email, c.website, c.address, c.city, c.county, c.postcode, c.country,
    c.services, c.description, money(c.estimated_value), money(c.won_value), c.source, day(c.last_contacted_at), c.last_activity_type ? `${c.last_activity_type}, ${day(c.last_activity_at)}` : "", day(c.next_follow_up),
    c.notes, details(c.extra), c.contact_count, day(c.created_at),
  ];
}

/**
 * The data for an export. Companies can be exported by the same filters as the list ("what I am looking at"), or as a
 * chosen set of ids; the others are exported whole. Companies that have been archived are never included.
 */
export async function exportTable(type: ExportType, opts: { query?: CompanyQuery; ids?: string[] }, userId: string): Promise<ExportTable> {
  const db = createServiceClient();
  let table: ExportTable;

  if (type === "companies") {
    let rows: any[];
    if (opts.ids?.length) {
      const { data, error } = await db.from("crm_companies").select(COMPANY_SELECT).in("id", opts.ids).is("archived_at", null).order("name").order("id");
      if (error) fail(error, "Could not read the companies");
      rows = data ?? [];
    } else {
      const q = opts.query;
      const apply = q ? await companyFilter(db, q) : (x: any) => x;
      rows = await fetchAllRows<any>(
        (from, to) => apply(db.from("crm_companies").select(COMPANY_SELECT).is("archived_at", null)).order(q?.sort ?? "name", { ascending: (q?.dir ?? "asc") === "asc", nullsFirst: false }).order("name").order("id").range(from, to),
        1000,
        MAX_EXPORT_ROWS
      );
    }
    table = { headers: COMPANY_HEADERS, rows: rows.map((r) => companyRow(flatten(r))) };
  } else if (type === "contacts") {
    const rows = await fetchAllRows<any>(
      (from, to) => db.from("crm_contacts").select("*, company:crm_companies!inner(name, archived_at), assignee:profiles!assigned_to(email)").is("company.archived_at", null).order("full_name").order("id").range(from, to),
      1000,
      MAX_EXPORT_ROWS
    );
    table = {
      headers: ["Name", "Job title", "Company", "Email", "Phone", "Preferred contact method", "Source", "Assigned to", "Last contacted", "Next follow-up", "Notes", "Added"],
      rows: rows.map((c) => [c.full_name, c.job_title, c.company?.name, c.email, c.phone, c.preferred_method, c.source, c.assignee?.email, day(c.last_contacted_at), day(c.next_follow_up), c.notes, day(c.created_at)]),
    };
  } else if (type === "activities") {
    const rows = await fetchAllRows<any>(
      (from, to) =>
        db.from("crm_activities").select("*, company:crm_companies!inner(name, archived_at), contact:crm_contacts(full_name), user:profiles!user_id(email)").is("company.archived_at", null).order("occurred_at", { ascending: false }).order("id").range(from, to),
      1000,
      MAX_EXPORT_ROWS
    );
    table = {
      headers: ["When", "Activity", "Company", "Contact", "Done by", "Outcome", "Notes", "Next action", "Follow-up date"],
      rows: rows.map((a) => [moment(a.occurred_at), a.type, a.company?.name, a.contact?.full_name, a.user?.email, a.outcome, a.notes, a.next_action, day(a.next_follow_up)]),
    };
  } else {
    const rows = await fetchAllRows<any>(
      (from, to) => db.from("crm_opportunities").select("*, company:crm_companies!inner(name, archived_at), assignee:profiles!assigned_to(email)").is("company.archived_at", null).order("created_at", { ascending: false }).order("id").range(from, to),
      1000,
      MAX_EXPORT_ROWS
    );
    table = {
      headers: ["Company", "Opportunity", "Status", "Estimated value (EUR, a guess)", "Value won (EUR)", "Source", "Assigned to", "Details", "Outcome", "Status changed", "Added"],
      rows: rows.map((o) => [o.company?.name, o.title, o.status, money(o.estimated_value), money(o.won_value), o.source, o.assignee?.email, o.description, o.outcome_note, day(o.status_changed_at), day(o.created_at)]),
    };
  }

  // Who exported what, as counts. The trail never holds the data itself.
  await logEvent(db, userId, "exported", "export", null, { type, rows: table.rows.length, selected: !!opts.ids?.length, filtered: !!opts.query });
  return table;
}

export function exportFile(type: ExportType, format: ExportFormat, table: ExportTable, now: Date = new Date()): { filename: string; contentType: string; body: Buffer } {
  const stamp = dateFmt.format(now);
  if (format === "xlsx") {
    return {
      filename: `crm-${type}-${stamp}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: buildXlsx(type[0].toUpperCase() + type.slice(1), table.headers, table.rows),
    };
  }
  return { filename: `crm-${type}-${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: toCsv(table.headers, table.rows) };
}
