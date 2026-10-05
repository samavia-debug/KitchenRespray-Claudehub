import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllConnecteamUsers, isConnecteamConfigured } from "./client";
import { buildStaffEntries, CONNECTEAM_SOURCE } from "./mapping";

export type ConnecteamSyncResult = { total: number; current: number; former: number; archivedMissing: number };

export type ConnecteamStatus = {
  configured: boolean;
  lastSyncedAt: string | null;
  current: number;
  former: number;
};

/**
 * Mirrors Connecteam staff into knowledge_entries as "person" entries, one
 * per Connecteam user, matched on (external_source, external_id) so a
 * re-sync updates in place rather than duplicating. Connecteam owns these
 * entries: hand edits are overwritten on the next sync.
 */
export async function syncConnecteamStaff(): Promise<ConnecteamSyncResult> {
  const users = await fetchAllConnecteamUsers();

  // An empty list is far more likely an API hiccup than a company with no
  // staff — and acting on it would archive every entry below.
  if (users.length === 0) {
    throw new Error("Connecteam returned no users — refusing to sync an empty list");
  }

  const entries = buildStaffEntries(users);
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("knowledge_entries")
    .upsert(
      entries.map((e) => ({ ...e, updated_at: now })),
      { onConflict: "external_source,external_id" }
    );
  if (error) throw new Error(error.message);

  // Someone deleted outright in Connecteam no longer appears in either list;
  // archive their entry instead of leaving them looking current.
  const returnedIds = new Set(entries.map((e) => e.external_id));
  const { data: existing, error: existingError } = await supabase
    .from("knowledge_entries")
    .select("id, external_id")
    .eq("external_source", CONNECTEAM_SOURCE)
    .neq("status", "archived");
  if (existingError) throw new Error(existingError.message);

  const missingIds = (existing || []).filter((r) => !returnedIds.has(r.external_id)).map((r) => r.id);
  if (missingIds.length > 0) {
    const { error: archiveError } = await supabase
      .from("knowledge_entries")
      .update({ status: "archived", updated_at: now })
      .in("id", missingIds);
    if (archiveError) throw new Error(archiveError.message);
  }

  const former = entries.filter((e) => e.status === "archived").length;
  return { total: entries.length, current: entries.length - former, former, archivedMissing: missingIds.length };
}

export async function getConnecteamStatus(): Promise<ConnecteamStatus> {
  const configured = isConnecteamConfigured();
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("knowledge_entries")
    .select("status, updated_at")
    .eq("external_source", CONNECTEAM_SOURCE);

  const rows = data || [];
  const lastSyncedAt = rows.map((r) => r.updated_at).sort().slice(-1)[0] ?? null;
  const former = rows.filter((r) => r.status === "archived").length;
  return { configured, lastSyncedAt, current: rows.length - former, former };
}
