import { createServiceClient } from "@/lib/supabase/service";
import { fetchConnecteamForm, fetchFormSubmissions, isConnecteamConfigured } from "./client";
import { parsePpeRequest, PPE_FORM_ID } from "./ppe";
import { formatPpeContext, summarisePpe, type PpeOverview } from "./ppe-summary";
import { loadStaff } from "./vehicles-sync";

const UPSERT_CHUNK = 200;

export type PpeSyncResult = { total: number };

/** Re-reads the whole form and upserts by submission id, so manager status changes flow through. */
export async function syncPpeRequests(): Promise<PpeSyncResult> {
  const form = await fetchConnecteamForm(PPE_FORM_ID);
  if (!form) throw new Error(`Connecteam form ${PPE_FORM_ID} (tools & PPE requests) was not found`);

  const submissions = await fetchFormSubmissions(PPE_FORM_ID);
  const rows = submissions.map((s) => parsePpeRequest(form, s));

  const supabase = createServiceClient();
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((r) => ({ ...r, synced_at: now }));
    const { error } = await supabase.from("ppe_requests").upsert(chunk, { onConflict: "submission_id" });
    if (error) throw new Error(error.message);
  }

  return { total: rows.length };
}

export type PpeStatus = { configured: boolean; lastSyncedAt: string | null; requests: number };

export async function getPpeStatus(): Promise<PpeStatus> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("ppe_requests").select("synced_at").order("synced_at", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);

  const { count } = await supabase.from("ppe_requests").select("submission_id", { count: "exact", head: true });
  return { configured: isConnecteamConfigured(), lastSyncedAt: data?.[0]?.synced_at ?? null, requests: count ?? 0 };
}

/** The one place the figures are computed, shared by the dashboard view and Eleven. */
export async function getPpeOverview(): Promise<{ overview: PpeOverview; lastSyncedAt: string | null }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ppe_requests")
    .select("submission_id, submitted_at, submitter_user_id, items, quantity, spray_suit_sizes, other_text, status, status_updated_at, manager_note, synced_at")
    .order("submitted_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);

  const rows = data || [];
  const lastSyncedAt = rows.map((r) => r.synced_at as string).sort().slice(-1)[0] ?? null;
  return { overview: summarisePpe(rows, await loadStaff()), lastSyncedAt };
}

/** Text block for Eleven's prompt; empty when the table doesn't exist yet or nothing is synced. */
export async function getPpeContextForEleven(): Promise<string> {
  try {
    const { overview, lastSyncedAt } = await getPpeOverview();
    if (overview.totals.requests90 === 0 && overview.openStale.length === 0 && overview.openRecent.length === 0) return "";
    return formatPpeContext(overview, lastSyncedAt);
  } catch {
    return "";
  }
}
