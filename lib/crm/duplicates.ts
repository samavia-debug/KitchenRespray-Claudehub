import { emailBusinessDomain, emailKey, normalizeAddress, normalizeName, phoneKey, websiteDomain } from "./normalize";
import type { ContactDuplicateMatch, DuplicateMatch } from "./types";

/** The normalised keys stored beside each company, and used to find look-alikes. */
export type CompanyKeys = {
  name_key: string;
  website_domain: string | null;
  email_domain: string | null;
  phone_key: string | null;
  address_key: string | null;
};

export function companyKeys(c: { name?: string | null; website?: string | null; email?: string | null; phone?: string | null; address?: string | null; postcode?: string | null }): CompanyKeys {
  return {
    name_key: normalizeName(c.name),
    website_domain: websiteDomain(c.website),
    // A company that gives only a gmail address has no business domain to compare.
    email_domain: emailBusinessDomain(c.email),
    phone_key: phoneKey(c.phone),
    address_key: normalizeAddress(c.address, c.postcode),
  };
}

export type ExistingCompany = CompanyKeys & { id: string; name: string; city: string | null };

/** Every name word of the shorter name appears in the longer one ("Ace Roofing" inside "Ace Roofing Dublin"). */
function nameContains(a: string, b: string): boolean {
  const wa = a.split(" ").filter(Boolean);
  const wb = b.split(" ").filter(Boolean);
  if (wa.length < 2 || wb.length < 2 || a === b) return false;
  const [short, long] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
  return short.every((w) => long.has(w));
}

/**
 * Which existing companies look like the same business as `keys`, and why. A shared phone number, website or
 * exact name is a strong match; a shared business email domain or address, or one name containing the other,
 * is a possible one. The user decides: nothing is ever merged automatically.
 */
export function matchCompanies(keys: CompanyKeys, existing: ExistingCompany[], ignoreId?: string): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  for (const e of existing) {
    if (e.id === ignoreId) continue;
    const strong: string[] = [];
    const possible: string[] = [];

    if (keys.name_key && keys.name_key === e.name_key) strong.push("same company name");
    if (keys.phone_key && keys.phone_key === e.phone_key) strong.push("same phone number");
    if (keys.website_domain && keys.website_domain === e.website_domain) strong.push("same website");
    if (keys.email_domain && keys.email_domain === e.email_domain) possible.push("same email domain");
    if (keys.address_key && keys.address_key === e.address_key) possible.push("same address");
    if (keys.name_key && e.name_key && nameContains(keys.name_key, e.name_key)) possible.push("similar name");

    if (strong.length || possible.length) {
      matches.push({ id: e.id, name: e.name, city: e.city, reasons: [...strong, ...possible], strength: strong.length ? "strong" : "possible" });
    }
  }
  // Strong matches first, then the ones with the most reasons.
  return matches.sort((a, b) => (a.strength === b.strength ? b.reasons.length - a.reasons.length : a.strength === "strong" ? -1 : 1)).slice(0, 10);
}

export type ContactKeys = { name_key: string; email_key: string | null; phone_key: string | null };

export function contactKeys(c: { full_name?: string | null; email?: string | null; phone?: string | null }): ContactKeys {
  return { name_key: normalizeName(c.full_name), email_key: emailKey(c.email), phone_key: phoneKey(c.phone) };
}

export type ExistingContact = ContactKeys & { id: string; full_name: string; company_id: string; company_name: string | null };

/**
 * Contacts that look like the same person: the same email or phone number anywhere, or the same name at the
 * same company. The same name at different companies is not flagged, as that is usually two different people.
 */
export function matchContacts(keys: ContactKeys, companyId: string, existing: ExistingContact[], ignoreId?: string): ContactDuplicateMatch[] {
  const out: ContactDuplicateMatch[] = [];
  for (const e of existing) {
    if (e.id === ignoreId) continue;
    const reasons: string[] = [];
    if (keys.email_key && keys.email_key === e.email_key) reasons.push("same email address");
    if (keys.phone_key && keys.phone_key === e.phone_key) reasons.push("same phone number");
    if (keys.name_key && keys.name_key === e.name_key && e.company_id === companyId) reasons.push("same name at this company");
    if (reasons.length) out.push({ id: e.id, full_name: e.full_name, company_id: e.company_id, company_name: e.company_name, reasons });
  }
  return out.slice(0, 10);
}
