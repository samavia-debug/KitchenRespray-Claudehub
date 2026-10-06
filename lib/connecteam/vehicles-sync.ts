import { createServiceClient } from "@/lib/supabase/service";
import { fetchConnecteamForm, fetchFormSubmissions, isConnecteamConfigured } from "./client";
import { CONNECTEAM_SOURCE } from "./mapping";
import { parseInspections, VEHICLE_FORM_ID } from "./vehicles";
import { formatVehicleContext, summariseVehicles, type StaffRef, type VehicleOverview } from "./vehicles-summary";

const UPSERT_CHUNK = 200;

export type VehicleSyncResult = { total: number; skipped: number };

/**
 * Pulls every vehicle inspection submission from Connecteam and upserts it by
 * submission id, so re-running is safe and edits made in Connecteam flow
 * through. Cheap enough to just re-read the whole form (a few hundred rows).
 */
export async function syncVehicleInspections(): Promise<VehicleSyncResult> {
  const form = await fetchConnecteamForm(VEHICLE_FORM_ID);
  if (!form) throw new Error(`Connecteam form ${VEHICLE_FORM_ID} (vehicle inspection) was not found`);

  const submissions = await fetchFormSubmissions(VEHICLE_FORM_ID);
  const { rows, skipped } = parseInspections(form, submissions);

  const supabase = createServiceClient();
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((r) => ({ ...r, synced_at: now }));
    const { error } = await supabase.from("vehicle_inspections").upsert(chunk, { onConflict: "submission_id" });
    if (error) throw new Error(error.message);
  }

  return { total: rows.length, skipped };
}

export type VehicleStatus = { configured: boolean; lastSyncedAt: string | null; reports: number };

export async function getVehicleStatus(): Promise<VehicleStatus> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("vehicle_inspections")
    .select("synced_at")
    .order("synced_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);

  const { count } = await supabase.from("vehicle_inspections").select("submission_id", { count: "exact", head: true });
  return { configured: isConnecteamConfigured(), lastSyncedAt: data?.[0]?.synced_at ?? null, reports: count ?? 0 };
}

async function loadStaff(): Promise<StaffRef[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("knowledge_entries")
    .select("title, status, external_id")
    .eq("external_source", CONNECTEAM_SOURCE);

  return (data || [])
    .map((e) => ({ userId: Number(e.external_id), name: e.title as string, former: e.status === "archived" }))
    .filter((s) => Number.isFinite(s.userId));
}

/** The one place the figures are computed, shared by the dashboard view and Eleven. */
export async function getVehicleOverview(): Promise<{ overview: VehicleOverview; lastSyncedAt: string | null }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("vehicle_inspections")
    .select(
      "vehicle_key, vehicle_reg, make_model, submitted_at, submitter_user_id, driver_name, odometer_text, odometer_km, trip_type, defects, safety_equipment_ok, condition_ok, synced_at"
    )
    .order("submitted_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);

  const rows = data || [];
  const staff = await loadStaff();
  const lastSyncedAt = rows.map((r) => r.synced_at as string).sort().slice(-1)[0] ?? null;
  return { overview: summariseVehicles(rows, staff), lastSyncedAt };
}

/** Text block for Eleven's prompt; empty when the table doesn't exist yet or nothing is synced. */
export async function getVehicleContextForEleven(): Promise<string> {
  try {
    const { overview, lastSyncedAt } = await getVehicleOverview();
    if (overview.vehicles.length === 0) return "";
    return formatVehicleContext(overview, lastSyncedAt);
  } catch {
    return "";
  }
}
