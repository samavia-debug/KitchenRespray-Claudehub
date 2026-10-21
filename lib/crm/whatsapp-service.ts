import { createServiceClient } from "@/lib/supabase/service";
import { PublicError } from "./errors";
import { addDays, dublinToday } from "./followups";
import { dublinDayStart } from "./report-range";
import { fail, logEvent, type Db } from "./service";
import { listSpecials } from "./specials-service";
import { runningFor } from "./specials";
import { normalizeCounty } from "./territories";
import { chooseNumber, DEFAULT_TEMPLATES, firstName, TEMPLATE_MAX, unknownPlaceholders, type WhatsappTemplates } from "./whatsapp";

export const WHATSAPP_TYPES = ["WhatsApp message", "WhatsApp follow-up"];

// ---------- the templates ----------

/** The saved wording, or the starter wording where an Admin has not written one yet. `saved` says which. */
export async function getTemplates(db: Db = createServiceClient()): Promise<WhatsappTemplates & { saved: boolean }> {
  // Nothing saved yet, or the migration not run yet: the queue still works, on the starter wording.
  const { data } = await db.from("crm_whatsapp_settings").select("first_message, follow_up").eq("id", 1).maybeSingle();
  const first = data?.first_message?.trim();
  const follow = data?.follow_up?.trim();
  return { first_message: first || DEFAULT_TEMPLATES.first_message, follow_up: follow || DEFAULT_TEMPLATES.follow_up, saved: !!(first || follow) };
}

export function cleanTemplates(input: unknown): { value: WhatsappTemplates } | { error: string } {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!raw) return { error: "Nothing was sent" };
  const out: Record<string, string> = {};
  for (const [key, label] of [["first_message", "The first message"], ["follow_up", "The follow-up message"]] as const) {
    const v = raw[key];
    if (typeof v !== "string") return { error: `${label} must be text` };
    const text = v.replace(/\r\n/g, "\n").trim();
    if (!text) return { error: `${label} cannot be empty` };
    if (text.length > TEMPLATE_MAX) return { error: `${label} is too long (${TEMPLATE_MAX} characters at most)` };
    const unknown = unknownPlaceholders(text);
    if (unknown.length) return { error: `${label} has ${unknown.join(", ")}, which is not a blank we fill in. Use {name}, {company}, {county}, {sender}, {offer} or {code}.` };
    out[key] = text;
  }
  return { value: out as unknown as WhatsappTemplates };
}

export async function saveTemplates(values: WhatsappTemplates, userId: string): Promise<void> {
  const db = createServiceClient();
  const { error } = await db.from("crm_whatsapp_settings").upsert({ id: 1, ...values, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new PublicError("Could not save the messages. If you have not run the WhatsApp migration in Supabase yet, run it first.", error.message);
  await logEvent(db, userId, "whatsapp_templates_saved", "whatsapp", null, {});
}

// ---------- the queue ----------

export type QueueEntry = {
  id: string;
  name: string;
  city: string | null;
  county: string | null;
  /** The number to open in WhatsApp (country code first, digits only), or null when there is none to use. */
  number: string | null;
  /** The number as it is on record, for showing; or why there is none to use. */
  shown: string | null;
  reason: string | null;
  contact_first_name: string | null;
  /** The wording and code of the special running in this company's county, if any. */
  offer: string | null;
  code: string | null;
  /** The last WhatsApp already recorded against this company, any day. */
  last_whatsapp: { type: string; at: string } | null;
  /** A WhatsApp was already recorded today, so the queue leaves this company out. */
  sent_today: boolean;
};

export type Queue = { entries: QueueEntry[]; notFound: number; templates: WhatsappTemplates; templatesSaved: boolean };

/** Everything the send queue needs for these companies, in the order they were selected. */
export async function buildQueue(ids: string[], today: string = dublinToday(), db: Db = createServiceClient()): Promise<Queue> {
  const [{ data: companies, error }, { data: contacts, error: contactError }, { data: activities, error: activityError }, specials, templates] = await Promise.all([
    db.from("crm_companies").select("id, name, city, county, phone, mobile").in("id", ids).is("archived_at", null),
    db.from("crm_contacts").select("id, company_id, full_name, phone, created_at").in("company_id", ids).order("created_at").order("id"),
    db.from("crm_activities").select("id, company_id, type, occurred_at").in("type", WHATSAPP_TYPES).in("company_id", ids).order("occurred_at", { ascending: false }).order("id").limit(1000),
    listSpecials(db),
    getTemplates(db),
  ]);
  if (error) fail(error, "Could not load the companies");
  if (contactError) fail(contactError, "Could not load the contacts");
  if (activityError) fail(activityError, "Could not check the earlier WhatsApp messages");

  const byCompany = <T extends { company_id: string }>(rows: T[] | null) => {
    const map = new Map<string, T[]>();
    for (const r of rows ?? []) map.set(r.company_id, [...(map.get(r.company_id) ?? []), r]);
    return map;
  };
  const contactsOf = byCompany(contacts as { company_id: string; full_name: string; phone: string | null }[] | null);
  const activitiesOf = byCompany(activities as { company_id: string; type: string; occurred_at: string }[] | null);
  const found = new Map((companies ?? []).map((c: any) => [c.id as string, c]));

  const dayStart = Date.parse(dublinDayStart(today));
  const dayEnd = Date.parse(dublinDayStart(addDays(today, 1)));
  const entries: QueueEntry[] = [];
  for (const id of ids) {
    const c: any = found.get(id);
    if (!c) continue;
    const people = contactsOf.get(id) ?? [];
    const choice = chooseNumber(c, people.map((p) => p.phone));
    const county = normalizeCounty(c.county);
    // A special for this county beats one that runs everywhere; otherwise the most recently started.
    const running = runningFor(specials, county, today);
    const special = running.find((s) => s.county !== null) ?? running[0] ?? null;
    const past = activitiesOf.get(id) ?? [];
    entries.push({
      id,
      name: c.name,
      city: c.city ?? null,
      county,
      number: choice.number,
      shown: choice.shown,
      reason: "reason" in choice ? choice.reason : null,
      contact_first_name: people.map((p) => firstName(p.full_name)).find((n) => !!n) ?? null,
      offer: special?.offer ?? null,
      code: special?.code ?? null,
      last_whatsapp: past[0] ? { type: past[0].type, at: past[0].occurred_at } : null,
      sent_today: past.some((a) => Date.parse(a.occurred_at) >= dayStart && Date.parse(a.occurred_at) < dayEnd),
    });
  }
  return { entries, notFound: ids.length - entries.length, templates: { first_message: templates.first_message, follow_up: templates.follow_up }, templatesSaved: templates.saved };
}
