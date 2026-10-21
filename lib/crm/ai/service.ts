import { askClaude } from "@/lib/ai/anthropic";
import { getSettings as getLetterSettings } from "@/lib/letters/service";
import { createServiceClient } from "@/lib/supabase/service";
import { companyTasks, listActivities, listOpportunities } from "../activity-service";
import { dublinToday } from "../followups";
import { phoneKey } from "../normalize";
import { dublinDayStart, resolveRange, type ResolvedRange } from "../report-range";
import { loadReportData } from "../report-service";
import { getCompany, logEvent, type Db } from "../service";
import { specialsRunningFor } from "../specials-service";
import { PublicError } from "../errors";
import { buildSalesPack, currentOffers, draftFacts, nextStepFacts, ourCompanyFacts, researchRecord, type AiSettings } from "./facts";
import {
  ASK_SYSTEM,
  DRAFT_SYSTEM,
  NEXT_STEP_SYSTEM,
  parseMessageDraft,
  parseNextSteps,
  parseResearch,
  RESEARCH_SYSTEM,
  unsupportedFigures,
  type MessageDraft,
  type NextSteps,
  type Research,
} from "./prompts";
import { block, cleanAnswer, clean } from "./text";
import { extractPage, fetchPageWith, robotsAllows, STRICT_DEPS, WebError, type FetchOptions, type Fetched } from "./web";

/** How many AI requests one person can make in an Irish day. It keeps a stuck page or a curious click from running up the bill. */
export const DAILY_LIMIT = Number(process.env.CRM_AI_DAILY_LIMIT) > 0 ? Number(process.env.CRM_AI_DAILY_LIMIT) : 40;

export type AiFailure = { error: string; status: number };
const fail = (error: string, status: number): AiFailure => ({ error, status });
export const isFailure = (x: unknown): x is AiFailure => !!x && typeof x === "object" && "error" in x && "status" in x;

/** The web access the research feature uses. Tests give it a stand-in; the real one is strict about where it may go. */
export type Web = { fetch: (url: string, options?: FetchOptions) => Promise<Fetched> };
export const REAL_WEB: Web = { fetch: (url, options) => fetchPageWith(url, STRICT_DEPS, options) };

// ---------- settings ----------

export async function getAiSettings(db: Db = createServiceClient()): Promise<AiSettings> {
  const { data } = await db.from("crm_ai_settings").select("about_us, intro_template, tone, avoid").eq("id", 1).maybeSingle();
  return { about_us: data?.about_us ?? null, intro_template: data?.intro_template ?? null, tone: data?.tone ?? null, avoid: data?.avoid ?? null };
}

