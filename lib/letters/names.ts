/**
 * In Connecteam most staff are saved with a one-letter code in front of their
 * name ("K Derek Morkan", "B Anna Murphy"), which looks like a branch or team
 * code. It is useful in the app but must not appear on a letter. The code is
 * removed only when what is left still looks like a full name (two or more
 * words), so a real "J Smith" is left alone. The page shows the original name
 * and lets the person correct the result.
 */
export function cleanStaffName(raw: string): { name: string; prefix: string | null } {
  const text = raw.replace(/\s+/g, " ").trim();
  const m = /^([A-Za-z])\s+(\S.*)$/.exec(text);
  if (m && m[2].trim().split(" ").length >= 2) return { name: m[2].trim(), prefix: m[1].toUpperCase() };
  return { name: text, prefix: null };
}
