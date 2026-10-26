import { fetchAllConnecteamUsers, isConnecteamConfigured, type ConnecteamCustomField } from "../connecteam/client";

// The home address is deliberately not copied into the Hub with the rest of the staff record (see
// connecteam/mapping.ts). A letter to a person needs it, so it is read from Connecteam for that one person
// when they are chosen, shown on the page, and kept only on a letter that is saved.

const ADDRESS_FIELD = /address/i;
const NOT_AN_ADDRESS = /e-?mail|web|ip\b|work|office|branch|site|emergency/i;
const PARTS = ["street", "address", "addressLine1", "address1", "line1", "addressLine2", "address2", "line2", "city", "town", "county", "state", "region", "postcode", "postalCode", "zip", "zipCode", "eircode", "country"];

/** A custom field's value as one comma-separated line, whether Connecteam sends text, a list or an address object. */
export function addressText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.replace(/\s*[\r\n]+\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(addressText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const key of ["formattedAddress", "fullAddress", "formatted", "value"]) {
      const whole = addressText(o[key]);
      if (whole) return whole;
    }
    return PARTS.map((k) => addressText(o[k])).filter(Boolean).join(", ");
  }
  return "";
}

/** The home address among a person's custom fields: the one named like an address, not a work or web one. */
export function findAddress(fields: ConnecteamCustomField[] | undefined): string {
  const candidates = (fields ?? []).filter((f) => ADDRESS_FIELD.test(f.name) && !NOT_AN_ADDRESS.test(f.name));
  // "Home address" before a plain "Address".
  candidates.sort((a, b) => Number(/home/i.test(b.name)) - Number(/home/i.test(a.name)));
  for (const f of candidates) {
    const text = addressText(f.value);
    if (text) return text.slice(0, 200);
  }
  return "";
}

/** Null when there is none on record, or Connecteam cannot be reached: the letter can still be written, the address typed in. */
export async function fetchStaffAddress(userId: number): Promise<string | null> {
  if (!isConnecteamConfigured()) return null;
  try {
    const user = (await fetchAllConnecteamUsers()).find((u) => u.userId === userId);
    return findAddress(user?.customFields) || null;
  } catch (err: any) {
    console.error("Could not read a staff address from Connecteam", err?.message);
    return null;
  }
}
