import { createServiceClient } from "@/lib/supabase/service";
import { askClaude, CLAUDE_MODEL } from "@/lib/ai/anthropic";
import { CONNECTEAM_SOURCE, parseStaffContent } from "@/lib/connecteam/mapping";
import { dublinDateKey } from "@/lib/connecteam/time-clock-summary";
import { FACT_LABEL, LETTER_TYPE_BY_KEY, type FactKey, type LetterStatus, type LetterTypeKey } from "./config";
import { cleanStaffName } from "./names";
import { fetchStaffAddress } from "./staff-address";
import { applyAdded, factsForModel, factsFromStaff, formatLongDate, missingFacts, type LetterFacts } from "./facts";
import { EMPTY_SETTINGS, type LetterSettings } from "./layout";
import { buildSystemPrompt, buildUserMessage, parseDraft, type Draft, type LetterDetails, type Recipient } from "./prompt";
import { nextStatus, type LetterInput, type StatusAction } from "./validate";

export const todayIso = () => dublinDateKey(Date.now());

const LIST_COLUMNS = "id, technician_name, technician_former, letter_type, status, subject, letter_date, ai_generated, updated_at, approved_at, finalised_at";
const FULL_COLUMNS = `${LIST_COLUMNS}, technician_user_id, recipient, facts, details, greeting, body, closing, missing, created_at, approved_by, finalised_by, created_by`;

// ---- Technicians (read from the existing Connecteam staff entries; nothing is copied) ----

export type TechnicianListItem = { userId: number; name: string; sourceName: string; jobTitle: string | null; role: string | null; department: string | null; former: boolean };

async function staffEntries() {
  const { data, error } = await createServiceClient()
    .from("knowledge_entries")
    .select("title, status, external_id, content")
    .eq("external_source", CONNECTEAM_SOURCE);
  if (error) throw new Error(error.message);
  return (data || []).filter((e) => Number.isFinite(Number(e.external_id)));
}

