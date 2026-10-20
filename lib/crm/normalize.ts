/**
 * Normalised copies of names, phone numbers and web addresses. They exist so two spellings of the same
 * thing ("A&B Roofing Ltd." and "A and B Roofing Limited", "087 123 4567" and "+353 87 123 4567") compare
 * as equal when warning about duplicates. They are never shown to anyone.
 */

const LEGAL_WORDS = new Set(["ltd", "limited", "llc", "inc", "plc", "co", "company", "dac", "clg", "unlimited", "the", "and", "t/a", "ta", "trading", "as"]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** "A&B Roofing Ltd." -> "a b roofing". Drops legal suffixes and punctuation. */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  const words = stripAccents(raw)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !LEGAL_WORDS.has(w));
  return words.join(" ");
}

/** Lower-case street address with punctuation removed, or null when there is too little to compare. */
export function normalizeAddress(raw: string | null | undefined, postcode?: string | null): string | null {
  const text = stripAccents(`${raw ?? ""} ${postcode ?? ""}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return text.length >= 8 ? text : null;
}

/**
 * The national part of a phone number, digits only, so "+353 87 123 4567", "087 123 4567" and
 * "00353 (0)87 1234567" all give "871234567". Null when there are fewer than 7 digits.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\(0\)/g, "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("353")) digits = digits.slice(3);
  digits = digits.replace(/^0+/, "");
  return digits.length >= 7 ? digits : null;
}

/** Providers anyone can sign up to; two companies sharing one are not the same company. */
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.ie", "yahoo.co.uk", "ymail.com", "hotmail.com", "hotmail.ie", "hotmail.co.uk",
  "outlook.com", "outlook.ie", "live.com", "live.ie", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "eircom.net",
  "gmx.com", "gmx.net", "protonmail.com", "proton.me", "vodafone.ie", "btinternet.com", "sky.com", "mail.com",
]);

export function isFreeEmailDomain(domain: string | null | undefined): boolean {
  return !!domain && FREE_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/** The host of a web address ("https://www.Example.ie/page" -> "example.ie"), or null when it is not one. */
export function websiteDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** The domain of an email address, or null for a free provider (shared by many unrelated people) or a bad address. */
export function emailBusinessDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const at = raw.trim().toLowerCase().split("@");
  if (at.length !== 2) return null;
  const domain = at[1].replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || isFreeEmailDomain(domain)) return null;
  return domain;
}

export function emailKey(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/** A web address with a scheme, or null when it does not look like one. */
export function cleanWebsite(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!websiteDomain(value)) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/**
 * Text from a search box made safe to put inside a database filter: the characters that carry meaning in
 * the filter syntax are removed, and it is cut to a sensible length.
 */
export function searchTerm(raw: string | null | undefined): string {
  return (raw ?? "")
    .replace(/[,()*%\\"'`;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}
