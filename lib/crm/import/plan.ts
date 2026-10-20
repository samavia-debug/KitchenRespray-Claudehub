import { companyKeys, contactKeys, matchCompanies, type CompanyKeys, type ExistingCompany } from "../duplicates";
import type { DuplicateMatch } from "../types";
import type { BuiltRow } from "./mapping";

/**
 * Finds likely look-alikes without comparing every company with every other. Companies are filed under each of their
 * keys (phone, website, name...), and a new company is only compared with the ones that share at least one.
 */
export class CompanyIndex {
  private maps = {
    name: new Map<string, ExistingCompany[]>(),
    phone: new Map<string, ExistingCompany[]>(),
    website: new Map<string, ExistingCompany[]>(),
    email: new Map<string, ExistingCompany[]>(),
    address: new Map<string, ExistingCompany[]>(),
    word: new Map<string, ExistingCompany[]>(),
  };

  private file(map: Map<string, ExistingCompany[]>, key: string | null | undefined, c: ExistingCompany) {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(c);
    else map.set(key, [c]);
  }

  add(c: ExistingCompany) {
    const nameKey = c.name_key ?? "";
    this.file(this.maps.name, nameKey, c);
    this.file(this.maps.phone, c.phone_key, c);
    if (c.mobile_key && c.mobile_key !== c.phone_key) this.file(this.maps.phone, c.mobile_key, c);
    this.file(this.maps.website, c.website_domain, c);
    this.file(this.maps.email, c.email_domain, c);
    this.file(this.maps.address, c.address_key, c);
    // Any word of the name, so "Ace Roofing" is found for "Ace Roofing Dublin" (a very common word is capped).
    for (const w of Array.from(new Set(nameKey.split(" ").filter((x) => x.length >= 3)))) this.file(this.maps.word, w, c);
  }

  candidates(keys: CompanyKeys): ExistingCompany[] {
    const found = new Set<ExistingCompany>();
    const take = (list: ExistingCompany[] | undefined, cap = Infinity) => list?.slice(0, cap).forEach((c) => found.add(c));
    take(this.maps.name.get(keys.name_key));
    for (const k of [keys.phone_key, keys.mobile_key]) if (k) take(this.maps.phone.get(k));
    if (keys.website_domain) take(this.maps.website.get(keys.website_domain));
    if (keys.email_domain) take(this.maps.email.get(keys.email_domain));
    if (keys.address_key) take(this.maps.address.get(keys.address_key));
    for (const w of Array.from(new Set(keys.name_key.split(" ").filter((x) => x.length >= 3)))) take(this.maps.word.get(w), 300);
    return Array.from(found);
  }
}

export type FileMatch = { row: number; label: string; reasons: string[]; strength: "strong" | "possible" };

export type PlanRow = {
  /** 0-based position in the file's data rows. */
  index: number;
  label: string;
  status: "ready" | "duplicate" | "error";
  errors: string[];
  warnings: string[];
  /** Companies already in the CRM that look like this one. */
  matches: DuplicateMatch[];
  /** Earlier rows of the same file that look like this one. */
  fileMatches: FileMatch[];
  /** Set when the row's contact is already in the CRM (or earlier in the file), so no contact will be added. */
  contactNote: string | null;
  hasContact: boolean;
  /** What happens when the person makes no choice: a strong look-alike or an error is skipped. */
  defaultAction: "import" | "skip";
};

export type ExistingContactKeys = { email_key: string | null; phone_key: string | null };

/**
 * Works out, for every row, whether it can be imported and whether it looks like something already there (in the CRM
 * or earlier in the same file). Nothing is decided here: a possible look-alike is only flagged.
 */
export function planImport(rows: BuiltRow[], existing: ExistingCompany[], existingContacts: ExistingContactKeys[]): PlanRow[] {
  const inCrm = new CompanyIndex();
  existing.forEach((c) => inCrm.add(c));
  const inFile = new CompanyIndex();

  const seenEmail = new Set(existingContacts.map((c) => c.email_key).filter((k): k is string => !!k));
  const seenPhone = new Set(existingContacts.map((c) => c.phone_key).filter((k): k is string => !!k));

  return rows.map((row, index): PlanRow => {
    const base = { index, label: row.label, errors: row.errors, warnings: row.warnings, hasContact: !!row.contact };
    if (!row.company) return { ...base, status: "error", matches: [], fileMatches: [], contactNote: null, defaultAction: "skip" };

    const keys = companyKeys(row.company);
    const matches = matchCompanies(keys, inCrm.candidates(keys));
    const fileMatches: FileMatch[] = matchCompanies(keys, inFile.candidates(keys)).map((m) => ({ row: Number(m.id.slice(4)), label: m.name, reasons: m.reasons, strength: m.strength }));
    inFile.add({ id: `row:${index}`, name: row.label, city: row.company.city ?? null, ...keys });

    let contactNote: string | null = null;
    if (row.contact) {
      const ck = contactKeys(row.contact);
      if ((ck.email_key && seenEmail.has(ck.email_key)) || (ck.phone_key && seenPhone.has(ck.phone_key))) contactNote = "This contact is already in the CRM, so no contact will be added.";
      if (ck.email_key) seenEmail.add(ck.email_key);
      if (ck.phone_key) seenPhone.add(ck.phone_key);
    }

    const strong = matches.some((m) => m.strength === "strong") || fileMatches.some((m) => m.strength === "strong");
    const duplicate = matches.length > 0 || fileMatches.length > 0;
    return { ...base, status: duplicate ? "duplicate" : "ready", matches, fileMatches, contactNote, defaultAction: strong ? "skip" : "import" };
  });
}

export type PlanCounts = { total: number; ready: number; duplicates: number; errors: number; withWarnings: number; willImport: number; willSkip: number };

/** What the import would do, given the person's per-row choices (a choice only applies to rows that can be imported). */
export function countPlan(plan: PlanRow[], decisions: Record<number, "import" | "skip"> = {}): PlanCounts {
  const counts: PlanCounts = { total: plan.length, ready: 0, duplicates: 0, errors: 0, withWarnings: 0, willImport: 0, willSkip: 0 };
  for (const p of plan) {
    if (p.status === "ready") counts.ready++;
    else if (p.status === "duplicate") counts.duplicates++;
    else counts.errors++;
    if (p.warnings.length) counts.withWarnings++;
    if (actionFor(p, decisions) === "import") counts.willImport++;
    else counts.willSkip++;
  }
  return counts;
}

/** A row with an error is never imported. Otherwise the person's choice wins, then the default. */
export function actionFor(p: PlanRow, decisions: Record<number, "import" | "skip">): "import" | "skip" {
  if (p.status === "error") return "skip";
  return decisions[p.index] ?? p.defaultAction;
}
