// Everything the Bookings -> Connecteam copy needs from the environment. It stays
// switched off until these are set: reading needs the Microsoft credentials,
// and writing to Connecteam needs BOOKINGS_TO_CONNECTEAM_ENABLED=true on top.
// Only the names of the variables live here, never their values.

export const APPOINTMENT_SCHEDULER_NAME = "Showroom Appointment";

export type GraphConfig = { tenantId: string; clientId: string; clientSecret: string; businessId: string };

// Pasting into a settings box often brings spaces, line breaks or quote marks with it.
const tidy = (v: string | undefined) => v?.trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();

export function graphConfig(env: NodeJS.ProcessEnv = process.env): GraphConfig | null {
  const tenantId = tidy(env.MS_GRAPH_TENANT_ID);
  const clientId = tidy(env.MS_GRAPH_CLIENT_ID);
  const clientSecret = tidy(env.MS_GRAPH_CLIENT_SECRET);
  const businessId = tidy(env.MS_BOOKINGS_BUSINESS_ID);
  return tenantId && clientId && clientSecret && businessId ? { tenantId, clientId, clientSecret, businessId } : null;
}

/** Reading bookings is allowed once credentials exist; writing to Connecteam needs this second, deliberate switch. */
export function bookingsWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BOOKINGS_TO_CONNECTEAM_ENABLED?.trim().toLowerCase() === "true";
}

export function appointmentSchedulerIdFromEnv(env: NodeJS.ProcessEnv = process.env): number | null {
  const n = Number(env.CONNECTEAM_APPOINTMENT_SCHEDULER_ID);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Connecteam user ids the appointments are assigned to; empty means unassigned (open) shifts. */
export function appointmentAssignees(env: NodeJS.ProcessEnv = process.env): number[] {
  return (env.CONNECTEAM_APPOINTMENT_USER_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
}

/** Optional renames such as {"Sandyford":"Home visit"}, so the shift title reads the way the team talks. */
export function serviceLabels(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  try {
    const parsed = JSON.parse(env.BOOKINGS_SERVICE_LABELS || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([k, v]) => typeof k === "string" && typeof v === "string")) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * The scheduler that holds copied appointments. The rota figures (who is
 * expected, who was late, scheduled hours) are read from every other scheduler,
 * so this one is left out of them: a customer appointment is not a technician's
 * working shift.
 */
export function isAppointmentScheduler(s: { schedulerId: number; name: string }, env: NodeJS.ProcessEnv = process.env): boolean {
  const id = appointmentSchedulerIdFromEnv(env);
  if (id !== null && s.schedulerId === id) return true;
  return s.name.trim().toLowerCase() === APPOINTMENT_SCHEDULER_NAME.toLowerCase();
}