export async function saveAiSettings(values: AiSettings, userId: string): Promise<void> {
  const db = createServiceClient();
  const { error } = await db.from("crm_ai_settings").upsert({ id: 1, ...values, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new PublicError("Could not save the settings", error.message);
  await logEvent(db, userId, "ai_settings_saved", "ai", null, {});
}

// ---------- the allowance and the call ----------

async function used(db: Db, userId: string): Promise<number> {
  const { count, error } = await db.from("crm_events").select("id", { count: "exact", head: true }).eq("action", "ai_request").eq("user_id", userId).gte("created_at", dublinDayStart(dublinToday()));
  if (error) throw new PublicError("Could not check today's allowance", error.message);
  return count ?? 0;
}

/** Today's allowance for one person, without using any of it. */
export async function allowance(userId: string): Promise<{ used: number; limit: number; remaining: number }> {
  const n = await used(createServiceClient(), userId);
  return { used: n, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - n) };
}

/**
 * One request to the AI, within the person's daily allowance. Only counts are kept (which feature, how many tokens),
 * never what was asked or answered.
 */
async function ask(db: Db, userId: string, feature: string, system: string, user: string, maxTokens: number, extra: Record<string, unknown> = {}): Promise<{ text: string; remaining: number } | AiFailure> {
  if (!process.env.ANTHROPIC_API_KEY) return fail("The AI service is not set up (the API key is missing).", 503);
  const before = await used(db, userId);
  if (before >= DAILY_LIMIT) return fail(`You have used today's ${DAILY_LIMIT} AI requests. The allowance starts again tomorrow.`, 429);

  const reply = await askClaude(system, user, maxTokens);
  if ("error" in reply) return fail(reply.error, 502);
  await logEvent(db, userId, "ai_request", "ai", null, { feature, input_tokens: reply.inputTokens, output_tokens: reply.outputTokens, stop_reason: reply.stopReason, ...extra });
  if (!reply.text) return fail("The AI did not give an answer. Please try again.", 502);
  return { text: reply.text, remaining: Math.max(0, DAILY_LIMIT - before - 1) };
}

// ---------- ask about sales ----------

export type AskInput = { question: string; range: string | null; from: string | null; to: string | null; category_id: string | null; staff_id: string | null };

/**
 * Answers a question about the sales figures, from the CRM's own records. The AI is given the figures for the period on
 * screen and the usual comparison periods, plus today's lists, and told to answer from those and to say when it cannot.
 */
export async function askAboutSales(input: AskInput, userId: string): Promise<{ answer: string; period: string; remaining: number } | AiFailure> {
  const today = dublinToday();
  const chosen = resolveRange(input.range, today, input.from, input.to);
  if ("error" in chosen) return fail(chosen.error, 400);

  const ranges: ResolvedRange[] = [chosen];
  for (const preset of ["this_month", "last_month", "this_week"]) {
    const r = resolveRange(preset, today);
    if (!("error" in r) && !ranges.some((x) => x.from === r.from && x.to === r.to)) ranges.push(r);
  }

  const db = createServiceClient();
  const start = ranges.reduce((a, r) => (r.startIso < a ? r.startIso : a), ranges[0].startIso);
  const end = ranges.reduce((a, r) => (r.endIso > a ? r.endIso : a), ranges[0].endIso);
  const data = await loadReportData(db, { startIso: start, endIso: end });
  const pack = buildSalesPack(data, today, { category_id: input.category_id, staff_id: input.staff_id }, ranges);

  const reply = await ask(db, userId, "ask", ASK_SYSTEM, `${block("crm_data", JSON.stringify(pack))}\n\n${block("question", clean(input.question, 500))}`, 3000);
  if (isFailure(reply)) return reply;
  return { answer: cleanAnswer(reply.text), period: chosen.label, remaining: reply.remaining };
}

// ---------- one company ----------

async function loadCompany(id: string) {
  const found = await getCompany(id);
  if (!found) return null;
  const [activities, tasks, opportunities] = await Promise.all([listActivities(id, 15), companyTasks(id), listOpportunities(id)]);
  return { ...found, activities, open: tasks.open, opportunities };
}

export async function suggestNextSteps(companyId: string, userId: string): Promise<(NextSteps & { remaining: number }) | AiFailure> {
  const loaded = await loadCompany(companyId);
  if (!loaded) return fail("That company was not found.", 404);
  const facts = nextStepFacts({ company: loaded.company, contacts: loaded.contacts, activities: loaded.activities, open: loaded.open, opportunities: loaded.opportunities, today: dublinToday() });

  const reply = await ask(createServiceClient(), userId, "next_step", NEXT_STEP_SYSTEM, block("company_facts", JSON.stringify(facts)), 3000);
  if (isFailure(reply)) return reply;
  const parsed = parseNextSteps(reply.text);
  if (!parsed) return fail("The AI gave an answer that could not be used. Please try again.", 502);
  return { ...parsed, remaining: reply.remaining };
}

export type DraftInput = { company_id: string; contact_id: string | null; channel: "WhatsApp" | "Email" | "Letter"; kind: "introduction" | "follow_up"; instructions: string };

export async function draftMessage(input: DraftInput, userId: string): Promise<(MessageDraft & { remaining: number; usedTemplate: boolean; wordingSet: boolean }) | AiFailure> {
  const loaded = await loadCompany(input.company_id);
  if (!loaded) return fail("That company was not found.", 404);
  let contact = null as (typeof loaded.contacts)[number] | null;
  if (input.contact_id) {
    contact = loaded.contacts.find((c) => c.id === input.contact_id) ?? null;
    if (!contact) return fail("That contact does not belong to this company.", 400);
  }

  const db = createServiceClient();
  const [settings, letterhead] = await Promise.all([getAiSettings(db), getLetterSettings()]);
  const wording = {
    about_us: clean(settings.about_us, 3000) || "(nothing set)",
    template: clean(settings.intro_template, 3000) || "(none set)",
    tone: clean(settings.tone, 300) || "(none set)",
    avoid: clean(settings.avoid, 600) || "(none set)",
  };
  const today = dublinToday();
  const facts = draftFacts({ company: loaded.company, contact, activities: loaded.activities, today, kind: input.kind });
  // The offers running now where this company is. A failure to read them means no offer is made, not that the draft fails.
  const offers = currentOffers(await specialsRunningFor(loaded.company.county, today, db).catch(() => []));

  const user = [
    block("prospect_facts", JSON.stringify(facts)),
    block("our_company", JSON.stringify(ourCompanyFacts(letterhead))),
    block("current_offers", offers.length ? JSON.stringify(offers) : "(none running)"),
    block("approved_wording", `About us (facts a message may state):\n${wording.about_us}\n\nApproved template:\n${wording.template}\n\nTone:\n${wording.tone}\n\nNever say or promise:\n${wording.avoid}`),
    block("request", `Channel: ${input.channel}\nStaff instructions: ${clean(input.instructions, 600) || "(none)"}`),
  ].join("\n\n");

  const reply = await ask(db, userId, "draft", DRAFT_SYSTEM, user, 3000, { channel: input.channel, kind: input.kind });
  if (isFailure(reply)) return reply;
  const draft = parseMessageDraft(reply.text, input.channel);
  if (!draft) return fail("The AI gave a draft that could not be used. Please try again.", 502);
  // A percentage or amount that is in neither the approved wording nor a current offer was not given to the writer.
  const allowed = [wording.about_us, wording.template, ...offers.map((o) => `${o.title} ${o.offer} ${o.code ?? ""}`)].join("\n");
  const invented = unsupportedFigures(`${draft.subject}\n${draft.body}`, allowed).map((f) => `The message mentions "${f}", which is not in your approved wording or the current offers. Check it before sending.`);
  draft.missing = [...invented, ...draft.missing].slice(0, 10);
  return { ...draft, remaining: reply.remaining, usedTemplate: !!settings.intro_template?.trim(), wordingSet: !!(settings.about_us?.trim() || settings.intro_template?.trim()) };
}

// ---------- research ----------

export type WebsiteResult = { read: boolean; url: string | null; title: string | null; truncated: boolean; note: string | null };
export type DetailsFound = { emails: { value: string; onRecord: boolean }[]; phones: { value: string; onRecord: boolean }[]; social: string[] };
export type ResearchResult = Omit<Research, "suggestions"> & { suggestions: (Research["suggestions"][number] & { category_id?: string })[]; website: WebsiteResult; details: DetailsFound; remaining: number };

/** Reads the company's own web address, if its robots.txt allows. Any problem becomes a note, and the research carries on without it. */
async function readWebsite(url: string, web: Web): Promise<{ page: ReturnType<typeof extractPage> | null; result: WebsiteResult }> {
  const none = (note: string): { page: null; result: WebsiteResult } => ({ page: null, result: { read: false, url, title: null, truncated: false, note } });
  try {
    const target = new URL(url);
    try {
      const robots = await web.fetch(`${target.origin}/robots.txt`, { accept: "text", maxBytes: 200_000, timeoutMs: 5000 });
      if (!robotsAllows(robots.body, target.pathname || "/")) return none("Their website asks not to be read by tools like this, so it was not read.");
    } catch (e) {
      // No robots.txt (or none we can read) is the usual case and means there are no rules. A blocked address is not that.
      if (e instanceof WebError && /not publicly reachable|not a public|numbers|login|ports|http or https/i.test(e.message)) return none(`The website could not be read: ${e.message}`);
    }
    const fetched = await web.fetch(url);
    const page = extractPage(fetched.body);
    if (!page.text && !page.title && !page.description) return none("The page had no readable text (it may need a browser to show its content).");
    return { page, result: { read: true, url: fetched.finalUrl, title: page.title || null, truncated: fetched.truncated, note: null } };
  } catch (e) {
    return none(e instanceof WebError ? `The website could not be read: ${e.message}` : "The website could not be read.");
  }
}

export async function researchCompany(input: { company_id: string; read_website: boolean }, userId: string, web: Web = REAL_WEB): Promise<ResearchResult | AiFailure> {
  const loaded = await loadCompany(input.company_id);
  if (!loaded) return fail("That company was not found.", 404);
  const db = createServiceClient();
  const { data: cats } = await db.from("crm_categories").select("id, name, sort_order, active").order("sort_order");
  const categories = (cats ?? []) as { id: string; name: string; sort_order: number; active: boolean }[];
  const { record, imported, categoryNames } = researchRecord({ company: loaded.company, categories });

  let page: ReturnType<typeof extractPage> | null = null;
  let website: WebsiteResult = { read: false, url: null, title: null, truncated: false, note: null };
  if (input.read_website) {
    if (!loaded.company.website) website = { ...website, note: "There is no website on record for this company." };
    else ({ page, result: website } = await readWebsite(loaded.company.website, web));
  }

  // What the AI sees is exactly what its quotes are checked against.
  const recordText = JSON.stringify({ ...record, categories_to_choose_from: categoryNames });
  const websiteText = page ? [page.title && `Title: ${page.title}`, page.description && `Description: ${page.description}`, page.text].filter(Boolean).join("\n") : "";
  const importedText = Object.entries(imported).map(([k, v]) => `${k}: ${v}`).join("\n");

  const user = [
    block("record", `${recordText}\n\nImported from a spreadsheet (unverified):\n${importedText || "(none)"}`),
    page ? block("website_text", websiteText) : "(No website text was available.)",
  ].join("\n\n");

  const reply = await ask(db, userId, "research", RESEARCH_SYSTEM, user, 3500, { website_read: website.read });
  if (isFailure(reply)) return reply;
  const parsed = parseResearch(reply.text, { record: `${recordText}\n${importedText}`, website: websiteText, imported: importedText }, categoryNames);
  if (!parsed) return fail("The AI gave an answer that could not be used. Please try again.", 502);

  const onRecord = (v: string, existing: string | null, key: (s: string | null) => string | null) => !!existing && key(existing) === key(v);
  const details: DetailsFound = {
    emails: (page?.emails ?? []).map((value) => ({ value, onRecord: onRecord(value, loaded.company.email, (s) => s?.toLowerCase() ?? null) })),
    phones: (page?.phones ?? []).map((value) => ({ value, onRecord: [loaded.company.phone, loaded.company.mobile].some((p) => !!phoneKey(p) && phoneKey(p) === phoneKey(value)) })),
    social: page?.social ?? [],
  };
  const suggestions = parsed.suggestions.map((s) => (s.field === "category" ? { ...s, category_id: categories.find((c) => c.name === s.value)?.id } : s));
  return { ...parsed, suggestions, website, details, remaining: reply.remaining };
}
