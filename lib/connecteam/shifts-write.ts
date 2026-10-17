import { connecteamSend } from "./client";

export type NewShift = {
  startSec: number;
  endSec: number;
  title: string;
  /** Empty means an open (unassigned) shift. */
  assignees: number[];
  /** Text shown inside the shift, as HTML. */
  notesHtml?: string;
};

/**
 * The request body for one shift. Times are unix seconds, which Connecteam reads
 * as absolute instants; the timezone is only how the shift is shown.
 * An unassigned shift is created as an open shift for one person.
 */
export function shiftPayload(s: NewShift): Record<string, unknown> {
  const body: Record<string, unknown> = {
    startTime: s.startSec,
    endTime: s.endSec,
    title: s.title,
    isPublished: true,
    timezone: "Europe/Dublin",
  };
  if (s.notesHtml) body.notes = [{ type: "html", html: s.notesHtml }];
  if (s.assignees.length > 0) body.assignedUserIds = s.assignees;
  else Object.assign(body, { isOpenShift: true, openSpots: 1 });
  return body;
}

/** Changing a shift can move it between open and assigned, so an update says which it now is. */
export function shiftUpdatePayload(id: string, s: NewShift): Record<string, unknown> {
  // Connecteam's update call names the shift "shiftId" (a request with "id" is refused with HTTP 400).
  return { shiftId: id, ...shiftPayload(s), ...(s.assignees.length > 0 ? { isOpenShift: false } : {}), isEditForAllUsers: true };
}

/** Connecteam's answer to a create carries the new shifts; anything else is not trusted as a success. */
export function createdShiftId(response: unknown): string | null {
  const shifts = (response as { data?: { shifts?: { id?: unknown }[] } } | null)?.data?.shifts;
  const id = Array.isArray(shifts) ? shifts[0]?.id : undefined;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

export async function createShift(schedulerId: number, s: NewShift): Promise<string> {
  const response = await connecteamSend("POST", `/scheduler/v1/schedulers/${schedulerId}/shifts`, [shiftPayload(s)]);
  const id = createdShiftId(response);
  if (!id) throw new Error("Connecteam accepted the shift but did not say which one it created, so it was not recorded.");
  return id;
}

export async function updateShift(schedulerId: number, shiftId: string, s: NewShift): Promise<void> {
  await connecteamSend("PUT", `/scheduler/v1/schedulers/${schedulerId}/shifts`, [shiftUpdatePayload(shiftId, s)]);
}

export async function deleteShift(schedulerId: number, shiftId: string): Promise<void> {
  await connecteamSend("DELETE", `/scheduler/v1/schedulers/${schedulerId}/shifts/${encodeURIComponent(shiftId)}`);
}
