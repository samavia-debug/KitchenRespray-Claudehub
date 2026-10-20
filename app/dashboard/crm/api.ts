export type ApiResult = { ok: boolean; status: number; body: any };

/** A fetch that never throws: a network failure comes back as a result with a readable message. */
export async function api(url: string, init?: { method?: string; body?: unknown }): Promise<ApiResult> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (e: any) {
    return { ok: false, status: 0, body: { error: e?.message || "Network error" } };
  }
}

/** True when the database tables for the CRM have not been created yet (the migration has not been run). */
export const tablesMissing = (message: string | undefined | null) => !!message && /does not exist|could not find the table|schema cache|relation .* does not exist/i.test(message);
