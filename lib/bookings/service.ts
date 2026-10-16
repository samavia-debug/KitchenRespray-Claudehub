import { createServiceClient } from "@/lib/supabase/service";
import { fetchSchedulers, isConnecteamConfigured, type ConnecteamScheduler } from "@/lib/connecteam/client";
import { createShift, deleteShift, updateShift } from "@/lib/connecteam/shifts-write";
import { normaliseAppointments, shiftTitle } from "./appointments";
import {
  APPOINTMENT_SCHEDULER_NAME,
  appointmentSchedulerIdFromEnv,
  assigneesFor,
  bookingsWriteEnabled,
  extraSchedulerRefs,
  graphConfig,
  hasAssignments,
  serviceLabels,
} from "./config";
import { fetchBookingAppointments } from "./graph";
import { planSync, signatureOf, type DesiredShift, type Plan, type ShiftLink } from "./plan";
import { cleanStaffName } from "@/lib/letters/names";
import { loadStaff } from "@/lib/connecteam/vehicles-sync";

const WINDOW_DAYS = 90;
const LOCK_MINUTES = 10;

export type RunItem = {
  action: "create" | "update" | "remove" | "unchanged";
  service: string;
  startSec: number;
  firstName: string | null;
  /** Who the shift is (or will be) assigned to, or "Open shift". */
  assignedTo: string;
};

export type Counts = { create: number; update: number; remove: number; unchanged: number; done: number };

/** What happened in a schedule that gets a copy besides the Showroom Appointment one. */
export type ExtraResult = { schedulerId: number; name: string; counts: Counts; /** Appointments not copied here because nobody is assigned. */ skippedOpen: number };

export type RunResult = {
  state: "not_configured" | "preview" | "applied" | "busy" | "error";
  message?: string;
  writeEnabled: boolean;
  schedulerId?: number;
  counts?: Counts;
  items?: RunItem[];
  extras?: ExtraResult[];
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
  /** Other schedules (ids or names as configured) that also get a copy. */
  alsoCopiesTo: string[];
  linked: number;
  lastRunAt: string | null;
  lastResult: Pick<RunResult, "state" | "counts" | "errors" | "held" | "extras"> | null;
};

/** Cheap: reads only our own tables and the environment, never Microsoft or Connecteam. */
export async function getBookingsStatus(): Promise<BookingsStatus> {
  const supabase = createServiceClient();
  const [{ data: links }, { data: state }] = await Promise.all([
    supabase.from("booking_shift_links").select("booking_id"),
    supabase.from("booking_sync_state").select("last_run_at, last_result").eq("id", 1).maybeSingle(),
  ]);
  return {
    microsoftConfigured: graphConfig() !== null,
    connecteamConfigured: isConnecteamConfigured(),
    writeEnabled: bookingsWriteEnabled(),
    assignedTo: hasAssignments() ? "people" : "unassigned",
    alsoCopiesTo: extraSchedulerRefs(),
    // A booking copied into two schedules is still one booking.
    linked: new Set((links || []).map((l: { booking_id: string }) => l.booking_id)).size,
    lastRunAt: (state?.last_run_at as string | null) ?? null,
    lastResult: (state?.last_result as BookingsStatus["lastResult"]) ?? null,
  };
}

type Target = { id: number; name: string };

