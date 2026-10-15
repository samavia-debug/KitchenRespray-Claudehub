import type { GraphConfig } from "./config";
import type { RawAppointment } from "./appointments";

const MAX_PAGES = 20;

let cached: { key: string; token: string; expiresAt: number } | null = null;

// What Microsoft's sign-in error codes mean here, in words the person fixing it can act on.
const SIGN_IN_HINTS: Record<number, string> = {
  7000215: "The client secret is wrong. Use the secret's Value (not its Secret ID), pasted with no spaces or quote marks.",
  7000222: "The client secret has expired. Create a new secret in Entra and use its Value.",
  7000218: "The app is not set up for secret sign-in. Check it is a normal registered app with a client secret.",
  700016: "The client id was not found in this tenant. Check MS_GRAPH_CLIENT_ID and MS_GRAPH_TENANT_ID.",
  90002: "The tenant id was not found. Check MS_GRAPH_TENANT_ID.",
  900023: "The tenant id is not valid. Check MS_GRAPH_TENANT_ID.",
  700082: "The client secret has expired. Create a new secret in Entra and use its Value.",
};

/**
 * Microsoft's own code and a plain explanation. Only the numeric code is repeated: the
 * description Microsoft sends can carry ids and trace details, and the secret is never echoed.
 */
async function signInFailure(res: Response): Promise<string> {
  let code: number | null = null;
  try {
    const body = (await res.json()) as { error_codes?: unknown[] };
    const first = Array.isArray(body.error_codes) ? Number(body.error_codes[0]) : NaN;
    code = Number.isFinite(first) ? first : null;
  } catch {
    // not JSON: fall through to the general message
  }
  const hint = code !== null ? SIGN_IN_HINTS[code] : undefined;
  return `Microsoft sign-in failed (HTTP ${res.status}${code !== null ? `, AADSTS${code}` : ""}). ${hint ?? "Check the tenant id, client id and secret, and that the secret has not expired."}`;
}

/**
 * The application permissions ("roles") an app-only token carries, read from the token's own
 * payload. Nothing else from the token is looked at or kept. Null when it can't be read.
 */
export function tokenRoles(token: string): string[] | null {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { roles?: unknown };
    return Array.isArray(json.roles) ? json.roles.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return null;
  }
}

function permissionNote(roles: string[] | null): string {
  if (roles === null) return "";
  if (roles.length === 0) {
    return " The app's sign-in carries no application permissions at all: Bookings.Read.All was probably added as a Delegated permission instead of an Application one, or admin consent was not granted.";
  }
  if (!roles.some((r) => r.startsWith("Bookings"))) {
    return ` The app's sign-in carries these permissions but no Bookings one: ${roles.join(", ")}.`;
  }
  return ` The app's sign-in does carry ${roles.filter((r) => r.startsWith("Bookings")).join(", ")}, so the permission is in place; check the Bookings business id, or ask Microsoft.`;
}

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
    throw new Error(await signInFailure(res));
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
      let code = "";
      try {
        const body = (await res.json()) as { error?: { code?: unknown } };
        if (typeof body.error?.code === "string") code = body.error.code.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60);
      } catch {
        // no readable body
      }
      const hint =
        res.status === 401 || res.status === 403
          ? " The app may be missing the Bookings permission or admin consent."
          : res.status === 404
          ? " Check the Bookings business id."
          : "";
      throw new Error(`Microsoft Bookings returned HTTP ${res.status}${code ? ` (${code})` : ""}.${hint}${res.status === 401 || res.status === 403 ? permissionNote(tokenRoles(token)) : ""}`);
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
