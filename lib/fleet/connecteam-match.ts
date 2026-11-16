import type { DueKind } from "./fleet";

/** A person in Connecteam, as far as matching a van's driver goes. */
export type Person = { id: number; name: string };

export type CatalogDocument = { documentId: number; name: string };
export type UserDocumentRow = { userId: number; documentId: number; status?: string; uploadedAt?: number; expiresAt?: number };

/** The documents that hold each kind of date, found by their names in Connecteam ("Van tax", "Van DOE", "Van insurance"). */
const DOCUMENT_NAME: Record<DueKind, RegExp> = {
  tax: /\bvan\s*tax\b/i,
  doe: /\bvan\s*doe\b/i,
  insurance: /\bvan\s*insurance\b/i,
};

export function findVanDocuments(catalog: CatalogDocument[]): Partial<Record<DueKind, number>> {
  const found: Partial<Record<DueKind, number>> = {};
  for (const kind of Object.keys(DOCUMENT_NAME) as DueKind[]) {
    const doc = catalog.find((d) => DOCUMENT_NAME[kind].test(d.name));
    if (doc) found[kind] = doc.documentId;
  }
  return found;
}

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ");

/**
 * The one person a van's driver is, or null when it cannot be said. Drivers are written as a first name
 * ("Derek", "Anthonny."), sometimes with the group letter run on ("Kalex" for K Alex), while Connecteam
 * names carry the group letter first ("K Alex Koufalis"). Two people sharing a first name, or no one, means null:
 * the Admin picks the person on the van instead of the Hub guessing.
 */
export function suggestPerson(driver: string | null, people: Person[]): Person | null {
  const d = plain(driver ?? "").replace(/\s+/g, "");
  if (d.length < 3) return null;

  const matches = people.filter((p) => {
    const words = plain(p.name).split(/\s+/).filter(Boolean);
    const named = words.filter((w) => w.length > 1);
    const withGroupLetter = words.length >= 2 && words[0].length === 1 ? words[0] + words[1] : null;
    return named.includes(d) || withGroupLetter === d;
  });
  return matches.length === 1 ? matches[0] : null;
}

/** Connecteam gives a date as seconds; the van list keeps a plain date. */
export const dateOfEpoch = (seconds: number | undefined): string | null =>
  typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString().slice(0, 10) : null;

/** The dates Connecteam holds for one person, by kind; a kind with no date is left out. */
export function datesForPerson(rows: UserDocumentRow[], userId: number, documents: Partial<Record<DueKind, number>>): Partial<Record<DueKind, string>> {
  const out: Partial<Record<DueKind, string>> = {};
  for (const kind of Object.keys(documents) as DueKind[]) {
    const row = rows.find((r) => r.userId === userId && r.documentId === documents[kind]);
    const date = dateOfEpoch(row?.expiresAt);
    if (date) out[kind] = date;
  }
  return out;
}
