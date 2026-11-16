import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllConnecteamUsers, fetchDocumentCatalog, fetchUserDocuments, isConnecteamConfigured } from "@/lib/connecteam/client";
import { CONNECTEAM_SOURCE } from "@/lib/connecteam/mapping";
import { DUE_KINDS, alertedField, dueField, stageOnEntry, type DueKind } from "./fleet";
import { datesForPerson, findVanDocuments, suggestPerson, type Person } from "./connecteam-match";
import { listVans, todayKey } from "./service";

const FROM_FIELD: Record<DueKind, string> = { tax: "tax_from_connecteam", doe: "doe_from_connecteam", insurance: "insurance_from_connecteam" };

export type VanDocsResult = {
  /** Vans linked to a person in Connecteam. */
  linked: number;
  /** Links made this time by matching the driver's first name. */
  newlyLinked: number;
  /** Dates written to vans this time. */
  datesUpdated: number;
  /** Active vans with a driver that could not be matched to one person, so an Admin has to pick. */
  needPicking: number;
  /** Kinds with no matching document in Connecteam's Documents tab. */
  missingDocuments: DueKind[];
  /** Kinds where Connecteam holds no expiry date for anyone (so insurance stays as typed in the Hub until one is set up there). */
  noDatesInConnecteam: DueKind[];
};

/** The people in Connecteam, current and former, for choosing which one a van's documents belong to. */
export async function listConnecteamPeople(): Promise<Person[]> {
  const { data, error } = await createServiceClient()
    .from("knowledge_entries")
    .select("title, external_id, status")
    .eq("external_source", CONNECTEAM_SOURCE)
    .eq("entry_type", "person")
    .neq("status", "archived")
    .order("title")
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({ id: Number(r.external_id), name: String(r.title) })).filter((p) => Number.isInteger(p.id) && p.id > 0);
}

/** When the dates were last read; the Connecteam cron runs the sync again once this is old enough. */
export async function getVanDocsStatus(): Promise<{ lastSyncedAt: string | null }> {
  const { data } = await createServiceClient().from("fleet_vans").select("dates_synced_at").not("dates_synced_at", "is", null).order("dates_synced_at", { ascending: false }).limit(1);
  return { lastSyncedAt: data?.[0]?.dates_synced_at ?? null };
}

/**
 * Reads the "Van tax", "Van DOE" and "Van insurance" documents from Connecteam and writes each date to the van
 * whose driver holds them. Connecteam wins where it has a date; where it has none (insurance, until an expiry is
 * set on that document in Connecteam) the date typed in the Hub stays. A date that changes starts its warnings
 * again from where it already stands, so dates already past when first read do not set off a burst of warnings.
 */
export async function syncVanDocuments(): Promise<VanDocsResult> {
  if (!isConnecteamConfigured()) throw new Error("CONNECTEAM_API_KEY is not set");

  const catalog = await fetchDocumentCatalog();
  const documents = findVanDocuments(catalog);
  const missingDocuments = DUE_KINDS.filter((k) => documents[k] === undefined);
  const empty: VanDocsResult = { linked: 0, newlyLinked: 0, datesUpdated: 0, needPicking: 0, missingDocuments, noDatesInConnecteam: [] };
  if (Object.keys(documents).length === 0) return empty;

  const [rows, users, vans] = await Promise.all([fetchUserDocuments(Object.values(documents) as number[]), fetchAllConnecteamUsers(), listVans()]);

  // Only people who hold one of these documents can be a van's person, which keeps two staff sharing a first name from clashing.
  const holders = new Set(rows.map((r) => r.userId));
  const people: Person[] = users
    .filter((u) => holders.has(u.userId))
    .map((u) => ({ id: u.userId, name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() }));

  const supabase = createServiceClient();
  const today = todayKey();
  const now = new Date().toISOString();
  let linked = 0;
  let newlyLinked = 0;
  let datesUpdated = 0;
  let needPicking = 0;
  const kindsWithDates = new Set<DueKind>();

  for (const van of vans) {
    let userId = van.connecteam_user_id;
    const update: Record<string, unknown> = {};

    if (userId === null && van.status === "active" && van.driver) {
      const person = suggestPerson(van.driver, people);
      if (person) {
        userId = person.id;
        update.connecteam_user_id = person.id;
        newlyLinked++;
      } else {
        needPicking++;
      }
    }

    if (userId !== null) {
      linked++;
      const dates = datesForPerson(rows, userId, documents);
      for (const kind of DUE_KINDS) {
        const date = dates[kind];
        if (!date) continue;
        kindsWithDates.add(kind);
        if (date !== van[dueField(kind)]) {
          update[dueField(kind)] = date;
          update[alertedField(kind)] = stageOnEntry(date, today);
          datesUpdated++;
        }
        if (!van[`${kind}_from_connecteam` as const]) update[FROM_FIELD[kind]] = true;
      }
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from("fleet_vans").update({ ...update, updated_at: now }).eq("id", van.id);
      if (error) throw new Error(error.message);
    }
  }

  // Recorded on every van, so the cron can tell when the dates were last read even if none changed.
  if (vans.length > 0) {
    const { error } = await supabase.from("fleet_vans").update({ dates_synced_at: now }).in("id", vans.map((v) => v.id));
    if (error) throw new Error(error.message);
  }

  const noDatesInConnecteam = DUE_KINDS.filter((k) => documents[k] !== undefined && !kindsWithDates.has(k));
  return { linked, newlyLinked, datesUpdated, needPicking, missingDocuments, noDatesInConnecteam };
}
