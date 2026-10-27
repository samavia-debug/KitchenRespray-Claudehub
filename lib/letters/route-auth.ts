import { NextResponse } from "next/server";
import { requireRole, type Role } from "@/lib/auth/session";
import { LETTER_ROLES, canUseType } from "./access";

export type LettersAuth = { userId: string; role: Role };

/**
 * For the Letter Writer's routes: signed in, and an Admin, Manager or Staff member. What each may do with a particular letter is then
 * decided by its kind (`canUseType`): staff letters are Admin only, customer letters and quotes are open to all three.
 */
export async function lettersAccess(): Promise<LettersAuth | { error: NextResponse }> {
  const auth = await requireRole(LETTER_ROLES);
  if ("error" in auth) return auth;
  return { userId: auth.session.user.id, role: auth.session.profile!.role };
}

/** The answer for a letter the caller may not use: the same as a letter that is not there, so its existence is not given away. */
export const notFound = (what = "Letter") => NextResponse.json({ error: `${what} not found` }, { status: 404 });

export const mayUse = (auth: LettersAuth, letterType: string) => canUseType(auth.role, letterType);
