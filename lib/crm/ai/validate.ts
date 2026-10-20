import { clean } from "./text";
import { isUuid } from "../validate";
import type { AiSettings } from "./facts";
import type { AskInput, DraftInput } from "./service";

type Cleaned<T> = { value: T } | { error: string };
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function cleanAskInput(input: unknown): Cleaned<AskInput> {
  const raw = obj(input);
  if (!raw) return { error: "Nothing was sent" };
  const question = clean(raw.question, 600);
  if (question.length < 3) return { error: "Type your question first." };
  if (question.length > 500) return { error: "Please keep the question to 500 characters." };
  const category = raw.category_id;
  const staff = raw.staff_id;
  if (category && category !== "none" && !isUuid(category)) return { error: "That category is not valid" };
  if (staff && !isUuid(staff)) return { error: "That person is not valid" };
  return {
    value: {
      question,
      range: typeof raw.range === "string" ? raw.range.slice(0, 20) : null,
      from: typeof raw.from === "string" ? raw.from.slice(0, 10) : null,
      to: typeof raw.to === "string" ? raw.to.slice(0, 10) : null,
      category_id: category === "none" ? "__none__" : typeof category === "string" && category ? category : null,
      staff_id: typeof staff === "string" && staff ? staff : null,
    },
  };
}

export function cleanDraftInput(input: unknown): Cleaned<DraftInput> {
  const raw = obj(input);
  if (!raw) return { error: "Nothing was sent" };
  if (!isUuid(raw.company_id)) return { error: "Choose a company" };
  if (raw.contact_id !== undefined && raw.contact_id !== null && raw.contact_id !== "" && !isUuid(raw.contact_id)) return { error: "That contact is not valid" };
  if (raw.channel !== "WhatsApp" && raw.channel !== "Email" && raw.channel !== "Letter") return { error: "Choose WhatsApp, email or letter" };
  const kind = raw.kind === "follow_up" ? "follow_up" : "introduction";
  const instructions = clean(raw.instructions, 700);
  if (instructions.length > 600) return { error: "Please keep the instructions to 600 characters." };
  return { value: { company_id: raw.company_id, contact_id: typeof raw.contact_id === "string" && raw.contact_id ? raw.contact_id : null, channel: raw.channel, kind, instructions } };
}

export function cleanResearchInput(input: unknown): Cleaned<{ company_id: string; read_website: boolean }> {
  const raw = obj(input);
  if (!raw) return { error: "Nothing was sent" };
  if (!isUuid(raw.company_id)) return { error: "Choose a company" };
  return { value: { company_id: raw.company_id, read_website: raw.read_website === true } };
}

export const SETTING_LIMITS = { about_us: 3000, intro_template: 3000, tone: 300, avoid: 600 } as const;

export function cleanAiSettings(input: unknown): Cleaned<AiSettings> {
  const raw = obj(input);
  if (!raw) return { error: "Nothing was sent" };
  const out = {} as AiSettings;
  for (const key of Object.keys(SETTING_LIMITS) as (keyof AiSettings)[]) {
    const v = raw[key];
    if (v !== undefined && v !== null && typeof v !== "string") return { error: "Each setting must be text" };
    const text = clean(v, SETTING_LIMITS[key] + 1);
    if (text.length > SETTING_LIMITS[key]) return { error: `That is too long (${SETTING_LIMITS[key]} characters at most)` };
    out[key] = text || null;
  }
  return { value: out };
}
