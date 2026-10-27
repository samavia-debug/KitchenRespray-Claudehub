import { createServiceClient } from "@/lib/supabase/service";
import { logEvent, type SaveResult } from "./service";
import { starterTemplates, type LetterTemplate, type TemplateInput } from "./templates";

const COLUMNS = "id, name, category, letter_type, subject, greeting, body, closing, created_at, updated_at";

export async function listTemplates(): Promise<LetterTemplate[]> {
  const { data, error } = await createServiceClient().from("letter_templates").select(COLUMNS).order("category").order("name").limit(500);
  if (error) throw new Error(error.message);
  return (data || []) as LetterTemplate[];
}

export async function getTemplate(id: string): Promise<LetterTemplate | null> {
  const { data, error } = await createServiceClient().from("letter_templates").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LetterTemplate | null) ?? null;
}

export async function createTemplate(input: TemplateInput, userId: string): Promise<string> {
  const { data, error } = await createServiceClient().from("letter_templates").insert({ ...input, created_by: userId, updated_by: userId }).select("id").single();
  if (error) throw new Error(error.message);
  await logEvent(null, userId, "template_created", { template_id: data.id, category: input.category });
  return data.id;
}

export async function updateTemplate(id: string, input: TemplateInput, userId: string): Promise<SaveResult> {
  const { data, error } = await createServiceClient()
    .from("letter_templates")
    .update({ ...input, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!data || data.length === 0) return { ok: false, error: "Template not found", status: 404 };
  await logEvent(null, userId, "template_updated", { template_id: id });
  return { ok: true };
}

export async function deleteTemplate(id: string, userId: string): Promise<SaveResult> {
  const { data, error } = await createServiceClient().from("letter_templates").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!data || data.length === 0) return { ok: false, error: "Template not found", status: 404 };
  await logEvent(null, userId, "template_deleted", { template_id: id });
  return { ok: true };
}

/** Adds the ready-made wording as templates; one whose name is already there is left alone, so it is safe to run twice. */
export async function addStarterTemplates(userId: string): Promise<number> {
  const existing = new Set((await listTemplates()).map((t) => t.name));
  const fresh = starterTemplates().filter((t) => !existing.has(t.name));
  if (fresh.length === 0) return 0;
  const { error } = await createServiceClient()
    .from("letter_templates")
    .insert(fresh.map((t) => ({ ...t, created_by: userId, updated_by: userId })));
  if (error) throw new Error(error.message);
  await logEvent(null, userId, "template_starters_added", { count: fresh.length });
  return fresh.length;
}
