import { randomInt } from "crypto";
import { checkPassword } from "./password-policy";

const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?";
// Letters that look alike (I, l, O, 0, 1) are left out so a password read out or typed from a message is not misread.
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

const pick = (chars: string) => chars[randomInt(chars.length)];

/**
 * A temporary password for someone to sign in with and then change. Made with the system's secure random source (not the
 * ordinary random function, whose output can be predicted), with at least one of each kind of character, in a random order.
 */
export function generatePassword(length = 14): string {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  // Shuffle (Fisher-Yates) so the first four are not always lower, upper, digit, symbol.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const password = chars.join("");
  // Always passes; checked anyway so a change to the rules can never make us hand out a password the rules refuse.
  return "value" in checkPassword(password) ? password : generatePassword(length);
}