export async function listTechnicians(): Promise<TechnicianListItem[]> {
  return (await staffEntries())
    .map((e) => {
      const d = parseStaffContent((e.content as string) ?? "");
      return {
        userId: Number(e.external_id),
        name: cleanStaffName(e.title as string).name,
        sourceName: e.title as string,
        jobTitle: d.jobTitle ?? null,
        role: d.role ?? null,
        department: d.department ?? null,
        former: e.status === "archived",
      };
    })
    // Current staff first, then former, each by the cleaned name (not by the one-letter code).
    .sort((a, b) => Number(a.former) - Number(b.former) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** `withAddress` also reads the person's home address from Connecteam, for the page; writing a letter does not need it. */
export async function getTechnicianFacts(userId: number, withAddress = false): Promise<LetterFacts | null> {
  const entry = (await staffEntries()).find((e) => Number(e.external_id) === userId);
  if (!entry) return null;
  const details = parseStaffContent((entry.content as string) ?? "");
  const source = entry.title as string;
  const base = factsFromStaff(cleanStaffName(source).name, { ...details, former: details.former || entry.status === "archived" });
  const address = withAddress ? await fetchStaffAddress(userId) : null;
  const facts = address ? { ...base, values: { ...base.values, address }, sources: { ...base.sources, address: "connecteam" as const } } : base;
  return facts.name === source ? facts : { ...facts, sourceName: source };
}

// ---- Settings ----

export async function getSettings(): Promise<LetterSettings> {
  const { data } = await createServiceClient().from("letter_settings").select("company_name, address, phone, email, website, signatory_name, signatory_title, footer_text").eq("id", 1).maybeSingle();
  return { ...EMPTY_SETTINGS, ...(data || {}) };
}

export async function saveSettings(values: Record<string, string | null>): Promise<void> {
  const { error } = await createServiceClient()
    .from("letter_settings")
    .upsert({ id: 1, ...values, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

// ---- Audit: what happened and who did it, never what the letter said ----

export async function logEvent(letterId: string | null, userId: string, action: string, meta: Record<string, unknown> = {}): Promise<void> {
  const { error } = await createServiceClient().from("letter_events").insert({ letter_id: letterId, user_id: userId, action, meta });
  if (error) console.error("Could not record a letter event", error.message);
}

// ---- Letters ----

export type LetterRow = {
  id: string;
  technician_user_id: number | null;
  technician_name: string;
  technician_former: boolean;
  letter_type: LetterTypeKey;
  status: LetterStatus;
  subject: string;
  letter_date: string;
  recipient: Recipient;
  facts: LetterFacts;
  details: LetterDetails;
  greeting: string;
  body: string;
  closing: string;
  missing: string[];
  ai_generated: boolean;
  created_at: string;
  updated_at: string;
  finalised_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  finalised_by: string | null;
  created_by: string | null;
};

export async function listLetters(): Promise<Partial<LetterRow>[]> {
  const { data, error } = await createServiceClient().from("letters").select(LIST_COLUMNS).order("updated_at", { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getLetter(id: string): Promise<LetterRow | null> {
  const { data, error } = await createServiceClient().from("letters").select(FULL_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LetterRow | null) ?? null;
}

export async function createLetter(input: LetterInput, userId: string): Promise<string> {
  const { data, error } = await createServiceClient()
    .from("letters")
    .insert({ ...input, status: "draft", created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await logEvent(data.id, userId, "created", { letter_type: input.letter_type, ai_generated: input.ai_generated });
  return data.id;
}

export type SaveResult = { ok: true } | { ok: false; error: string; status: number };

export async function updateLetter(id: string, input: LetterInput, userId: string): Promise<SaveResult> {
  const current = await getLetter(id);
  if (!current) return { ok: false, error: "Letter not found", status: 404 };
  if (current.status !== "draft") return { ok: false, error: "Only a draft can be edited. Reopen it first.", status: 409 };
  const { error } = await createServiceClient().from("letters").update({ ...input, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message, status: 500 };
  await logEvent(id, userId, "saved");
  return { ok: true };
}

export async function changeStatus(id: string, action: StatusAction, userId: string): Promise<SaveResult> {
  const current = await getLetter(id);
  if (!current) return { ok: false, error: "Letter not found", status: 404 };
  const t = nextStatus(current.status, action, current);
  if (!t.ok) return { ok: false, error: t.error, status: 409 };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: t.status, updated_at: now };
  if (action === "finalise") Object.assign(patch, { finalised_by: userId, finalised_at: now });
  if (action === "approve") Object.assign(patch, { approved_by: userId, approved_at: now });
  if (action === "reopen") Object.assign(patch, { finalised_by: null, finalised_at: null, approved_by: null, approved_at: null });

  const { error } = await createServiceClient().from("letters").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message, status: 500 };
  await logEvent(id, userId, action === "finalise" ? "finalised" : action === "approve" ? "approved" : "reopened", { from: current.status });
  return { ok: true };
}

/** A copy as a fresh draft dated today, as a starting point; approval does not carry over. */
export async function duplicateLetter(id: string, userId: string): Promise<string | null> {
  const src = await getLetter(id);
  if (!src) return null;
  const { data, error } = await createServiceClient()
    .from("letters")
    .insert({
      technician_user_id: src.technician_user_id,
      technician_name: src.technician_name,
      technician_former: src.technician_former,
      letter_type: src.letter_type,
      status: "draft",
      subject: src.subject,
      letter_date: todayIso(),
      recipient: src.recipient,
      facts: src.facts,
      details: src.details,
      greeting: src.greeting,
      body: src.body,
      closing: src.closing,
      missing: src.missing,
      ai_generated: src.ai_generated,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await logEvent(data.id, userId, "duplicated", { from: id });
  return data.id;
}

/** Only drafts can be deleted; finalised and approved letters are kept as a record. */
export async function deleteDraft(id: string, userId: string): Promise<SaveResult> {
  const current = await getLetter(id);
  if (!current) return { ok: false, error: "Letter not found", status: 404 };
  if (current.status !== "draft") return { ok: false, error: "Only a draft can be deleted", status: 409 };
  const { error } = await createServiceClient().from("letters").delete().eq("id", id);
  if (error) return { ok: false, error: error.message, status: 500 };
  await logEvent(null, userId, "deleted", { letter_id: id });
  return { ok: true };
}

// ---- Generation ----

export type GenerateRequest = {
  technicianUserId: number;
  /** The name to use on this letter, if the person corrected it. */
  name?: string;
  letterType: LetterTypeKey;
  added: Partial<Record<FactKey, string>>;
  recipient: Recipient;
  details: LetterDetails;
  letterDate: string;
};

export type GenerateResult = { ok: true; draft: Draft; facts: LetterFacts } | { ok: false; error: string; status: number };

export async function generateLetter(req: GenerateRequest, userId: string): Promise<GenerateResult> {
  // The address is read so the facts sent back to the page stay complete; it is not one of the facts sent to the model.
  const base = await getTechnicianFacts(req.technicianUserId, true);
  if (!base) return { ok: false, error: "Technician not found", status: 404 };

  const config = LETTER_TYPE_BY_KEY[req.letterType];
  const typedName = req.name?.replace(/\s+/g, " ").trim().slice(0, 160);
  const facts = { ...applyAdded(base, req.added), name: typedName || base.name };
  const settings = await getSettings();

  const reply = await askClaude(
    buildSystemPrompt(req.letterType, settings.company_name || "Kitchen Respray"),
    buildUserMessage(factsForModel(req.letterType, facts, !!req.details.includeContact), req.recipient, req.details, formatLongDate(req.letterDate))
  );
  if ("error" in reply) return { ok: false, error: reply.error, status: 502 };
  if (!reply.text) {
    const why = reply.stopReason === "refusal" ? "The AI service declined to write this letter. Try rewording the details." : "The AI service returned no letter. Please try again.";
    return { ok: false, error: why, status: 502 };
  }

  const draft = parseDraft(reply.text, req.recipient.name);
  if (!draft) return { ok: false, error: "The AI service's reply could not be read as a letter. Please try again.", status: 502 };

  // Anything the letter type expects that the record lacks is called out, whether or not the model noticed.
  const absent = missingFacts(req.letterType, facts).map((k) => `${FACT_LABEL[k]} is not recorded for this technician`);
  draft.missing = Array.from(new Set([...absent, ...draft.missing])).slice(0, 10);

  await logEvent(null, userId, "generated", {
    letter_type: config.key,
    technician_user_id: req.technicianUserId,
    model: CLAUDE_MODEL,
    input_tokens: reply.inputTokens,
    output_tokens: reply.outputTokens,
  });
  return { ok: true, draft, facts };
}
