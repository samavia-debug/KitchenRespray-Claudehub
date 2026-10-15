import { createServiceClient } from "@/lib/supabase/service";
import { fetchSchedulers, isConnecteamConfigured } from "@/lib/connecteam/client";
import { createShift, deleteShift, updateShift } from "@/lib/connecteam/shifts-write";
import { normaliseAppointments, shiftTitle } from "./appointments";
import { APPOINTMENT_SCHEDULER_NAME, appointmentSchedulerIdFromEnv, assigneesFor, bookingsWriteEnabled, graphConfig, hasAssignments, serviceLabels } from "./config";
import { fetchBookingAppointments } from "./graph";
import { planSync, signatureOf, type DesiredShift, type ShiftLink } from "./plan";

const WINDOW_DAYS = 90;
const LOCK_MINUTES = 10;

export type RunItem = { action: "create" | "update" | "remove" | "unchanged"; service: string; startSec: number; firstName: string | null };

export type RunResult = {
  state: "not_configured" | "preview" | "applied" | "busy" | "error";
  message?: string;
  writeEnabled: boolean;
  schedulerId?: number;
  counts?: { create: number; update: number; remove: number; unchanged: number; done: number };
  items?: RunItem[];
  held: string[];
  errors: string[];
  skippedAppointments: number;
};

const base = (over: Partial<RunResult>): RunResult => ({ state: "error", writeEnabled: bookingsWriteEnabled(), held: [], errors: [], skippedAppointments: 0, ...over });

export type BookingsStatus = {
  microsoftConfigured: boolean;
  connecteamConfigured: boolean;
  writeEnabled: boolean;
  assignedTo: "unassigned" | "people";
  linked: number;
  lastRunAt: string | null;
  lastResult: Pick<RunResult, "state" | "counts" | "errors" | "held"> | null;
};

/** Cheap: reads only our own tables and the environment, never Microsoft or Connecteam. */
export async function getBookingsStatus(): Promise<BookingsStatus> {
  const supabase = createServiceClient();
  const [{ count }, { data: state }] = await Promise.all([
    supabase.from("booking_shift_links").select("booking_id", { count: "exact", head: true }),
    supabase.from("booking_sync_state").select("last_run_at, last_result").eq("id", 1).maybeSingle(),
  ]);
  return {
    microsoftConfigured: graphConfig() !== null,
    connecteamConfigured: isConnecteamConfigured(),
    writeEnabled: bookingsWriteEnabled(),
    assignedTo: hasAssignments() ? "people" : "unassigned",
    linked: count ?? 0,
    lastRunAt: (state?.last_run_at as string | null) ?? null,
    lastResult: (state?.last_result as BookingsStatus["lastResult"]) ?? null,
  };
}

async function resolveScheduler(): Promise<{ id: number } | { error: string }> {
  const fromEnv = appointmentSchedulerIdFromEnv();
  if (fromEnv !== null) return { id: fromEnv };
  const matches = (await fetchSchedulers()).filter((s) => !s.isArchived && s.name.trim().toLowerCase() === APPOINTMENT_SCHEDULER_NAME.toLowerCase());
  if (matches.length === 1) return { id: matches[0].schedulerId };
  return {
    error:
      matches.length === 0
        ? `No Connecteam scheduler called "${APPOINTMENT_SCHEDULER_NAME}" was found. Create it, or set CONNECTEAM_APPOINTMENT_SCHEDULER_ID.`
        : `More than one scheduler is called "${APPOINTMENT_SCHEDULER_NAME}". Set CONNECTEAM_APPOINTMENT_SCHEDULER_ID to choose one.`,
  };
}

async function loadLinks(): Promise<ShiftLink[]> {
  const { data, error } = await createServiceClient().from("booking_shift_links").select("booking_id, shift_id, scheduler_id, service, start_at, end_at, title, signature");
  if (error) throw new Error(error.message);
  return (data || []) as ShiftLink[];
}

async function acquireLock(): Promise<boolean> {
  const staleBefore = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  const { data } = await createServiceClient()
    .from("booking_sync_state")
    .update({ running_since: new Date().toISOString() })
    .eq("id", 1)
    .or(`running_since.is.null,running_since.lt.${staleBefore}`)
    .select("id");
  return (data?.length ?? 0) > 0;
}

async function release(result: RunResult) {
  // What is kept is counts and messages, never customer details.
  const { items: _items, ...summary } = result;
  await createServiceClient()
    .from("booking_sync_state")
    .update({ running_since: null, last_run_at: new Date().toISOString(), last_result: summary })
    .eq("id", 1);
}

const isGone = (e: unknown) => e instanceof Error && /HTTP 404/.test(e.message);

/**
 * Copies upcoming Microsoft Bookings appointments into the Showroom Appointment
 * scheduler in Connecteam. Without `apply`, or without the write switch on, it
 * only reports what it would do and changes nothing anywhere. It does nothing at
 * all until the Microsoft credentials are set.
 */
