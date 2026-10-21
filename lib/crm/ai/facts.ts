import type { LetterSettings } from "@/lib/letters/layout";
import { personName } from "../names";
import type { ResolvedRange } from "../report-range";
import { buildReport, METRIC_INFO, type ReportData, type ReportFilters } from "../reports";
import type { Activity, Category, Opportunity, Task } from "../types";
import type { CompanyRow, ContactRow } from "../service";
import { clean } from "./text";

// What each AI feature is told. Each gets only what it needs. Phone numbers and email addresses are never sent for
// suggestions or sales questions (only whether they exist), and nothing is sent that the CRM does not hold.

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" });
export const dayOf = (iso: string | null | undefined): string | null => (iso ? (iso.length === 10 ? iso : dayFmt.format(new Date(iso))) : null);

export function daysBetween(from: string | null | undefined, to: string): number | null {
  const a = dayOf(from);
  if (!a) return null;
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

const money = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Values imported from a spreadsheet: shown to the AI as leads, never as facts. */
function importedDetails(extra: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra ?? {}).slice(0, 8)) if (typeof v === "string" && !k.startsWith("Not imported")) out[clean(k, 60)] = clean(v, 400);
  return out;
}

export type AiSettings = { about_us: string | null; intro_template: string | null; tone: string | null; avoid: string | null };

// ---------- next steps ----------

export function nextStepFacts(input: { company: CompanyRow; contacts: ContactRow[]; activities: Activity[]; open: Task[]; opportunities: Opportunity[]; today: string }) {
  const { company: c, today } = input;
  return {
    today,
    company: {
      name: clean(c.name, 160),
      category: c.category_name,
      stage: c.stage_name,
      stage_kind: c.stage_kind,
      priority: c.priority,
      city: c.city,
      county: c.county,
      source: clean(c.source, 120) || null,
      services: clean(c.services, 300) || null,
      added: dayOf(c.created_at),
      last_contacted: dayOf(c.last_contacted_at),
      days_since_contact: daysBetween(c.last_contacted_at, today),
      next_follow_up: c.next_follow_up,
      estimated_value_eur: money(c.estimated_value),
      assigned_to: c.assignee_email ? personName(c.assignee_email) : null,
    },
    can_be_reached_by: { phone: !!c.phone, mobile: !!c.mobile, email: !!c.email, website: !!c.website },
    contacts: input.contacts.slice(0, 10).map((p) => ({ name: clean(p.full_name, 100), job_title: clean(p.job_title, 80) || null, preferred_method: p.preferred_method, has_phone: !!p.phone, has_email: !!p.email })),
    recent_activity: input.activities.slice(0, 15).map((a) => ({
      date: dayOf(a.occurred_at),
      type: a.type,
      with: a.contact_name,
      by: a.user_email ? personName(a.user_email) : null,
      outcome: clean(a.outcome, 200) || null,
      notes: clean(a.notes, 300) || null,
      next_action: clean(a.next_action, 120) || null,
    })),
    open_follow_ups: input.open.slice(0, 10).map((t) => ({ what: clean(t.title, 160), due: t.due_date, overdue: t.due_date < today, about: t.contact_name })),
    opportunities: input.opportunities.slice(0, 10).map((o) => ({ title: clean(o.title, 120), status: o.status, estimate_eur: money(o.estimated_value), source: o.source, days_in_status: daysBetween(o.status_changed_at, today) })),
    imported_from_spreadsheet_unverified: importedDetails(c.extra),
  };
}

// ---------- drafting a message ----------

export function draftFacts(input: { company: CompanyRow; contact: ContactRow | null; activities: Activity[]; today: string; kind: "introduction" | "follow_up" }) {
  const { company: c, contact, today } = input;
  return {
    today,
    purpose: input.kind === "introduction" ? "A first introduction" : "A follow-up to earlier contact",
    prospect: {
      company: clean(c.name, 160),
      trade_or_category: c.category_name,
      services: clean(c.services, 300) || null,
      town: c.city,
      county: c.county,
    },
    // A description may have come from a spreadsheet's generated summary, so it is not stated as a fact.
    unverified_description: clean(c.description, 300) || null,
    recipient: contact ? { name: clean(contact.full_name, 100), job_title: clean(contact.job_title, 80) || null } : null,
    earlier_contact:
      input.kind === "follow_up"
        ? input.activities.slice(0, 3).map((a) => ({ date: dayOf(a.occurred_at), type: a.type, outcome: clean(a.outcome, 200) || null, notes: clean(a.notes, 200) || null }))
        : [],
  };
}

