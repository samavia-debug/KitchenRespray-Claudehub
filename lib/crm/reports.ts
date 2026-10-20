import { addDays } from "./followups";
import { personName } from "./names";
import { eachDay, type ResolvedRange } from "./report-range";
import { ACTIVITY_TYPES, CONTACT_ACTIVITY_TYPES, OPPORTUNITY_SOURCES, type ActivityType, type OpportunityStatus, type StageKind } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Everything the overview and reports show is worked out here from plain rows, so it can be tested without a database.
//
// How things are counted (the same words are shown on the page):
// - Activity counts are things people recorded: calls, emails, meetings. Nothing is counted that nobody recorded.
// - Estimated values are guesses (an open opportunity's estimate) and are never added to sales.
// - Confirmed sales are only values recorded when a deal was marked Won. A win is counted once: a won opportunity, or
//   a company marked Won that has no won opportunity of its own.
// - A sale is credited to direct prospecting only when its opportunity says so. A company marked Won with no
//   opportunity has no source, so it is "Not recorded".
// - A percentage is only shown when there is enough behind it, never to fill a gap.
// ---------------------------------------------------------------------------------------------------------------------

/** Fewer companies or opportunities than this and conversion percentages are withheld. */
export const MIN_COHORT = 10;
/** Fewer closed (won or lost) deals than this and a win rate is withheld. */
export const MIN_CLOSED = 5;
/** How many records are sent with each metric for "click to see the records". */
export const DRILL_CAP = 200;
const TREND_DAYS_LIMIT = 62;

export type RCompany = {
  id: string;
  name: string;
  category_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  stage_id: string | null;
  stage_changed_at: string | null;
  last_contacted_at: string | null;
  estimated_value: number | null;
  won_value: number | null;
};
export type RStage = { id: string; name: string; kind: StageKind; sort_order: number; active: boolean };
export type RCategory = { id: string; name: string; active: boolean };
export type RPerson = { id: string; email: string };
export type RActivity = { id: string; company_id: string; type: ActivityType; occurred_at: string; user_id: string | null };
export type RTask = { id: string; company_id: string; title: string; due_date: string; assigned_to: string | null; status: "open" | "done" | "cancelled"; completed_at: string | null; completed_by: string | null };
export type RStageHistory = { company_id: string; to_stage_id: string | null; created_at: string };
export type ROpportunity = {
  id: string;
  company_id: string;
  title: string;
  status: OpportunityStatus;
  status_changed_at: string;
  estimated_value: number | null;
  won_value: number | null;
  source: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
};
export type ROppHistory = { opportunity_id: string; to_status: OpportunityStatus; created_at: string };

export type ReportData = {
  companies: RCompany[];
  stages: RStage[];
  categories: RCategory[];
  people: RPerson[];
  /** Activities within the range. */
  activities: RActivity[];
  /** Every open follow-up, and the ones completed within the range. */
  tasks: RTask[];
  stageHistory: RStageHistory[];
  opportunities: ROpportunity[];
  oppHistory: ROppHistory[];
};

export type ReportFilters = { category_id: string | null; staff_id: string | null };

export type MetricKey =
  | "totalCompanies"
  | "newProspects"
  | "awaitingContact"
  | "contactsMade"
  | "companiesContacted"
  | "followUpsCompleted"
  | "dueToday"
  | "overdue"
  | "interested"
  | "becameInterested"
  | "opportunities"
  | "quotesRequested"
  | "quotesSent"
  | "dealsWon"
  | "dealsLost"
  | "salesValue";

