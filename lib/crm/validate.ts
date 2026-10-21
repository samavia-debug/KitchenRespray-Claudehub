import { dublinToday } from "./followups";
import { cleanWebsite, searchTerm } from "./normalize";
import { COUNTY_CHOICES, LEINSTER_COUNTIES, normalizeCounty, NO_COUNTY, OUTSIDE_LEINSTER } from "./territories";
import {
  ACTIVITY_TYPES,
  CONTACT_METHODS,
  FOLLOW_UP_VIEWS,
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
  type ActivityFields,
  type ActivityType,
  type FollowUpView,
  type OpportunityFields,
  type OpportunitySource,
  type OpportunityStatus,
  type TaskFields,
  PRIORITIES,
  SORT_FIELDS,
  type CompanyFields,
  type CompanyQuery,
  type ContactFields,
  type ContactMethod,
  type Priority,
  type SortField,
  type SpecialFields,
} from "./types";

type Raw = Record<string, unknown>;
export type Cleaned<T> = { value: T } | { error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_VALUE = 1_000_000_000;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

function isRealDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function asObject(raw: unknown): Raw | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Raw) : null;
}

/** A trimmed string no longer than `max`, or null when empty. Throws a message for the wrong type or length. */
function text(raw: Raw, key: string, label: string, max: number): string | null | undefined {
  if (!(key in raw)) return undefined;
  const v = raw[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new Error(`${label} must be text`);
  const t = v.trim();
  if (t.length > max) throw new Error(`${label} is too long (${max} characters at most)`);
  return t === "" ? null : t;
}

function uuidOrNull(raw: Raw, key: string, label: string): string | null | undefined {
  if (!(key in raw)) return undefined;
  const v = raw[key];
  if (v === null || v === undefined || v === "") return null;
  if (!isUuid(v)) throw new Error(`${label} is not valid`);
  return v;
}

function dateOrNull(raw: Raw, key: string, label: string): string | null | undefined {
  if (!(key in raw)) return undefined;
  const v = raw[key];
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !isRealDate(v)) throw new Error(`${label} must be a date`);
  return v;
}

function moneyOrNull(raw: Raw, key: string, label: string): number | null | undefined {
  if (!(key in raw)) return undefined;
  const v = raw[key];
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[€,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > MAX_VALUE) throw new Error(`${label} must be an amount of 0 or more`);
  return Math.round(n * 100) / 100;
}

function phoneOrNull(raw: Raw, key: string, label: string): string | null | undefined {
  const t = text(raw, key, label, 40);
  if (t === undefined || t === null) return t;
  if (!/^[+\d\s().\-/]+$/.test(t) || t.replace(/\D/g, "").length < 6) throw new Error(`${label} does not look like a phone number`);
  return t;
}

function emailOrNull(raw: Raw, key: string, label: string): string | null | undefined {
  const t = text(raw, key, label, 200);
  if (t === undefined || t === null) return t;
  if (!EMAIL.test(t)) throw new Error(`${label} does not look like an email address`);
  return t.toLowerCase();
}

function websiteOrNull(raw: Raw, key: string): string | null | undefined {
  const t = text(raw, key, "Website", 300);
  if (t === undefined || t === null) return t;
  const cleaned = cleanWebsite(t);
  if (!cleaned) throw new Error("Website does not look like a web address");
  return cleaned;
}

function pick<T>(values: T[], raw: Raw, key: string, label: string): T | undefined {
  if (!(key in raw)) return undefined;
  const v = raw[key];
  if (!values.includes(v as T)) throw new Error(`${label} is not one of the allowed choices`);
  return v as T;
}

/** Drops keys that were not sent, so a partial update never wipes a field it did not mention. */
function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Checks a company from the browser. `partial` is for updates: only the fields sent are returned.
 * For a new company the name is required and the rest get their defaults.
 */
const COUNTY_HELP = "County must be one of the Leinster counties, or Outside Leinster";

/** A county as one of the fixed choices, so "Co. Carlow" and "carlow" are the same place. Empty clears it. */
function countyOrNull(raw: Raw): string | null | undefined {
  if (!("county" in raw)) return undefined;
  const v = raw.county;
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new Error(COUNTY_HELP);
  if (v.trim() === "") return null;
  const county = normalizeCounty(v);
  if (!county) throw new Error(COUNTY_HELP);
  return county;
}

