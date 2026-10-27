import type { Role } from "../auth/session";
import { LETTER_TYPE_BY_KEY, type LetterDomain } from "./config";

// Who may use which letters. Letters about staff (employment letters, references, warnings) are confidential and stay with Admins.
// Customer letters and quotes are everyday sales work, so Managers and Staff can write them too, like the Trade Sales CRM.

export const HR_ROLES: Role[] = ["Admin"];
export const SALES_ROLES: Role[] = ["Admin", "Manager", "Staff"];
/** Everyone who may open the Letter Writer at all. */
export const LETTER_ROLES: Role[] = SALES_ROLES;

export const domainOf = (letterType: string): LetterDomain => LETTER_TYPE_BY_KEY[letterType]?.domain ?? "hr";

/** An unknown kind of letter is treated as an HR one, so a mistake never opens staff letters up. */
export function canUseType(role: Role | undefined | null, letterType: string): boolean {
  if (!role) return false;
  return (domainOf(letterType) === "sales" ? SALES_ROLES : HR_ROLES).includes(role);
}

/** The kinds of letter a role may see in lists. */
export function typesFor(role: Role | undefined | null): string[] {
  return Object.keys(LETTER_TYPE_BY_KEY).filter((t) => canUseType(role, t));
}

export const isAdmin = (role: Role | undefined | null) => role === "Admin";
