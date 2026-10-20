/**
 * Asks the server for an export and saves it as a file. Returns a message when something went wrong, otherwise null.
 * (The request is a POST so a long list of selected companies does not have to fit in a web address.)
 */
export async function downloadExport(body: { type: string; format: "csv" | "xlsx"; qs?: string; ids?: string[] }): Promise<string | null> {
  try {
    const res = await fetch("/api/crm/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return j.error || "Could not export the data";
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `crm-${body.type}.${body.format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return null;
  } catch (e: any) {
    return e?.message || "Network error";
  }
}
