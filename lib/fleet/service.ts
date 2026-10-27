import { createServiceClient } from "@/lib/supabase/service";
import { dublinDateKey } from "@/lib/connecteam/time-clock-summary";
import { notificationsConfigured } from "@/lib/compliance/service";
import { notifySlack, notifyWhatsApp } from "@/lib/monitoring/notify";
import { DUE_KINDS, alertedField, dueField, fleetAlertMessage, pendingFleetAlerts, regKey, stageOnEntry, type DueKind, type Van, type VanInput } from "./fleet";
import type { ImportedVan } from "./import";

const COLUMNS =
  "id, reg, reg_key, model, driver, lender, agreement, value_eur, monthly_eur, settlement_eur, weight_kg, tax_pin, tax_due, doe_due, insurance_due, tax_alerted_stage, doe_alerted_stage, insurance_alerted_stage, status, notes, updated_at";

export const todayKey = () => dublinDateKey(Date.now());

export type Result = { ok: true } | { ok: false; error: string; status: number };

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
/** Amounts come back from the database as text; the page works in numbers. */
const asVan = (r: any): Van => ({ ...r, value_eur: num(r.value_eur), monthly_eur: num(r.monthly_eur), settlement_eur: num(r.settlement_eur) });

export async function listVans(): Promise<Van[]> {
  const { data, error } = await createServiceClient().from("fleet_vans").select(COLUMNS).order("status").order("reg").limit(1000);
  if (error) throw new Error(error.message);
  return (data || []).map(asVan);
}

const duplicate = (message: string) => /duplicate key|unique/i.test(message);

/** A new van; a date entered now does not set off a warning at once, so its stage starts where it already is. */
export async function createVan(input: VanInput, userId: string): Promise<{ ok: true; id: string } | Extract<Result, { ok: false }>> {
  const today = todayKey();
  const { data, error } = await createServiceClient()
    .from("fleet_vans")
    .insert({
      ...input,
      reg_key: regKey(input.reg),
      tax_alerted_stage: stageOnEntry(input.tax_due, today),
      doe_alerted_stage: stageOnEntry(input.doe_due, today),
      insurance_alerted_stage: stageOnEntry(input.insurance_due, today),
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: duplicate(error.message) ? "That registration is already in the list" : error.message, status: duplicate(error.message) ? 409 : 500 };
  return { ok: true, id: data.id };
}

export async function updateVan(id: string, input: VanInput, userId: string): Promise<Result> {
  const supabase = createServiceClient();
  const { data: current, error: readError } = await supabase.from("fleet_vans").select(COLUMNS).eq("id", id).maybeSingle();
  if (readError) return { ok: false, error: readError.message, status: 500 };
  if (!current) return { ok: false, error: "Van not found", status: 404 };

  // A date that is changed starts its warnings again (a renewed tax date must warn next time round).
  const today = todayKey();
  const stages: Record<string, number> = {};
  for (const kind of DUE_KINDS) if (current[dueField(kind)] !== input[dueField(kind)]) stages[alertedField(kind)] = stageOnEntry(input[dueField(kind)], today);

  const { error } = await supabase
    .from("fleet_vans")
    .update({ ...input, reg_key: regKey(input.reg), ...stages, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: duplicate(error.message) ? "That registration is already in the list" : error.message, status: duplicate(error.message) ? 409 : 500 };
  return { ok: true };
}

export async function deleteVan(id: string): Promise<Result> {
  const { data, error } = await createServiceClient().from("fleet_vans").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!data || data.length === 0) return { ok: false, error: "Van not found", status: 404 };
  return { ok: true };
}

// ---- Import from the spreadsheet ----

export type ImportCounts = { added: number; updated: number; regsInHubNotInFile: number };

/** How many of the file's vans are new and how many are already in the Hub; writes nothing. */
export async function previewImport(vans: ImportedVan[]): Promise<ImportCounts> {
  const existing = await listVans();
  const inFile = new Set(vans.map((v) => regKey(v.reg)));
  const known = new Set(existing.map((v) => v.reg_key));
  return {
    added: vans.filter((v) => !known.has(regKey(v.reg))).length,
    updated: vans.filter((v) => known.has(regKey(v.reg))).length,
    regsInHubNotInFile: existing.filter((v) => v.status === "active" && !inFile.has(v.reg_key)).length,
  };
}

/** The fields a spreadsheet row carries, leaving out blanks so a blank cell never wipes what is already in the Hub. */
function fieldsOf(v: ImportedVan) {
  const out: Record<string, unknown> = {};
  for (const f of ["model", "driver", "lender", "agreement", "value_eur", "monthly_eur", "settlement_eur", "weight_kg", "tax_pin", "tax_due", "doe_due", "insurance_due"] as const) {
    if (v[f] !== undefined) out[f] = v[f];
  }
  return out;
}

/**
 * New vans are added; a van already in the Hub has the figures in the file written over its own, and a date only
 * where the file has a real one, so dates typed into the Hub are never replaced by a month name or a blank.
 */
export async function importVans(vans: ImportedVan[], userId: string): Promise<ImportCounts> {
  const supabase = createServiceClient();
  const counts = await previewImport(vans);
  const existing = new Map((await listVans()).map((v) => [v.reg_key, v]));
  const today = todayKey();

  const fresh = vans.filter((v) => !existing.has(regKey(v.reg)));
  if (fresh.length > 0) {
    const { error } = await supabase.from("fleet_vans").insert(
      fresh.map((v) => ({
        ...fieldsOf(v),
        reg: v.reg,
        reg_key: regKey(v.reg),
        status: v.gone ? "gone" : "active",
        notes: v.monthNotes.length ? `From the spreadsheet: ${v.monthNotes.join(", ")}. Enter the real date.` : null,
        tax_alerted_stage: stageOnEntry(v.tax_due ?? null, today),
        doe_alerted_stage: stageOnEntry(v.doe_due ?? null, today),
        insurance_alerted_stage: stageOnEntry(v.insurance_due ?? null, today),
        created_by: userId,
        updated_by: userId,
      }))
    );
    if (error) throw new Error(error.message);
  }

  for (const v of vans) {
    const current = existing.get(regKey(v.reg));
    if (!current) continue;
    const fields = fieldsOf(v);
    const stages: Record<string, number> = {};
    for (const kind of DUE_KINDS) {
      const incoming = v[dueField(kind)];
      if (incoming && incoming !== current[dueField(kind)]) stages[alertedField(kind)] = stageOnEntry(incoming, today);
    }
    const { error } = await supabase
      .from("fleet_vans")
      .update({ ...fields, ...stages, reg: v.reg, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", current.id);
    if (error) throw new Error(error.message);
  }
  return counts;
}

// ---- Warnings ----

/** One message for every date that has newly reached a warning stage, then the stage is recorded so each goes out once. */
export async function sendFleetAlerts(): Promise<{ sent: number; skipped: string | null }> {
  const alerts = pendingFleetAlerts(await listVans(), todayKey());
  if (alerts.length === 0) return { sent: 0, skipped: null };
  if (!notificationsConfigured()) return { sent: 0, skipped: "no Slack or WhatsApp channel configured" };

  await Promise.all([notifySlack(fleetAlertMessage(alerts)), notifyWhatsApp(fleetAlertMessage(alerts))]);

  const supabase = createServiceClient();
  await Promise.all(alerts.map((a) => supabase.from("fleet_vans").update({ [alertedField(a.kind as DueKind)]: a.stage }).eq("id", a.van.id)));
  return { sent: alerts.length, skipped: null };
}
