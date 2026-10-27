import { createServiceClient } from "@/lib/supabase/service";
import { logEvent, type SaveResult } from "./service";
import type { ParsedImage, Signer, SignerInput } from "./signers";

// The list never carries the picture: `has_image` says whether there is one, and the picture is fetched by its own call.
const LIST_COLUMNS = "id, name, title, is_default, active, image_type";

const asSigner = (r: any): Signer => ({ id: r.id, name: r.name, title: r.title, is_default: r.is_default, active: r.active, has_image: !!r.image_type });

export async function listSigners(): Promise<Signer[]> {
  const { data, error } = await createServiceClient().from("letter_signers").select(LIST_COLUMNS).order("is_default", { ascending: false }).order("name").limit(200);
  if (error) throw new Error(error.message);
  return (data || []).map(asSigner);
}

export type StoredImage = { data: Buffer; type: "png" | "jpeg"; width: number; height: number };

export async function getSignerImage(id: string): Promise<StoredImage | null> {
  const { data, error } = await createServiceClient().from("letter_signers").select("image_base64, image_type, image_width, image_height").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.image_base64 || !data.image_type) return null;
  return { data: Buffer.from(data.image_base64, "base64"), type: data.image_type, width: data.image_width ?? 0, height: data.image_height ?? 0 };
}

const imageColumns = (img: ParsedImage) => ({ image_base64: img.data.toString("base64"), image_type: img.info.type, image_width: img.info.width, image_height: img.info.height });
const NO_IMAGE = { image_base64: null, image_type: null, image_width: null, image_height: null };

/** Only one signer is the default: making one the default takes it from the others. */
async function takeDefault(exceptId: string | null) {
  let q = createServiceClient().from("letter_signers").update({ is_default: false }).eq("is_default", true);
  if (exceptId) q = q.neq("id", exceptId);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

export async function createSigner(input: SignerInput, image: ParsedImage | null, userId: string): Promise<string> {
  if (input.is_default) await takeDefault(null);
  const { data, error } = await createServiceClient()
    .from("letter_signers")
    .insert({ ...input, ...(image ? imageColumns(image) : {}), created_by: userId, updated_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await logEvent(null, userId, "signer_created", { signer_id: data.id, has_image: !!image });
  return data.id;
}

/** `image`: a new picture, `null` to remove the picture, `undefined` to leave it as it is. */
export async function updateSigner(id: string, input: SignerInput, image: ParsedImage | null | undefined, userId: string): Promise<SaveResult> {
  if (input.is_default) await takeDefault(id);
  const patch = { ...input, ...(image === undefined ? {} : image === null ? NO_IMAGE : imageColumns(image)), updated_by: userId, updated_at: new Date().toISOString() };
  const { data, error } = await createServiceClient().from("letter_signers").update(patch).eq("id", id).select("id");
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!data || data.length === 0) return { ok: false, error: "Signer not found", status: 404 };
  await logEvent(null, userId, "signer_updated", { signer_id: id, image: image === undefined ? "unchanged" : image === null ? "removed" : "replaced" });
  return { ok: true };
}

export async function deleteSigner(id: string, userId: string): Promise<SaveResult> {
  const { data, error } = await createServiceClient().from("letter_signers").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!data || data.length === 0) return { ok: false, error: "Signer not found", status: 404 };
  await logEvent(null, userId, "signer_deleted", { signer_id: id });
  return { ok: true };
}
