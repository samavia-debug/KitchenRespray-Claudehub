import type { GraphConfig } from "./config";
import type { RawAppointment } from "./appointments";

const MAX_PAGES = 20;

let cached: { key: string; token: string; expiresAt: number } | null = null;

/**
 * An app-only token for Microsoft Graph (client credentials). The secret never
 * leaves the server and is never put in an error message.
 */
async function accessToken(cfg: GraphConfig): Promise<string> {
  const key = `${cfg.tenantId}|${cfg.clientId}`;
  if (cached && cached.key === key && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(`Microsoft sign-in failed (HTTP ${res.status}). Check the tenant, client id and secret, and that the secret has not expired.`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Microsoft sign-in returned no access token.");
  cached = { key, token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3000) * 1000 };
  return data.access_token;
}

/**
 * Appointments starting between two instants, from the Bookings business's
 * calendar view. Read-only. Follows Microsoft's paging links, but only to
 * graph.microsoft.com, so a crafted link can't send the token elsewhere.
 */
export async function fetchBookingAppointments(cfg: GraphConfig, fromIso: string, toIso: string): Promise<RawAppointment[]> {
  const token = await accessToken(cfg);
  let url: string | null =
    `https://graph.microsoft.com/v1.0/solutions/bookingBusinesses/${encodeURIComponent(cfg.businessId)}/calendarView?start=${encodeURIComponent(fromIso)}&end=${encodeURIComponent(toIso)}`;
  const all: RawAppointment[] = [];

  for (let page = 0; page < MAX_PAGES && url; page++) {
    if (!url.startsWith("https://graph.microsoft.com/")) throw new Error("Microsoft returned an unexpected paging link.");
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? " The app may be missing the Bookings permission or admin consent."
          : res.status === 404
          ? " Check the Bookings business id."
          : "";
      throw new Error(`Microsoft Bookings returned HTTP ${res.status}.${hint}`);
    }
    const body = (await res.json()) as { value?: RawAppointment[]; "@odata.nextLink"?: string };
    all.push(...(body.value ?? []));
    url = body["@odata.nextLink"] ?? null;
  }
  return all;
}

/** For tests: forget the cached token. */
export function resetGraphTokenCache() {
  cached = null;
}