/** The offers running now where the prospect is, as the drafter may state them: exactly as written, never reworded here. */
export function currentOffers(specials: { title: string; offer: string; code: string | null; county: string | null; ends_on: string | null }[]) {
  return specials.slice(0, 3).map((s) => ({
    title: clean(s.title, 120),
    offer: clean(s.offer, 1000),
    code: clean(s.code, 40) || null,
    applies_in: s.county ?? "all counties",
    ends_on: s.ends_on,
  }));
}

export function ourCompanyFacts(l: Partial<LetterSettings>) {
  return {
    company_name: clean(l.company_name, 120) || "Kitchen Respray",
    phone: clean(l.phone, 40) || null,
    email: clean(l.email, 120) || null,
    website: clean(l.website, 120) || null,
    sender_name: clean(l.signatory_name, 100) || null,
    sender_title: clean(l.signatory_title, 100) || null,
  };
}

// ---------- research ----------

export function researchRecord(input: { company: CompanyRow; categories: Category[] }) {
  const c = input.company;
  const record = {
    name: clean(c.name, 160),
    current_category: c.category_name,
    website: c.website,
    town: c.city,
    county: c.county,
    address: clean(c.address, 200) || null,
    services: clean(c.services, 400) || null,
    description: clean(c.description, 500) || null,
    source: clean(c.source, 120) || null,
    notes: clean(c.notes, 500) || null,
    has: { phone: !!c.phone, mobile: !!c.mobile, email: !!c.email },
  };
  const imported = importedDetails(c.extra);
  return { record, imported, categoryNames: input.categories.filter((x) => x.active).map((x) => x.name) };
}

// ---------- sales questions ----------

const PERIOD_METRICS = ["newProspects", "contactsMade", "companiesContacted", "followUpsCompleted", "becameInterested", "opportunities", "quotesRequested", "quotesSent", "dealsWon", "dealsLost"] as const;

/**
 * Everything a sales question might need, from the CRM's own records: the figures for the chosen period and the usual
 * comparison periods, and today's lists (not yet contacted, overdue, interested, open opportunities, who to prioritise).
 * Lists are capped; the totals are not, and the pack says how many were left out.
 */
