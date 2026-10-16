import { timingSafeEqual } from "crypto";

/**
 * True when the request carries "Authorization: Bearer <CRON_SECRET>". Compared in constant
 * time, and false when no secret is configured, so an unset secret can never let anyone in.
 */
export function isCronAuthorized(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
