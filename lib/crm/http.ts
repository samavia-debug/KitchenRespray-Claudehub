import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { PublicError } from "./errors";

/** Joanna and Sajad (Staff) work in the CRM, Philip (Manager) oversees it, and an Admin manages it. Viewers have no access. */
export const CRM_ROLES = ["Admin", "Manager", "Staff"] as const;
/** Removing records, and changing the lists, is for the people who oversee the CRM. */
export const CRM_OVERSEER_ROLES = ["Admin", "Manager"] as const;

export const crmAccess = () => requireRole([...CRM_ROLES]);
export const crmOverseer = () => requireRole([...CRM_OVERSEER_ROLES]);
export const crmAdmin = () => requireRole(["Admin"]);

/** The full detail goes to the server log; the person sees only the plain message. */
export function serverError(err: any, fallback: string) {
  console.error(`[crm] ${fallback}:`, err);
  return NextResponse.json({ error: err instanceof PublicError ? err.publicMessage : fallback }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