/** The Showroom Appointment schedule, and any extra schedules asked for, found by id or exact name. */
async function resolveTargets(): Promise<{ primary: Target; extras: Target[] } | { error: string }> {
  const all: ConnecteamScheduler[] = (await fetchSchedulers()).filter((s) => !s.isArchived);
  const nameOf = (id: number) => all.find((s) => s.schedulerId === id)?.name ?? `Schedule ${id}`;

  const fromEnv = appointmentSchedulerIdFromEnv();
  let primary: Target;
  if (fromEnv !== null) {
    primary = { id: fromEnv, name: nameOf(fromEnv) };
  } else {
    const matches = all.filter((s) => s.name.trim().toLowerCase() === APPOINTMENT_SCHEDULER_NAME.toLowerCase());
    if (matches.length !== 1) {
      return {
        error:
          matches.length === 0
            ? `No Connecteam scheduler called "${APPOINTMENT_SCHEDULER_NAME}" was found. Create it, or set CONNECTEAM_APPOINTMENT_SCHEDULER_ID.`
            : `More than one scheduler is called "${APPOINTMENT_SCHEDULER_NAME}". Set CONNECTEAM_APPOINTMENT_SCHEDULER_ID to choose one.`,
      };
    }
    primary = { id: matches[0].schedulerId, name: matches[0].name };
  }

  const extras: Target[] = [];
  for (const ref of extraSchedulerRefs()) {
    const asId = /^\d+$/.test(ref) ? Number(ref) : null;
    let found: Target | null = null;
    if (asId !== null) {
      found = all.some((s) => s.schedulerId === asId) ? { id: asId, name: nameOf(asId) } : null;
    } else {
      const m = all.filter((s) => s.name.trim().toLowerCase() === ref.toLowerCase());
      if (m.length > 1) return { error: `More than one scheduler is called "${ref}". Use its id in CONNECTEAM_EXTRA_SCHEDULERS instead.` };
      found = m.length === 1 ? { id: m[0].schedulerId, name: m[0].name } : null;
    }
    // A mistake here stops the whole run before anything is written, instead of quietly copying to the wrong place.
    if (!found) return { error: `CONNECTEAM_EXTRA_SCHEDULERS names "${ref}", but no active Connecteam schedule matches it.` };
    if (found.id === primary.id) continue;
    if (!extras.some((e) => e.id === found!.id)) extras.push(found);
  }
  return { primary, extras };
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

/** Carries out one schedule's plan. Returns how many changes succeeded; failures are added to `errors`. */
async function applyPlan(target: Target, plan: Plan, label: string, errors: string[]): Promise<number> {
  const supabase = createServiceClient();
  const shiftOf = (d: DesiredShift) => ({ startSec: d.startSec, endSec: d.endSec, title: d.title, assignees: d.assignees });
  const say = (what: string, e: any) => errors.push(`${label}${what} failed: ${e.message}`);
  let done = 0;

  for (const d of plan.create) {
    try {
      const shiftId = await createShift(target.id, shiftOf(d));
      const { error } = await supabase.from("booking_shift_links").insert({
        booking_id: d.bookingId,
        shift_id: shiftId,
        scheduler_id: target.id,
        service: d.service,
        start_at: new Date(d.startSec * 1000).toISOString(),
        end_at: new Date(d.endSec * 1000).toISOString(),
        title: d.title,
        signature: signatureOf(d),
      });
      if (error) {
        // Without the link the next run would copy it again, so take the new shift back out.
        await deleteShift(target.id, shiftId).catch(() => undefined);
        throw new Error(`could not record the link (${error.message})`);
      }
      done += 1;
    } catch (e: any) {
      say("Create", e);
    }
  }

  for (const { link, desired: d } of plan.update) {
    try {
      await updateShift(target.id, link.shift_id, shiftOf(d));
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
        .eq("booking_id", d.bookingId)
        .eq("scheduler_id", target.id);
      if (error) throw new Error(error.message);
      done += 1;
    } catch (e: any) {
      say("Update", e);
    }
  }

  for (const link of plan.remove) {
    try {
      try {
        await deleteShift(link.scheduler_id, link.shift_id);
      } catch (e) {
        if (!isGone(e)) throw e; // already deleted in Connecteam: just drop the link
      }
      const { error } = await supabase.from("booking_shift_links").delete().eq("booking_id", link.booking_id).eq("scheduler_id", link.scheduler_id);
      if (error) throw new Error(error.message);
      done += 1;
    } catch (e: any) {
      say("Remove", e);
    }
  }
  return done;
}

const countsOf = (plan: Plan): Counts => ({ create: plan.create.length, update: plan.update.length, remove: plan.remove.length, unchanged: plan.unchanged, done: 0 });

/**
 * Copies upcoming Microsoft Bookings appointments into the Showroom Appointment
 * schedule in Connecteam, and into any extra schedules asked for (such as the main
 * one, for appointments that have a person assigned). Without `apply`, or without
 * the write switch on, it only reports what it would do and changes nothing anywhere.
 * It does nothing at all until the Microsoft credentials are set.
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

    const targets = await resolveTargets();
    if ("error" in targets) {
      out.message = targets.error;
      return out;
    }
    out.schedulerId = targets.primary.id;

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

    const allLinks = await loadLinks();
    const linksFor = (id: number) => allLinks.filter((l) => l.scheduler_id === id);

    // The Showroom Appointment schedule takes everything. Extra schedules take only appointments with a
    // person assigned: an open shift there could be claimed by anyone on that schedule.
    const primaryPlan = planSync(desired, linksFor(targets.primary.id), nowSec, windowEndSec);
    const extraPlans = targets.extras.map((t) => {
      const assigned = desired.filter((d) => d.assignees.length > 0);
      return { target: t, plan: planSync(assigned, linksFor(t.id), nowSec, windowEndSec), skippedOpen: desired.filter((d) => d.endSec >= nowSec && d.assignees.length === 0).length };
    });

    out.held = [...primaryPlan.held, ...extraPlans.flatMap((e) => e.plan.held.map((h) => `${e.target.name}: ${h}`))];

    // Names for the "assigned to" column; if the staff list can't be read the page still works.
    const nameById = new Map<number, string>();
    try {
      for (const s of await loadStaff()) nameById.set(s.userId, cleanStaffName(s.name).name);
    } catch {
      // fall back to ids below
    }
    const who = (ids: number[]) => (ids.length === 0 ? "Open shift" : ids.map((id) => nameById.get(id) ?? `Connecteam user ${id}`).join(", "));
    const item = (action: RunItem["action"], d: DesiredShift): RunItem => ({
      action,
      service: d.service,
      startSec: d.startSec,
      firstName: firstNames.get(d.bookingId) ?? null,
      assignedTo: who(d.assignees),
    });

    // Everything upcoming, in time order, whether or not it needs a change, so a preview always shows something.
    out.items = [
      ...primaryPlan.create.map((d) => item("create", d)),
      ...primaryPlan.update.map(({ desired: d }) => item("update", d)),
      ...primaryPlan.unchangedList.map((d) => item("unchanged", d)),
      ...primaryPlan.remove.map((l) => ({ action: "remove" as const, service: l.service ?? "", startSec: Math.floor(Date.parse(l.start_at) / 1000), firstName: null, assignedTo: "" })),
    ].sort((a, b) => a.startSec - b.startSec);
    out.counts = countsOf(primaryPlan);
    out.extras = extraPlans.map((e) => ({ schedulerId: e.target.id, name: e.target.name, counts: countsOf(e.plan), skippedOpen: e.skippedOpen }));

    if (!writing) {
      out.state = "preview";
      out.message = apply ? "Writing to Connecteam is switched off, so this is only a preview." : undefined;
      return out;
    }

    out.counts.done = await applyPlan(targets.primary, primaryPlan, "", out.errors);
    for (let i = 0; i < extraPlans.length; i++) {
      const e = extraPlans[i];
      out.extras[i].counts.done = await applyPlan(e.target, e.plan, `${e.target.name}: `, out.errors);
    }

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