export const METRIC_INFO: Record<MetricKey, { label: string; hint: string }> = {
  totalCompanies: { label: "Companies in the database", hint: "Every company that has not been archived." },
  newProspects: { label: "New prospects added", hint: "Companies added in the period." },
  awaitingContact: { label: "Awaiting contact", hint: "Open prospects nobody has contacted yet." },
  contactsMade: { label: "Contacts made", hint: "Calls, emails, meetings, visits and other contact that someone recorded in the period." },
  companiesContacted: { label: "Companies contacted", hint: "Different companies reached in the period." },
  followUpsCompleted: { label: "Follow-ups completed", hint: "Follow-ups marked done in the period." },
  dueToday: { label: "Follow-ups due today", hint: "Open follow-ups due today." },
  overdue: { label: "Overdue follow-ups", hint: "Open follow-ups that were due before today." },
  interested: { label: "Interested prospects", hint: "Companies at the Interested stage now." },
  becameInterested: { label: "Became interested", hint: "Companies moved to the Interested stage in the period." },
  opportunities: { label: "Opportunities identified", hint: "Opportunities added in the period." },
  quotesRequested: { label: "Quotes requested", hint: "Opportunities that reached Quote requested in the period." },
  quotesSent: { label: "Quotes sent", hint: "Opportunities that reached Quote sent in the period." },
  dealsWon: { label: "Deals won", hint: "Opportunities marked Won in the period, plus companies marked Won that have no opportunity." },
  dealsLost: { label: "Deals lost", hint: "Opportunities marked Lost in the period, plus companies marked Lost that have no opportunity." },
  salesValue: { label: "Confirmed sales", hint: "The value recorded on deals won in the period. Estimates are never included." },
};

export type DrillRow = { companyId: string; company: string; detail: string; who: string | null; at: string | null };
export type MetricValue = { value: number; money?: number; rows: DrillRow[]; total: number; note?: string };

export type CountRow = {
  key: string;
  label: string;
  added: number;
  contacted: number;
  contactsMade: number;
  followUpsCompleted: number;
  opportunities: number;
  quotesSent: number;
  won: number;
  lost: number;
  wonValue: number;
  /** Won out of won plus lost, or null when there are too few closed deals to say. */
  winRate: number | null;
};

export type FunnelStep = { key: string; label: string; count: number; share: number | null };

export type ReportResult = {
  range: { from: string; to: string; label: string };
  filters: ReportFilters;
  metrics: Record<MetricKey, MetricValue>;
  sales: {
    confirmedValue: number;
    wonCount: number;
    wonWithoutValue: number;
    fromOpportunities: { count: number; value: number };
    fromCompanies: { count: number; value: number };
    bySource: { source: string; count: number; value: number }[];
    openEstimate: { count: number; value: number };
    openByStatus: { status: OpportunityStatus; count: number; estimate: number }[];
  };
  trend: { bucket: "day" | "week"; points: { date: string; added: number; contacts: number }[] };
  activityByType: { type: ActivityType; count: number }[];
  byCategory: CountRow[];
  byStaff: CountRow[];
  funnel: { cohort: number; enough: boolean; steps: FunnelStep[] };
  opportunityFunnel: { cohort: number; enough: boolean; steps: FunnelStep[] };
  pipeline: { stageId: string; name: string; kind: StageKind; count: number; estimate: number }[];
  nextFollowUps: { id: string; companyId: string; company: string; title: string; due: string; overdue: boolean; assignee: string | null }[];
  /** Things worth knowing about the figures, such as a missing value. */
  notes: string[];
  /** Why a conversion percentage is not shown (too few to base it on). Only the reports page needs these. */
  funnelNotes: string[];
};

const NO_CATEGORY = "__none__";
const OPEN_OPP: OpportunityStatus[] = ["identified", "quote_requested", "quote_sent"];

type Index = {
  company: Map<string, RCompany>;
  stage: Map<string, RStage>;
  interested: RStage | null;
  oppsOf: Map<string, ROpportunity[]>;
  historyOf: Map<string, ROppHistory[]>;
  stageHistoryOf: Map<string, RStageHistory[]>;
  name: Map<string, string>;
};

function buildIndex(d: ReportData): Index {
  const company = new Map(d.companies.map((c) => [c.id, c]));
  const oppsOf = new Map<string, ROpportunity[]>();
  d.opportunities.forEach((o) => oppsOf.set(o.company_id, [...(oppsOf.get(o.company_id) ?? []), o]));
  const historyOf = new Map<string, ROppHistory[]>();
  d.oppHistory.forEach((h) => historyOf.set(h.opportunity_id, [...(historyOf.get(h.opportunity_id) ?? []), h]));
  const stageHistoryOf = new Map<string, RStageHistory[]>();
  d.stageHistory.forEach((h) => stageHistoryOf.set(h.company_id, [...(stageHistoryOf.get(h.company_id) ?? []), h]));
  return {
    company,
    stage: new Map(d.stages.map((s) => [s.id, s])),
    interested: d.stages.find((s) => s.name.trim().toLowerCase() === "interested") ?? null,
    oppsOf,
    historyOf,
    stageHistoryOf,
    name: new Map(d.people.map((p) => [p.id, personName(p.email)])),
  };
}

