// The rules for a password, shared by the screens (to tell people straight away) and the server (which has the last word).
// No secrets and nothing from the server in here, so it is safe to use in the browser.

export const PASSWORD_MIN = 8;
// Passwords are hashed with bcrypt, which only reads the first 72 bytes: a longer one would be silently cut short.
export const PASSWORD_MAX = 72;

const COMMON = new Set([
  "password", "password1", "password12", "password123", "12345678", "123456789", "1234567890", "qwertyui", "qwerty123", "11111111",
  "00000000", "abcd1234", "iloveyou", "admin123", "welcome1", "letmein1",
]);

/** Whether this would do as a password. `email` is the person's own address, which may not be used as it. */
export function checkPassword(password: unknown, email?: string | null): { value: string } | { error: string } {
  if (typeof password !== "string" || password.length === 0) return { error: "Enter a password" };
  if (password.length < PASSWORD_MIN) return { error: `The password must be at least ${PASSWORD_MIN} characters` };
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) return { error: `The password is too long (${PASSWORD_MAX} characters at most)` };
  if (/^(.)\1+$/.test(password)) return { error: "The password cannot be one character repeated" };
  if (password.trim() !== password) return { error: "The password cannot start or end with a space" };
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return { error: "That password is too common. Choose something harder to guess." };
  const mail = (email ?? "").trim().toLowerCase();
  if (mail && (lower === mail || lower === mail.split("@")[0])) return { error: "The password cannot be the email address" };
  return { value: password };
}