export function cleanCompanyInput(input: unknown, partial = false): Cleaned<Partial<CompanyFields>> {
  const raw = asObject(input);
  if (!raw) return { error: "Nothing was sent" };
  try {
    const name = text(raw, "name", "Company name", 200);
    if ((name === undefined && !partial) || name === null) throw new Error("Company name is required");

    const priority = "priority" in raw && raw.priority !== null && raw.priority !== "" ? pick<Priority>([...PRIORITIES], raw, "priority", "Priority") : undefined;
    const country = text(raw, "country", "Country", 80);

    const value = defined({
      name,
      category_id: uuidOrNull(raw, "category_id", "Category"),
      website: websiteOrNull(raw, "website"),
      phone: phoneOrNull(raw, "phone", "Phone"),
      mobile: phoneOrNull(raw, "mobile", "Mobile"),
      email: emailOrNull(raw, "email", "Email"),
      address: text(raw, "address", "Address", 300),
      city: text(raw, "city", "Town or city", 100),
      county: countyOrNull(raw),
      postcode: text(raw, "postcode", "Postcode", 20),
      country: country === null ? "Ireland" : country,
      description: text(raw, "description", "Description", 2000),
      services: text(raw, "services", "Potential services", 500),
      estimated_value: moneyOrNull(raw, "estimated_value", "Estimated value"),
      source: text(raw, "source", "Source", 120),
      priority,
      assigned_to: uuidOrNull(raw, "assigned_to", "Assigned staff member"),
      notes: text(raw, "notes", "Notes", 4000),
    });

    if (!partial) {
      if (!("priority" in value)) value.priority = "Medium";
      if (!("country" in value)) value.country = "Ireland";
    }
    return { value };
  } catch (err: any) {
    return { error: err.message };
  }
}

export function cleanContactInput(input: unknown, partial = false): Cleaned<Partial<ContactFields>> {
  const raw = asObject(input);
  if (!raw) return { error: "Nothing was sent" };
  try {
    const full_name = text(raw, "full_name", "Name", 150);
    if ((full_name === undefined && !partial) || full_name === null) throw new Error("Name is required");

    const company_id = uuidOrNull(raw, "company_id", "Company");
    if (!partial && !company_id) throw new Error("A contact has to belong to a company");

    const method =
      "preferred_method" in raw && raw.preferred_method !== null && raw.preferred_method !== ""
        ? pick<ContactMethod>([...CONTACT_METHODS], raw, "preferred_method", "Preferred contact method")
        : "preferred_method" in raw
          ? null
          : undefined;

    const value = defined({
      company_id: company_id ?? undefined,
      full_name,
      job_title: text(raw, "job_title", "Job title", 120),
      email: emailOrNull(raw, "email", "Email"),
      phone: phoneOrNull(raw, "phone", "Phone"),
      preferred_method: method,
      source: text(raw, "source", "Source", 120),
      notes: text(raw, "notes", "Notes", 4000),
      assigned_to: uuidOrNull(raw, "assigned_to", "Assigned staff member"),
    });
    return { value };
  } catch (err: any) {
    return { error: err.message };
  }
}

export type StageChange = { stage_id: string; confirmed: boolean; outcome_note: string | null; won_value: number | null };

export function cleanStageChange(input: unknown): Cleaned<StageChange> {
  const raw = asObject(input);
  if (!raw) return { error: "Nothing was sent" };
  try {
    const stage_id = uuidOrNull(raw, "stage_id", "Stage");
    if (!stage_id) throw new Error("Choose a stage");
    return {
      value: {
        stage_id,
        confirmed: raw.confirmed === true,
        outcome_note: text(raw, "outcome_note", "Outcome notes", 1000) ?? null,
        won_value: moneyOrNull(raw, "won_value", "Value won") ?? null,
      },
    };
  } catch (err: any) {
    return { error: err.message };
  }
}

export type BulkChange = { ids: string[]; action: "assign" | "category" | "county"; value: string | null; confirmed: boolean };
export const MAX_BULK = 200;