export function buildSalesPack(data: ReportData, today: string, filters: ReportFilters, ranges: ResolvedRange[]) {
  const catName = (id: string | null) => (id ? data.categories.find((x) => x.id === id)?.name ?? null : null);
  const person = (id: string | null | undefined) => (id ? personName(data.people.find((p) => p.id === id)?.email) : null);
  const stage = (id: string | null) => (id ? data.stages.find((s) => s.id === id) : undefined);
  const company = new Map(data.companies.map((c) => [c.id, c]));

  const periods = ranges.map((range) => {
    const r = buildReport(data, range, filters, today);
    const figures: Record<string, number> = {};
    for (const k of PERIOD_METRICS) figures[METRIC_INFO[k].label] = r.metrics[k].value;
    figures["Confirmed sales (EUR, recorded values only)"] = r.sales.confirmedValue;
    return {
      period: range.label,
      from: range.from,
      to: range.to,
      figures,
      by_category: r.byCategory.map((x) => ({ category: x.label, added: x.added, contacts_made: x.contactsMade, companies_contacted: x.contacted, opportunities: x.opportunities, quotes_sent: x.quotesSent, won: x.won, lost: x.lost, confirmed_sales_eur: x.wonValue })),
      by_person: r.byStaff.map((x) => ({ person: x.label, prospects_added: x.added, contacts_made: x.contactsMade, companies_contacted: x.contacted, follow_ups_completed: x.followUpsCompleted, opportunities: x.opportunities, quotes_sent: x.quotesSent, won: x.won, confirmed_sales_eur: x.wonValue })),
      confirmed_sales_by_source: r.sales.bySource.map((s) => ({ source: s.source, deals: s.count, eur: s.value })),
      notes: [...r.notes, ...r.funnelNotes],
    };
  });

  const inScope = (c: ReportData["companies"][number]) => (filters.category_id === null || (filters.category_id === "__none__" ? c.category_id === null : c.category_id === filters.category_id)) && (filters.staff_id === null || c.assigned_to === filters.staff_id);
  const open = data.companies.filter((c) => inScope(c) && (stage(c.stage_id)?.kind ?? "open") === "open");
  const weight: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
  const LIST = 25;
  const cap = <T,>(xs: T[], n = LIST) => ({ shown: xs.slice(0, n), total: xs.length, left_out: Math.max(0, xs.length - n) });

  const awaiting = open
    .filter((c) => !c.last_contacted_at)
    .sort((a, b) => (weight[b.priority ?? "Medium"] ?? 2) - (weight[a.priority ?? "Medium"] ?? 2) || Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((c) => ({ company: clean(c.name, 100), category: catName(c.category_id), priority: c.priority ?? null, stage: stage(c.stage_id)?.name ?? null, added: dayOf(c.created_at), assigned_to: person(c.assigned_to) }));

  const openTasks = data.tasks.filter((t) => t.status === "open" && company.get(t.company_id) && inScope(company.get(t.company_id)!));
  const overdue = openTasks.filter((t) => t.due_date < today).sort((a, b) => (a.due_date < b.due_date ? -1 : 1)).map((t) => ({ company: clean(company.get(t.company_id)!.name, 100), follow_up: clean(t.title, 120), due: t.due_date, days_overdue: daysBetween(t.due_date, today), assigned_to: person(t.assigned_to) }));
  const dueToday = openTasks.filter((t) => t.due_date === today).map((t) => ({ company: clean(company.get(t.company_id)!.name, 100), follow_up: clean(t.title, 120), assigned_to: person(t.assigned_to) }));

  const interestedStage = data.stages.find((s) => s.name.trim().toLowerCase() === "interested");
  const interested = interestedStage
    ? data.companies.filter((c) => inScope(c) && c.stage_id === interestedStage.id).map((c) => ({ company: clean(c.name, 100), category: catName(c.category_id), priority: c.priority ?? null, last_contacted: dayOf(c.last_contacted_at), next_follow_up: c.next_follow_up ?? null, estimate_eur: money(c.estimated_value) }))
    : [];

  const openOpps = data.opportunities
    .filter((o) => ["identified", "quote_requested", "quote_sent"].includes(o.status) && company.get(o.company_id) && inScope(company.get(o.company_id)!))
    .map((o) => ({ company: clean(company.get(o.company_id)!.name, 100), opportunity: clean(o.title, 100), status: o.status, estimate_eur: money(o.estimated_value), source: o.source, handled_by: person(o.assigned_to ?? o.created_by) }));

  const candidates = [...open]
    .sort(
      (a, b) =>
        (weight[b.priority ?? "Medium"] ?? 2) - (weight[a.priority ?? "Medium"] ?? 2) ||
        (stage(b.stage_id)?.sort_order ?? 0) - (stage(a.stage_id)?.sort_order ?? 0) ||
        (Date.parse(a.last_contacted_at ?? "1970-01-01") - Date.parse(b.last_contacted_at ?? "1970-01-01"))
    )
    .map((c) => ({ company: clean(c.name, 100), category: catName(c.category_id), priority: c.priority ?? null, stage: stage(c.stage_id)?.name ?? null, last_contacted: dayOf(c.last_contacted_at) ?? "never", next_follow_up: c.next_follow_up ?? null, estimate_eur: money(c.estimated_value), assigned_to: person(c.assigned_to) }));

  return {
    as_of: today,
    filters_applied: { category: filters.category_id === null ? "all" : filters.category_id === "__none__" ? "no category" : catName(filters.category_id), person: filters.staff_id ? person(filters.staff_id) : "everyone" },
    how_figures_are_counted: Object.fromEntries((["contactsMade", "companiesContacted", "opportunities", "quotesSent", "dealsWon", "salesValue", "awaitingContact", "interested"] as const).map((k) => [METRIC_INFO[k].label, METRIC_INFO[k].hint])),
    periods,
    today: {
      companies_in_scope: data.companies.filter(inScope).length,
      open_prospects: open.length,
      not_yet_contacted: cap(awaiting),
      overdue_follow_ups: cap(overdue),
      due_today: cap(dueToday),
      interested_now: cap(interested),
      open_opportunities: cap(openOpps),
      open_prospects_for_prioritising: cap(candidates, 40),
    },
  };
}
