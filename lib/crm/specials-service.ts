import { createServiceClient } from "@/lib/supabase/service";
import { addDays, dublinToday } from "./followups";
import { dublinDayStart, resolveRange } from "./report-range";
import { loadReportData } from "./report-service";
import { periodCounter, type CountRow } from "./reports";
import { fail, logEvent, nextStamp, type Db } from "./service";
import { runningFor, specialWindows } from "./specials";
import { normalizeCounty } from "./territories";
import type { Special, SpecialFields } from "./types";

const COLUMNS = "id, title, offer, code, county, starts_on, ends_on, active, created_at, updated_at";

/** Every special, newest first. There are only ever a few dozen, so the list is not paged. */
export async function listSpecials(db: Db = createServiceClient()): Promise<Special[]> {
  const { data, error } = await db.from("crm_specials").select(COLUMNS).order("starts_on", { ascending: false }).order("id");
  if (error) fail(error, "Could not load the specials");
  return (data ?? []) as Special[];
}

/** The specials running today that apply to a company in this county. Used to tell people (and the message drafter) what is on offer. */
export async function specialsRunningFor(county: string | null, today: string = dublinToday(), db: Db = createServiceClient()): Promise<Special[]> {
  // A county written the old way ("County Wicklow") still finds its specials.
  return runningFor(await listSpecials(db), normalizeCounty(county), today);
}

export async function createSpecial(input: SpecialFields, userId: string): Promise<{ id: string }> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("crm_specials")
    .insert({ ...input, created_by: userId, updated_by: userId, updated_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error) fail(error, "Could not save the special");
  await logEvent(db, userId, "special_created", "special", data.id, { county: input.county });
  return { id: data.id };
}

export async function updateSpecial(id: string, patch: Partial<SpecialFields>, userId: string): Promise<{ ok: true } | { notFound: true } | { error: string }> {
  const db = createServiceClient();
  const { data: current } = await db.from("crm_specials").select(COLUMNS).eq("id", id).maybeSingle();
  if (!current) return { notFound: true };
  // The end date is checked against the start date as it will be after this change, not only as sent.
  const starts = patch.starts_on ?? current.starts_on;
  const ends = "ends_on" in patch ? patch.ends_on : current.ends_on;
  if (ends && ends < starts) return { error: "The end date cannot be before the start date" };

  const { error } = await db.from("crm_specials").update({ ...patch, updated_by: userId, updated_at: nextStamp(current.updated_at) }).eq("id", id);
  if (error) fail(error, "Could not save the special");
  await logEvent(db, userId, "special_updated", "special", id, { fields: Object.keys(patch) });
  return { ok: true };
}

export async function deleteSpecial(id: string, userId: string): Promise<boolean> {
  const db = createServiceClient();
  const { data, error } = await db.from("crm_specials").delete().eq("id", id).select("id");
  if (error) fail(error, "Could not delete the special");
  if (!data || data.length === 0) return false;
  await logEvent(db, userId, "special_deleted", "special", id);
  return true;
}

export type SpecialResult = {
  /** How many days the figures cover, on each side. */
  days: number;
  during: { from: string; to: string; counts: CountRow };
  /** The same number of days straight before it started, for comparison. */
  before: { from: string; to: string; counts: CountRow };
};

/**
 * What happened in the special's county while it ran, next to the same number of days before it. Worked out by the same
 * rules as the reports. It shows what happened alongside the special, not that the special caused it.
 */
export async function specialResults(specials: Special[], today: string = dublinToday()): Promise<Record<string, SpecialResult>> {
  const windows = specials.map((s) => ({ s, w: specialWindows(s, today) })).filter((x): x is { s: Special; w: NonNullable<ReturnType<typeof specialWindows>> } => x.w !== null);
  if (windows.length === 0) return {};

  const earliest = windows.map((x) => x.w.before.from).sort()[0];
  const data = await loadReportData(createServiceClient(), { startIso: dublinDayStart(earliest), endIso: dublinDayStart(addDays(today, 1)) });
  const count = periodCounter(data, today);

  const out: Record<string, SpecialResult> = {};
  for (const { s, w } of windows) {
    const during = resolveRange("custom", today, w.during.from, w.during.to);
    const before = resolveRange("custom", today, w.before.from, w.before.to);
    if ("error" in during || "error" in before) continue;
    out[s.id] = {
      days: w.days,
      during: { ...w.during, counts: count(during, s.county) },
      before: { ...w.before, counts: count(before, s.county) },
    };
  }
  return out;
}