type Deal = DrillRow & { value: number | null; source: string | null; origin: "opportunity" | "company" };

type Collected = Record<Exclude<MetricKey, "salesValue" | "dealsWon" | "dealsLost">, DrillRow[]> & { dealsWon: Deal[]; dealsLost: DrillRow[] };

/**
 * Gathers the records behind every metric for one category and one person. The overall figures, each row of the
 * category table and each row of the staff table are all this function with different arguments, so they always agree.
 */
function collect(d: ReportData, ix: Index, range: ResolvedRange, today: string, ctx: { category: string | null; staff: string | null }): Collected {
  const startMs = Date.parse(range.startIso);
  const endMs = Date.parse(range.endIso);
  const within = (iso: string | null | undefined) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return t >= startMs && t < endMs;
  };
  const who = (id: string | null | undefined) => (id ? ix.name.get(id) ?? null : null);
  const catOk = (c: RCompany | undefined) => !!c && (ctx.category === null || (ctx.category === NO_CATEGORY ? c.category_id === null : c.category_id === ctx.category));
  const staffIs = (id: string | null | undefined) => ctx.staff === null || id === ctx.staff;
  const row = (c: RCompany, detail: string, by: string | null, at: string | null): DrillRow => ({ companyId: c.id, company: c.name, detail, who: who(by), at });
  const kindOf = (c: RCompany): StageKind => (c.stage_id ? ix.stage.get(c.stage_id)?.kind ?? "open" : "open");
  // The person handling an opportunity: whoever it is assigned to, otherwise whoever added it.
  const ownerOf = (o: ROpportunity) => o.assigned_to ?? o.created_by;

  const out: Collected = {
    totalCompanies: [], newProspects: [], awaitingContact: [], contactsMade: [], companiesContacted: [], followUpsCompleted: [], dueToday: [], overdue: [],
    interested: [], becameInterested: [], opportunities: [], quotesRequested: [], quotesSent: [], dealsWon: [], dealsLost: [],
  };

  for (const c of d.companies) {
    if (!catOk(c)) continue;
    if (staffIs(c.assigned_to)) {
      out.totalCompanies.push(row(c, c.stage_id ? ix.stage.get(c.stage_id)?.name ?? "" : "", c.assigned_to, c.created_at));
      if (kindOf(c) === "open" && !c.last_contacted_at) out.awaitingContact.push(row(c, "Not contacted yet", c.assigned_to, c.created_at));
      if (ix.interested && c.stage_id === ix.interested.id) out.interested.push(row(c, "Interested", c.assigned_to, c.stage_changed_at));
    }
    if (within(c.created_at) && staffIs(c.created_by)) out.newProspects.push(row(c, "Added", c.created_by, c.created_at));
  }

  // Companies that moved to the Interested stage in the period (each counted once, at its latest move in the period).
  if (ix.interested) {
    ix.stageHistoryOf.forEach((events, companyId) => {
      const c = ix.company.get(companyId);
      if (!catOk(c) || !staffIs(c!.assigned_to)) return;
      const hit = events.filter((e) => e.to_stage_id === ix.interested!.id && within(e.created_at)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      if (hit) out.becameInterested.push(row(c!, "Moved to Interested", c!.assigned_to, hit.created_at));
    });
  }

  const perCompany = new Map<string, { count: number; last: RActivity }>();
  for (const a of d.activities) {
    const c = ix.company.get(a.company_id);
    if (!catOk(c) || !within(a.occurred_at) || !staffIs(a.user_id) || !CONTACT_ACTIVITY_TYPES.includes(a.type)) continue;
    out.contactsMade.push(row(c!, a.type, a.user_id, a.occurred_at));
    const seen = perCompany.get(a.company_id);
    perCompany.set(a.company_id, { count: (seen?.count ?? 0) + 1, last: !seen || Date.parse(a.occurred_at) > Date.parse(seen.last.occurred_at) ? a : seen.last });
  }
  perCompany.forEach((v, companyId) => out.companiesContacted.push(row(ix.company.get(companyId)!, v.count === 1 ? "1 contact" : `${v.count} contacts`, v.last.user_id, v.last.occurred_at)));

  for (const t of d.tasks) {
    const c = ix.company.get(t.company_id);
    if (!catOk(c)) continue;
    if (t.status === "done" && within(t.completed_at) && staffIs(t.completed_by)) out.followUpsCompleted.push(row(c!, t.title, t.completed_by, t.completed_at));
    if (t.status === "open" && staffIs(t.assigned_to)) {
      if (t.due_date === today) out.dueToday.push(row(c!, t.title, t.assigned_to, t.due_date));
      else if (t.due_date < today) out.overdue.push(row(c!, t.title, t.assigned_to, t.due_date));
    }
  }

  for (const o of d.opportunities) {
    const c = ix.company.get(o.company_id);
    if (!catOk(c) || !staffIs(ownerOf(o))) continue;
    if (within(o.created_at)) out.opportunities.push(row(c!, o.title, ownerOf(o), o.created_at));
    const reached = (status: OpportunityStatus) => (ix.historyOf.get(o.id) ?? []).filter((h) => h.to_status === status && within(h.created_at)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    const requested = reached("quote_requested");
    if (requested) out.quotesRequested.push(row(c!, o.title, ownerOf(o), requested.created_at));
    const sent = reached("quote_sent");
    if (sent) out.quotesSent.push(row(c!, o.title, ownerOf(o), sent.created_at));
    if (o.status === "won" && within(o.status_changed_at)) out.dealsWon.push({ ...row(c!, o.title, ownerOf(o), o.status_changed_at), value: o.won_value, source: o.source, origin: "opportunity" });
    if (o.status === "lost" && within(o.status_changed_at)) out.dealsLost.push(row(c!, o.title, ownerOf(o), o.status_changed_at));
  }

  // A company marked Won or Lost that has no opportunity of its own counts as a deal, once.
  for (const c of d.companies) {
    if (!catOk(c) || !staffIs(c.assigned_to) || !within(c.stage_changed_at)) continue;
    const opps = ix.oppsOf.get(c.id) ?? [];
    if (kindOf(c) === "won" && !opps.some((o) => o.status === "won")) out.dealsWon.push({ ...row(c, "Company marked Won", c.assigned_to, c.stage_changed_at), value: c.won_value, source: null, origin: "company" });
    if (kindOf(c) === "lost" && opps.length === 0) out.dealsLost.push(row(c, "Company marked Lost", c.assigned_to, c.stage_changed_at));
  }

  return out;
}

const sumValue = (deals: Deal[]) => deals.reduce((n, x) => n + (x.value ?? 0), 0);
const cap = (rows: DrillRow[]): DrillRow[] => rows.slice(0, DRILL_CAP);
const byRecent = (a: DrillRow, b: DrillRow) => Date.parse(b.at ?? "") - Date.parse(a.at ?? "") || 0;

function toMetric(rows: DrillRow[], recent = true): MetricValue {
  const sorted = recent ? [...rows].sort(byRecent) : rows;
  return { value: rows.length, rows: cap(sorted), total: rows.length };
}

function countRow(key: string, label: string, c: Collected): CountRow {
  const wonValue = sumValue(c.dealsWon);
  const closed = c.dealsWon.length + c.dealsLost.length;
  return {
    key,
    label,
    added: c.newProspects.length,
    contacted: c.companiesContacted.length,
    contactsMade: c.contactsMade.length,
    followUpsCompleted: c.followUpsCompleted.length,
    opportunities: c.opportunities.length,
    quotesSent: c.quotesSent.length,
    won: c.dealsWon.length,
    lost: c.dealsLost.length,
    wonValue,
    winRate: closed >= MIN_CLOSED ? c.dealsWon.length / closed : null,
  };
}

/**
 * The overview and every report, for one date range and, optionally, one category and one person.
 *
 * With a person chosen, each figure is that person's own work: activities they did, prospects they added, follow-ups
 * they completed, opportunities they handle, and companies, follow-ups and deals assigned to them.
 */
export function buildReport(d: ReportData, range: ResolvedRange, filters: ReportFilters, today: string): ReportResult {
  const ix = buildIndex(d);
  const ctx = { category: filters.category_id, staff: filters.staff_id };
  const c = collect(d, ix, range, today, ctx);
  const notes: string[] = [];
  const funnelNotes: string[] = [];

  const wonValue = sumValue(c.dealsWon);
  const wonWithoutValue = c.dealsWon.filter((x) => x.value === null).length;
  if (wonWithoutValue > 0) notes.push(`${wonWithoutValue} won deal${wonWithoutValue === 1 ? " has" : "s have"} no value recorded, so confirmed sales is understated.`);
  if (!ix.interested) notes.push('No stage is called "Interested", so interested prospects cannot be counted. Rename a stage to Interested in Settings to turn this on.');

  const metrics = {
    totalCompanies: toMetric(c.totalCompanies, false),
    newProspects: toMetric(c.newProspects),
    awaitingContact: toMetric(c.awaitingContact),
    contactsMade: toMetric(c.contactsMade),
    companiesContacted: toMetric(c.companiesContacted),
    followUpsCompleted: toMetric(c.followUpsCompleted),
    dueToday: toMetric(c.dueToday, false),
    overdue: toMetric([...c.overdue].sort((a, b) => (a.at ?? "") < (b.at ?? "") ? -1 : 1), false),
    interested: { ...toMetric(c.interested), ...(ix.interested ? {} : { note: 'No stage is called "Interested".' }) },
    becameInterested: toMetric(c.becameInterested),
    opportunities: toMetric(c.opportunities),
    quotesRequested: toMetric(c.quotesRequested),
    quotesSent: toMetric(c.quotesSent),
    dealsWon: { ...toMetric(c.dealsWon.map((x) => ({ ...x, detail: `${x.detail}${x.value !== null ? `: €${x.value.toLocaleString("en-IE")}` : ", no value recorded"}` }))), money: wonValue },
    dealsLost: toMetric(c.dealsLost),
    salesValue: { value: wonValue, money: wonValue, rows: cap([...c.dealsWon].filter((x) => x.value !== null).sort(byRecent).map((x) => ({ ...x, detail: `${x.detail}: €${(x.value ?? 0).toLocaleString("en-IE")}` }))), total: c.dealsWon.filter((x) => x.value !== null).length },
  } as Record<MetricKey, MetricValue>;

  // Sales: confirmed, by where each came from, and the open estimate kept apart.
  const sourceTotals = new Map<string, { count: number; value: number }>();
  c.dealsWon.forEach((x) => {
    const label = x.source ?? "Not recorded";
    const t = sourceTotals.get(label) ?? { count: 0, value: 0 };
    sourceTotals.set(label, { count: t.count + 1, value: t.value + (x.value ?? 0) });
  });
  const sourceOrder = [...OPPORTUNITY_SOURCES, "Not recorded"] as string[];
  const bySource = sourceOrder.filter((s) => sourceTotals.has(s)).map((s) => ({ source: s, ...sourceTotals.get(s)! }));

  const openOpps = d.opportunities.filter((o) => {
    const co = ix.company.get(o.company_id);
    const ownerOk = filters.staff_id === null || (o.assigned_to ?? o.created_by) === filters.staff_id;
    const catOk = filters.category_id === null || (filters.category_id === NO_CATEGORY ? co?.category_id === null : co?.category_id === filters.category_id);
    return !!co && ownerOk && catOk && OPEN_OPP.includes(o.status);
  });
  const sales = {
    confirmedValue: wonValue,
    wonCount: c.dealsWon.length,
    wonWithoutValue,
    fromOpportunities: { count: c.dealsWon.filter((x) => x.origin === "opportunity").length, value: sumValue(c.dealsWon.filter((x) => x.origin === "opportunity")) },
    fromCompanies: { count: c.dealsWon.filter((x) => x.origin === "company").length, value: sumValue(c.dealsWon.filter((x) => x.origin === "company")) },
    bySource,
    openEstimate: { count: openOpps.length, value: openOpps.reduce((n, o) => n + (o.estimated_value ?? 0), 0) },
    openByStatus: OPEN_OPP.map((status) => ({ status, count: openOpps.filter((o) => o.status === status).length, estimate: openOpps.filter((o) => o.status === status).reduce((n, o) => n + (o.estimated_value ?? 0), 0) })),
  };

  // Trend: one point per day, or per week when the range is long.
  const days = eachDay(range.from, range.to);
  const weekly = days.length > TREND_DAYS_LIMIT;
  const bucketOf = (iso: string) => {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
    if (!weekly) return date;
    let start = range.from;
    while (addDays(start, 7) <= date) start = addDays(start, 7);
    return start;
  };
  const starts = weekly ? days.filter((_, i) => i % 7 === 0) : days;
  const points = new Map(starts.map((s) => [s, { date: s, added: 0, contacts: 0 }]));
  c.newProspects.forEach((r) => r.at && points.get(bucketOf(r.at)) && (points.get(bucketOf(r.at))!.added += 1));
  c.contactsMade.forEach((r) => r.at && points.get(bucketOf(r.at)) && (points.get(bucketOf(r.at))!.contacts += 1));

  // Activity by type (every recorded type, not just contact).
  const startMs = Date.parse(range.startIso);
  const endMs = Date.parse(range.endIso);
  const typeCounts = new Map<ActivityType, number>();
  d.activities.forEach((a) => {
    const t = Date.parse(a.occurred_at);
    const co = ix.company.get(a.company_id);
    const catOk = filters.category_id === null || (filters.category_id === NO_CATEGORY ? co?.category_id === null : co?.category_id === filters.category_id);
    if (!co || !catOk || t < startMs || t >= endMs || (filters.staff_id !== null && a.user_id !== filters.staff_id)) return;
    typeCounts.set(a.type, (typeCounts.get(a.type) ?? 0) + 1);
  });
  const activityByType = ACTIVITY_TYPES.filter((t) => typeCounts.has(t)).map((t) => ({ type: t, count: typeCounts.get(t)! })).sort((a, b) => b.count - a.count);

  // By category and by person: the same collection, one argument different.
  const catList = [...d.categories.filter((x) => x.active || d.companies.some((co) => co.category_id === x.id)).map((x) => ({ key: x.id, label: x.name })), { key: NO_CATEGORY, label: "No category" }];
  const byCategory = catList
    .filter((x) => filters.category_id === null || filters.category_id === x.key)
    .map((x) => countRow(x.key, x.label, collect(d, ix, range, today, { category: x.key, staff: filters.staff_id })));
  const byStaff = d.people
    .filter((p) => filters.staff_id === null || filters.staff_id === p.id)
    .map((p) => countRow(p.id, personName(p.email), collect(d, ix, range, today, { category: filters.category_id, staff: p.id })))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Funnel: of the companies added in the period, how many have got how far (a company can skip a step, so each step
  // is shown as a share of the companies added, not of the step before).
  const cohort = d.companies.filter((co) => {
    const catOk = filters.category_id === null || (filters.category_id === NO_CATEGORY ? co.category_id === null : co.category_id === filters.category_id);
    return catOk && Date.parse(co.created_at) >= startMs && Date.parse(co.created_at) < endMs && (filters.staff_id === null || co.assigned_to === filters.staff_id);
  });
  const enoughCohort = cohort.length >= MIN_COHORT;
  const share = (n: number, of: number, enough: boolean) => (enough && of > 0 ? n / of : null);
  const reachedInterested = (co: RCompany) => {
    if (!ix.interested) return false;
    const floor = ix.interested.sort_order;
    const ranks = [co.stage_id, ...(ix.stageHistoryOf.get(co.id) ?? []).map((h) => h.to_stage_id)].map((id) => (id ? ix.stage.get(id) : undefined));
    return ranks.some((s) => !!s && (s.kind === "open" || s.kind === "won") && s.sort_order >= floor);
  };
  const everQuoted = (id: string) => (ix.oppsOf.get(id) ?? []).some((o) => (ix.historyOf.get(o.id) ?? []).some((h) => h.to_status === "quote_sent"));
  const funnelSteps: FunnelStep[] = [
    { key: "added", label: "Added", count: cohort.length, share: share(cohort.length, cohort.length, enoughCohort) },
    { key: "contacted", label: "Contacted", count: cohort.filter((co) => !!co.last_contacted_at).length, share: null },
    ...(ix.interested ? [{ key: "interested", label: "Reached Interested", count: cohort.filter(reachedInterested).length, share: null }] : []),
    { key: "opportunity", label: "Has an opportunity", count: cohort.filter((co) => (ix.oppsOf.get(co.id) ?? []).length > 0).length, share: null },
    { key: "quote", label: "Quote sent", count: cohort.filter((co) => everQuoted(co.id)).length, share: null },
    { key: "won", label: "Won", count: cohort.filter((co) => kindIs(ix, co, "won") || (ix.oppsOf.get(co.id) ?? []).some((o) => o.status === "won")).length, share: null },
  ].map((s) => ({ ...s, share: share(s.count, cohort.length, enoughCohort) }));
  if (!enoughCohort) funnelNotes.push(`Conversion percentages need at least ${MIN_COHORT} companies added in the period. There ${cohort.length === 1 ? "is" : "are"} ${cohort.length}, so only counts are shown.`);

  const oppCohort = d.opportunities.filter((o) => {
    const co = ix.company.get(o.company_id);
    const catOk = filters.category_id === null || (filters.category_id === NO_CATEGORY ? co?.category_id === null : co?.category_id === filters.category_id);
    return !!co && catOk && Date.parse(o.created_at) >= startMs && Date.parse(o.created_at) < endMs && (filters.staff_id === null || (o.assigned_to ?? o.created_by) === filters.staff_id);
  });
  const enoughOpp = oppCohort.length >= MIN_COHORT;
  const reachedOpp = (o: ROpportunity, status: OpportunityStatus) => o.status === status || (ix.historyOf.get(o.id) ?? []).some((h) => h.to_status === status);
  const oppSteps: FunnelStep[] = [
    { key: "identified", label: "Identified", count: oppCohort.length },
    { key: "quote_requested", label: "Quote requested", count: oppCohort.filter((o) => reachedOpp(o, "quote_requested")).length },
    { key: "quote_sent", label: "Quote sent", count: oppCohort.filter((o) => reachedOpp(o, "quote_sent")).length },
    { key: "won", label: "Won", count: oppCohort.filter((o) => reachedOpp(o, "won")).length },
    { key: "lost", label: "Lost", count: oppCohort.filter((o) => reachedOpp(o, "lost")).length },
  ].map((s) => ({ ...s, share: share(s.count, oppCohort.length, enoughOpp) }));
  if (!enoughOpp) funnelNotes.push(`Opportunity percentages need at least ${MIN_COHORT} opportunities identified in the period. There ${oppCohort.length === 1 ? "is" : "are"} ${oppCohort.length}, so only counts are shown.`);

  // The pipeline today, and what to do next.
  const pipelineCompanies = d.companies.filter((co) => (filters.category_id === null || (filters.category_id === NO_CATEGORY ? co.category_id === null : co.category_id === filters.category_id)) && (filters.staff_id === null || co.assigned_to === filters.staff_id));
  const pipeline = [...d.stages]
    .filter((s) => s.active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => {
      const here = pipelineCompanies.filter((co) => co.stage_id === s.id);
      return { stageId: s.id, name: s.name, kind: s.kind, count: here.length, estimate: s.kind === "open" ? here.reduce((n, co) => n + (co.estimated_value ?? 0), 0) : 0 };
    });

  const nextFollowUps = d.tasks
    .filter((t) => {
      const co = ix.company.get(t.company_id);
      const catOk = filters.category_id === null || (filters.category_id === NO_CATEGORY ? co?.category_id === null : co?.category_id === filters.category_id);
      return t.status === "open" && !!co && catOk && (filters.staff_id === null || t.assigned_to === filters.staff_id);
    })
    .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))
    .slice(0, 10)
    .map((t) => ({ id: t.id, companyId: t.company_id, company: ix.company.get(t.company_id)!.name, title: t.title, due: t.due_date, overdue: t.due_date < today, assignee: t.assigned_to ? ix.name.get(t.assigned_to) ?? null : null }));

  if (filters.staff_id) notes.push("Showing one person's work: what they did, added, completed or handle, and the companies, follow-ups and deals assigned to them.");

  return {
    range: { from: range.from, to: range.to, label: range.label },
    filters,
    metrics,
    sales,
    trend: { bucket: weekly ? "week" : "day", points: starts.map((s) => points.get(s)!) },
    activityByType,
    byCategory,
    byStaff,
    funnel: { cohort: cohort.length, enough: enoughCohort, steps: funnelSteps },
    opportunityFunnel: { cohort: oppCohort.length, enough: enoughOpp, steps: oppSteps },
    pipeline,
    nextFollowUps,
    notes,
    funnelNotes,
  };
}

function kindIs(ix: Index, c: RCompany, kind: StageKind): boolean {
  return !!c.stage_id && ix.stage.get(c.stage_id)?.kind === kind;
}