export function cleanBulkChange(input: unknown): Cleaned<BulkChange> {
  const raw = asObject(input);
  if (!raw) return { error: "Nothing was sent" };
  try {
    const ids = Array.isArray(raw.ids) ? raw.ids : [];
    if (ids.length === 0) throw new Error("Select at least one company");
    if (ids.length > MAX_BULK) throw new Error(`Select no more than ${MAX_BULK} companies at a time`);
    if (!ids.every(isUuid)) throw new Error("One of the selected companies is not valid");
    const action = raw.action;
    if (action !== "assign" && action !== "category" && action !== "county") throw new Error("Unknown bulk action");
    let value: string | null;
    if (action === "county") {
      const county = countyOrNull({ county: raw.value });
      value = county ?? null;
    } else value = uuidOrNull(raw, "value", action === "assign" ? "Staff member" : "Category") ?? null;
    return { value: { ids: Array.from(new Set(ids as string[])), action, value, confirmed: raw.confirmed === true } };
  } catch (err: any) {
    return { error: err.message };
  }
}

function intIn(v: string | null, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** The filters, sort and page of the company list, from the page's query string. Anything odd falls back to a default. */
export function cleanCompanyQuery(params: URLSearchParams): CompanyQuery {
  const uuid = (k: string) => (isUuid(params.get(k)) ? params.get(k) : null);
  const date = (k: string) => {
    const v = params.get(k);
    return v && isRealDate(v) ? v : null;
  };
  const num = (k: string) => {
    const v = params.get(k);
    if (v === null || v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= MAX_VALUE ? n : null;
  };
  const priority = params.get("priority");
  const sort = params.get("sort") as SortField;
  const assigned = params.get("assigned_to");

  return {
    q: searchTerm(params.get("q")),
    category_id: uuid("category_id"),
    stage_id: uuid("stage_id"),
    assigned_to: assigned === "none" ? "none" : uuid("assigned_to"),
    priority: PRIORITIES.includes(priority as Priority) ? (priority as Priority) : null,
    source: searchTerm(params.get("source")) || null,
    location: searchTerm(params.get("location")),
    county: params.get("county") === NO_COUNTY ? NO_COUNTY : COUNTY_CHOICES.includes(params.get("county") ?? "") ? params.get("county") : null,
    contacted_before: date("contacted_before"),
    follow_up_before: date("follow_up_before"),
    min_value: num("min_value"),
    max_value: num("max_value"),
    page: intIn(params.get("page"), 1, 100_000, 1),
    pageSize: intIn(params.get("pageSize"), 1, 100, 25),
    sort: (SORT_FIELDS as readonly string[]).includes(sort) ? sort : "name",
    dir: params.get("dir") === "desc" ? "desc" : "asc",
  };
}

// ---------- activities, follow-ups and opportunities (phase 3) ----------

/** A follow-up cannot be set for a day that has already passed: that is nearly always a typo. */
function futureDateOrNull(raw: Raw, key: string, label: string): string | null | undefined {
  const v = dateOrNull(raw, key, label);
  if (typeof v === "string" && v < dublinToday()) throw new Error(`${label} cannot be in the past`);
  return v;
}

/** When something happened: a date or date and time, never in the future (an activity is something already done). */
function pastTimeOrNull(raw: Raw, key: string, label: string): string | null | undefined {
  if (!(key in raw)) return undefined;
  const v = raw[key];
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "string" ? new Date(v) : new Date(NaN);
  if (Number.isNaN(t.getTime())) throw new Error(`${label} must be a date and time`);
  // A little slack for clocks that are a minute or two apart.
  if (t.getTime() > Date.now() + 5 * 60_000) throw new Error(`${label} cannot be in the future. Record it once it has happened.`);
  return t.toISOString();
}

export type CleanActivity = Partial<ActivityFields> & { company_id: string; type: ActivityType };

export function cleanActivityInput(input: unknown): Cleaned<CleanActivity> {
  const raw = asObject(input);
  if (!raw) return { error: "Nothing was sent" };
  try {
    const company_id = uuidOrNull(raw, "company_id", "Company");
    if (!company_id) throw new Error("Choose a company");
    const type = pick<ActivityType>([...ACTIVITY_TYPES], raw, "type", "Activity type");
    if (!type) throw new Error("Choose what you did");

    const value = defined({
      contact_id: uuidOrNull(raw, "contact_id", "Contact"),
      occurred_at: pastTimeOrNull(raw, "occurred_at", "When it happened"),
      user_id: uuidOrNull(raw, "user_id", "Staff member"),
      outcome: text(raw, "outcome", "Outcome", 1000),
      notes: text(raw, "notes", "Notes", 4000),
      next_action: text(raw, "next_action", "Next action", 300),
      next_follow_up: futureDateOrNull(raw, "next_follow_up", "Follow-up date"),
    });
    return { value: { ...value, company_id, type } };
  } catch (err: any) {
    return { error: err.message };
  }
}

// ---------- specials ----------

const SPECIAL_COUNTY_HELP = "Choose one of the Leinster counties, or all counties";

/** The county a special applies to: one of the twelve, or null for every county. "Outside Leinster" is not a territory. */
function specialCounty(raw: Raw): string | null | undefined {
  if (!("county" in raw)) return undefined;
  const v = raw.county;
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new Error(SPECIAL_COUNTY_HELP);
  const t = v.trim();
  if (t === "" || /^all( counties| leinster)?$/i.test(t)) return null;
  const county = normalizeCounty(t);
  if (!county || county === OUTSIDE_LEINSTER || !(LEINSTER_COUNTIES as readonly string[]).includes(county)) throw new Error(SPECIAL_COUNTY_HELP);
  return county;
}

export function cleanSpecialInput(input: unknown, partial = false): Cleaned<Partial<SpecialFields>> {
  const raw = asObject(input);
  if (!raw) return { error: "Nothing was sent" };
  try {
    const title = text(raw, "title", "Title", 120);
    if ((title === undefined && !partial) || title === null) throw new Error("Give the special a title");
    const offer = text(raw, "offer", "Offer wording", 1000);
    if ((offer === undefined && !partial) || offer === null) throw new Error("Write the offer exactly as it should be told to people");
    const starts_on = dateOrNull(raw, "starts_on", "Start date");
    if ((starts_on === undefined && !partial) || starts_on === null) throw new Error("Choose the day it starts");
    const ends_on = dateOrNull(raw, "ends_on", "End date");
    if (starts_on && ends_on && ends_on < starts_on) throw new Error("The end date cannot be before the start date");
    if ("active" in raw && typeof raw.active !== "boolean") throw new Error("Active must be on or off");

    const value = defined({
      title,
      offer,
      code: text(raw, "code", "Code", 40),
      county: specialCounty(raw),
      starts_on,
      ends_on,
      active: "active" in raw ? (raw.active as boolean) : undefined,
    });
    if (!partial) {
      if (!("county" in value)) value.county = null;
      if (!("active" in value)) value.active = true;
    }
    return { value };
  } catch (err: any) {
    return { error: err.message };
  }
}

export type BulkActivity = { ids: string[]; activity: Omit<CleanActivity, "company_id">; confirmed: boolean };

/**
 * One activity to record against many companies (for example the WhatsApp message sent to a list). The activity is
 * checked by the same rules as a single one; the contact is left out because it can only belong to one company.
 */
export function cleanBulkActivity(input: unknown): Cleaned<BulkActivity> {
  const raw = asObject(input);
  if (!raw) return { error: "Nothing was sent" };
  const ids = Array.isArray(raw.ids) ? raw.ids : [];
  if (ids.length === 0) return { error: "Select at least one company" };
  if (ids.length > MAX_BULK) return { error: `Select no more than ${MAX_BULK} companies at a time` };
  if (!ids.every(isUuid)) return { error: "One of the selected companies is not valid" };

  const { contact_id: _contact, ...rest } = raw;
  const cleaned = cleanActivityInput({ ...rest, company_id: "00000000-0000-4000-8000-000000000000" });
  if ("error" in cleaned) return { error: cleaned.error };
  const { company_id: _company, ...activity } = cleaned.value;
  return { value: { ids: Array.from(new Set(ids as string[])), activity, confirmed: raw.confirmed === true } };
}

export function cleanTaskInput(input: unknown, partial = false): Cleaned<Partial<TaskFields>> {
  const raw = asObject(input);
  if (!raw) return { error: "Nothing was sent" };
  try {
    const title = text(raw, "title", "Follow-up", 300);
    if ((title === undefined && !partial) || title === null) throw new Error("Say what the follow-up is");
    const due_date = futureDateOrNull(raw, "due_date", "Due date");
    if ((due_date === undefined && !partial) || due_date === null) throw new Error("Choose a due date");

    const company_id = uuidOrNull(raw, "company_id", "Company");
    if (!partial && !company_id) throw new Error("A follow-up has to belong to a company");

    const value = defined({
      company_id: company_id ?? undefined,
      contact_id: uuidOrNull(raw, "contact_id", "Contact"),
      title,
      due_date,
      assigned_to: uuidOrNull(raw, "assigned_to", "Assigned staff member"),
    });
    return { value };
  } catch (err: any) {
    return { error: err.message };
  }
}

export type TaskCompletion = {
  result: string | null;
  /** When set, the person is also recording what they did, as an activity. */
  activity_type: ActivityType | null;
  next: { due_date: string; title: string | null; assigned_to: string | null } | null;
};

export function cleanTaskCompletion(input: unknown): Cleaned<TaskCompletion> {
  const raw = asObject(input);
  if (!raw) return { error: "Nothing was sent" };
  try {
    const activity_type =
      raw.activity_type === undefined || raw.activity_type === null || raw.activity_type === ""
        ? null
        : pick<ActivityType>([...ACTIVITY_TYPES], raw, "activity_type", "Activity type") ?? null;

    const nextRaw = asObject(raw.next);
    let next: TaskCompletion["next"] = null;
    if (nextRaw && nextRaw.due_date !== undefined && nextRaw.due_date !== null && nextRaw.due_date !== "") {
      const due_date = futureDateOrNull(nextRaw, "due_date", "Next follow-up date");
      next = { due_date: due_date as string, title: text(nextRaw, "title", "Next follow-up", 300) ?? null, assigned_to: uuidOrNull(nextRaw, "assigned_to", "Assigned staff member") ?? null };
    }
    return { value: { result: text(raw, "result", "Result", 1000) ?? null, activity_type, next } };
  } catch (err: any) {
    return { error: err.message };
  }
}

export function cleanOpportunityInput(input: unknown, partial = false): Cleaned<Partial<OpportunityFields>> {
  const raw = asObject(input);
  if (!raw) return { error: "Nothing was sent" };
  try {
    const title = text(raw, "title", "Opportunity", 200);
    if ((title === undefined && !partial) || title === null) throw new Error("Name the opportunity");
    const company_id = uuidOrNull(raw, "company_id", "Company");
    if (!partial && !company_id) throw new Error("An opportunity has to belong to a company");

    const source =
      "source" in raw && raw.source !== null && raw.source !== ""
        ? pick<OpportunitySource>([...OPPORTUNITY_SOURCES], raw, "source", "Source")
        : "source" in raw
          ? null
          : undefined;

    const value = defined({
      company_id: company_id ?? undefined,
      title,
      description: text(raw, "description", "Description", 2000),
      estimated_value: moneyOrNull(raw, "estimated_value", "Estimated value"),
      source,
      assigned_to: uuidOrNull(raw, "assigned_to", "Assigned staff member"),
    });
    return { value };
  } catch (err: any) {
    return { error: err.message };
  }
}

export type OpportunityStatusChange = { status: OpportunityStatus; confirmed: boolean; outcome_note: string | null; won_value: number | null };

export function cleanOpportunityStatus(input: unknown): Cleaned<OpportunityStatusChange> {
  const raw = asObject(input);
  if (!raw) return { error: "Nothing was sent" };
  try {
    const status = pick<OpportunityStatus>([...OPPORTUNITY_STATUSES], raw, "status", "Status");
    if (!status) throw new Error("Choose a status");
    return {
      value: {
        status,
        confirmed: raw.confirmed === true,
        outcome_note: text(raw, "outcome_note", "Outcome notes", 1000) ?? null,
        won_value: moneyOrNull(raw, "won_value", "Value won") ?? null,
      },
    };
  } catch (err: any) {
    return { error: err.message };
  }
}

export type TaskQuery = { view: FollowUpView; assigned_to: string | null; page: number; pageSize: number };

export function cleanTaskQuery(params: URLSearchParams): TaskQuery {
  const view = params.get("view") as FollowUpView;
  const assigned = params.get("assigned_to");
  return {
    view: (FOLLOW_UP_VIEWS as readonly string[]).includes(view) ? view : "today",
    assigned_to: assigned === "none" ? "none" : isUuid(assigned) ? assigned : null,
    page: intIn(params.get("page"), 1, 100_000, 1),
    pageSize: intIn(params.get("pageSize"), 1, 100, 25),
  };
}