export async function runBookingsSync({ apply }: { apply: boolean }): Promise<RunResult> {
  const cfg = graphConfig();
  if (!cfg) return base({ state: "not_configured", message: "Microsoft Bookings is not connected yet (the Microsoft credentials are not set)." });
  if (!isConnecteamConfigured()) return base({ state: "not_configured", message: "Connecteam is not connected (CONNECTEAM_API_KEY is not set)." });

  const writing = apply && bookingsWriteEnabled();
  let locked = false;
  const out = base({});

  try {
    if (writing) {
      locked = await acquireLock();
      if (!locked) return base({ state: "busy", message: "A copy is already running. Try again in a few minutes." });
    }

    const scheduler = await resolveScheduler();
    if ("error" in scheduler) {
      out.message = scheduler.error;
      return out;
    }
    out.schedulerId = scheduler.id;

    const nowSec = Math.floor(Date.now() / 1000);
    const windowEndSec = nowSec + WINDOW_DAYS * 86_400;
    const raw = await fetchBookingAppointments(cfg, new Date((nowSec - 6 * 3600) * 1000).toISOString(), new Date(windowEndSec * 1000).toISOString());
    const { appointments, skipped } = normaliseAppointments(raw);
    out.skippedAppointments = skipped;

    const labels = serviceLabels();
    const desired: DesiredShift[] = appointments.map((a) => ({
      bookingId: a.id,
      service: a.service,
      startSec: a.startSec,
      endSec: a.endSec,
      title: shiftTitle(a, labels),
      // Each showroom can belong to a different person.
      assignees: assigneesFor(a.service),
    }));
    const firstNames = new Map(appointments.map((a) => [a.id, a.firstName]));

    const links = await loadLinks();
    const plan = planSync(desired, links, nowSec, windowEndSec);
    out.held = plan.held;

    const items: RunItem[] = [
      ...plan.create.map((d) => ({ action: "create" as const, service: d.service, startSec: d.startSec, firstName: firstNames.get(d.bookingId) ?? null })),
      ...plan.update.map(({ desired: d }) => ({ action: "update" as const, service: d.service, startSec: d.startSec, firstName: firstNames.get(d.bookingId) ?? null })),
      ...plan.remove.map((l) => ({ action: "remove" as const, service: l.service ?? "", startSec: Math.floor(Date.parse(l.start_at) / 1000), firstName: null })),
    ];
    out.items = items;
    out.counts = { create: plan.create.length, update: plan.update.length, remove: plan.remove.length, unchanged: plan.unchanged, done: 0 };

    if (!writing) {
      out.state = "preview";
      out.message = apply ? "Writing to Connecteam is switched off, so this is only a preview." : undefined;
      return out;
    }

    const supabase = createServiceClient();
    const shiftOf = (d: DesiredShift) => ({ startSec: d.startSec, endSec: d.endSec, title: d.title, assignees: d.assignees });
    let done = 0;

    for (const d of plan.create) {
      try {
        const shiftId = await createShift(scheduler.id, shiftOf(d));
        const { error } = await supabase.from("booking_shift_links").insert({
          booking_id: d.bookingId,
          shift_id: shiftId,
          scheduler_id: scheduler.id,
          service: d.service,
          start_at: new Date(d.startSec * 1000).toISOString(),
          end_at: new Date(d.endSec * 1000).toISOString(),
          title: d.title,
          signature: signatureOf(d),
        });
        if (error) {
          // Without the link the next run would copy it again, so take the new shift back out.
          await deleteShift(scheduler.id, shiftId).catch(() => undefined);
          throw new Error(`could not record the link (${error.message})`);
        }
        done += 1;
      } catch (e: any) {
        out.errors.push(`Create failed: ${e.message}`);
      }
    }

    for (const { link, desired: d } of plan.update) {
      try {
        await updateShift(scheduler.id, link.shift_id, shiftOf(d));
        const { error } = await supabase
          .from("booking_shift_links")
          .update({
            service: d.service,
            start_at: new Date(d.startSec * 1000).toISOString(),
            end_at: new Date(d.endSec * 1000).toISOString(),
            title: d.title,
            signature: signatureOf(d),
            updated_at: new Date().toISOString(),
          })
          .eq("booking_id", d.bookingId);
        if (error) throw new Error(error.message);
        done += 1;
      } catch (e: any) {
        out.errors.push(`Update failed: ${e.message}`);
      }
    }

    for (const link of plan.remove) {
      try {
        try {
          await deleteShift(link.scheduler_id, link.shift_id);
        } catch (e) {
          if (!isGone(e)) throw e; // already deleted in Connecteam: just drop the link
        }
        const { error } = await supabase.from("booking_shift_links").delete().eq("booking_id", link.booking_id);
        if (error) throw new Error(error.message);
        done += 1;
      } catch (e: any) {
        out.errors.push(`Remove failed: ${e.message}`);
      }
    }

    out.counts.done = done;
    out.state = "applied";
    return out;
  } catch (e: any) {
    out.state = "error";
    out.message = e.message || "The copy failed.";
    return out;
  } finally {
    if (locked) await release(out).catch(() => undefined);
  }
}
