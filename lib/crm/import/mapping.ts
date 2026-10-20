import { cleanContactInput, cleanCompanyInput } from "../validate";
import { PRIORITIES, type Category, type CompanyFields, type ContactFields, type Priority } from "../types";

export type ImportTarget = { id: string; label: string; group: "Company" | "Contact" | "Other" };

/** What a spreadsheet column can be mapped to. */
export const IMPORT_TARGETS: ImportTarget[] = [
  { id: "name", label: "Company name", group: "Company" },
  { id: "category", label: "Customer category", group: "Company" },
  { id: "website", label: "Website", group: "Company" },
  { id: "phone", label: "Business telephone", group: "Company" },
  { id: "mobile", label: "Mobile / WhatsApp", group: "Company" },
  { id: "email", label: "General email", group: "Company" },
  { id: "address", label: "Address", group: "Company" },
  { id: "city", label: "Town or city", group: "Company" },
  { id: "county", label: "County", group: "Company" },
  { id: "postcode", label: "Postcode", group: "Company" },
  { id: "country", label: "Country", group: "Company" },
  { id: "services", label: "Potential services", group: "Company" },
  { id: "description", label: "Business description", group: "Company" },
  { id: "estimated_value", label: "Estimated opportunity value", group: "Company" },
  { id: "source", label: "Source of the prospect", group: "Company" },
  { id: "priority", label: "Priority", group: "Company" },
  { id: "notes", label: "Notes", group: "Company" },
  { id: "contact_name", label: "Contact: full name", group: "Contact" },
  { id: "contact_job_title", label: "Contact: job title", group: "Contact" },
  { id: "contact_email", label: "Contact: email", group: "Contact" },
  { id: "contact_phone", label: "Contact: phone or mobile", group: "Contact" },
  { id: "extra", label: "Keep as an extra detail", group: "Other" },
  { id: "ignore", label: "Do not import", group: "Other" },
];

const TARGET_IDS = new Set(IMPORT_TARGETS.map((t) => t.id));
/** Targets that may be used by several columns. Everything else takes one column. */
const REPEATABLE = new Set(["extra", "ignore"]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const SYNONYMS: Record<string, string[]> = {
  name: ["companyname", "company", "name", "businessname", "organisation", "organization", "tradingname", "business"],
  website: ["website", "companywebsite", "web", "url", "site", "websiteurl", "webaddress"],
  email: ["email", "publicbusinessemail", "generalemail", "businessemail", "emailaddress", "companyemail"],
  phone: ["phone", "telephone", "tel", "contactphonenumber", "contactphone", "phonenumber", "businessphone", "businesstelephone", "landline", "telephonenumber"],
  mobile: ["mobile", "mobilenumber", "mobilephone", "cell", "whatsapp", "whatsappnumber"],
  address: ["address", "businessaddress", "streetaddress", "street", "address1", "addressline1"],
  city: ["city", "town", "citytown", "townorcity"],
  county: ["county", "region", "state"],
  postcode: ["postcode", "postalcode", "eircode", "zip", "zipcode"],
  country: ["country"],
  category: ["category", "customercategory", "customertype", "companytype"],
  services: ["primaryservices", "primaryservice", "services", "servicescategory", "servicecategory", "potentialservices", "trade", "specialism"],
  description: ["description", "businessdescription", "about"],
  source: ["source", "leadsource"],
  priority: ["priority"],
  notes: ["notes", "note", "comments", "comment"],
  estimated_value: ["estimatedvalue", "opportunityvalue", "estimate"],
  contact_name: ["contactname", "contactperson", "fullname"],
  contact_job_title: ["jobtitle", "contacttitle", "role", "position"],
  contact_email: ["contactemail"],
};

const BY_HEADER = new Map<string, string>();
for (const [target, names] of Object.entries(SYNONYMS)) for (const n of names) BY_HEADER.set(n, target);

/** Columns worth keeping even though they are not CRM fields: ratings, review counts, map links, summaries. */
const EXTRA_HINT = /rating|review|maps|listing|summary|stars/i;

/**
 * A first guess at what each column is, from its heading. The person can change every one. A target is only
 * suggested once, so two columns never fight over "phone" (the later one becomes "do not import").
 */
export function autoMap(headers: string[]): string[] {
  const used = new Set<string>();
  return headers.map((h) => {
    const target = BY_HEADER.get(norm(h));
    if (target && !used.has(target)) {
      used.add(target);
      return target;
    }
    if (!target && EXTRA_HINT.test(h)) return "extra";
    return "ignore";
  });
}

/** What is wrong with a chosen mapping, or null when it can be used. */
export function validateMapping(targets: unknown, columnCount: number): string | null {
  if (!Array.isArray(targets) || targets.length !== columnCount) return "The column choices do not match the file. Upload it again.";
  const seen = new Set<string>();
  for (const t of targets) {
    if (typeof t !== "string" || !TARGET_IDS.has(t)) return "One of the column choices is not recognised.";
    if (!REPEATABLE.has(t)) {
      if (seen.has(t)) return `More than one column is set to "${IMPORT_TARGETS.find((x) => x.id === t)!.label}". Choose one.`;
      seen.add(t);
    }
  }
  if (!seen.has("name")) return "Choose which column holds the company name.";
  return null;
}

export type ImportDefaults = { category_id: string | null; source: string | null; assigned_to: string | null; priority: Priority | null };
export const NO_DEFAULTS: ImportDefaults = { category_id: null, source: null, assigned_to: null, priority: null };

export type BuiltRow = {
  /** The company to create, or null when the row cannot be imported. */
  company: Partial<CompanyFields> | null;
  contact: Partial<ContactFields> | null;
  /** Spreadsheet details kept on the company without being CRM fields, including values that were not valid. */
  extra: Record<string, string>;
  warnings: string[];
  errors: string[];
  /** For showing in lists: the name as written in the file. */
  label: string;
};

const MAX_EXTRA_KEYS = 30;
const MAX_EXTRA_CHARS = 2000;
const NIL_UUID = "00000000-0000-4000-8000-000000000000";

const FIELD_LABEL: Record<string, string> = {
  website: "Website",
  phone: "Telephone",
  mobile: "Mobile",
  email: "Email",
  address: "Address",
  city: "Town or city",
  county: "County",
  postcode: "Postcode",
  country: "Country",
  description: "Description",
  services: "Potential services",
  estimated_value: "Estimated value",
  source: "Source",
  notes: "Notes",
};

const short = (v: string) => (v.length > 40 ? `${v.slice(0, 37)}...` : v);

/** Turns one spreadsheet row into a company (and optionally a contact), noting anything that was left out and why. */
export function buildRow(cells: string[], headers: string[], targets: string[], ctx: { categories: Category[]; defaults: ImportDefaults }): BuiltRow {
  const warnings: string[] = [];
  const errors: string[] = [];
  const extra: Record<string, string> = {};
  const take = (target: string) => {
    const i = targets.indexOf(target);
    const v = i >= 0 ? (cells[i] ?? "").trim() : "";
    return v === "" ? undefined : v;
  };
  // Something that cannot be used is kept under "Not imported" so nothing the spreadsheet held is lost.
  const keepUnused = (label: string, value: string) => {
    if (Object.keys(extra).length < MAX_EXTRA_KEYS) extra[`Not imported: ${label}`] = value.slice(0, MAX_EXTRA_CHARS);
  };

  const name = take("name");
  if (!name) errors.push("There is no company name");
  else if (name.length > 200) errors.push("The company name is too long (200 characters at most)");

  const company: Partial<CompanyFields> = {};
  if (name) company.name = name;

  for (const field of Object.keys(FIELD_LABEL)) {
    const value = take(field);
    if (value === undefined) continue;
    const checked = cleanCompanyInput({ name: "x", [field]: value });
    if ("error" in checked) {
      warnings.push(`${FIELD_LABEL[field]} "${short(value)}" is not valid, so it was left out`);
      keepUnused(FIELD_LABEL[field], value);
    } else (company as Record<string, unknown>)[field] = (checked.value as Record<string, unknown>)[field];
  }

  const priority = take("priority");
  if (priority) {
    const match = PRIORITIES.find((p) => p.toLowerCase() === priority.toLowerCase());
    if (match) company.priority = match;
    else {
      warnings.push(`Priority "${short(priority)}" is not High, Medium or Low, so it was left out`);
      keepUnused("Priority", priority);
    }
  }

  const categoryText = take("category");
  let category_id: string | null = null;
  if (categoryText) {
    const wanted = norm(categoryText);
    category_id = ctx.categories.find((c) => c.active && norm(c.name) === wanted)?.id ?? null;
    if (!category_id) {
      warnings.push(`Category "${short(categoryText)}" is not one of your categories`);
      if (Object.keys(extra).length < MAX_EXTRA_KEYS) extra["Category in file"] = categoryText.slice(0, MAX_EXTRA_CHARS);
    }
  }
  company.category_id = category_id ?? ctx.defaults.category_id;
  if (!company.source && ctx.defaults.source) company.source = ctx.defaults.source;
  if (!company.priority && ctx.defaults.priority) company.priority = ctx.defaults.priority;
  company.assigned_to = ctx.defaults.assigned_to;

  headers.forEach((h, i) => {
    if (targets[i] !== "extra") return;
    const v = (cells[i] ?? "").trim();
    if (v && Object.keys(extra).length < MAX_EXTRA_KEYS) extra[h] = v.slice(0, MAX_EXTRA_CHARS);
  });

  let contact: Partial<ContactFields> | null = null;
  const contactName = take("contact_name");
  if (contactName) {
    const base = cleanContactInput({ company_id: NIL_UUID, full_name: contactName });
    if ("error" in base) warnings.push(`The contact "${short(contactName)}" could not be added: ${base.error}`);
    else {
      contact = { full_name: base.value.full_name };
      for (const [target, field, label] of [["contact_job_title", "job_title", "Contact job title"], ["contact_email", "email", "Contact email"], ["contact_phone", "phone", "Contact phone"]] as const) {
        const value = take(target);
        if (value === undefined) continue;
        const checked = cleanContactInput({ company_id: NIL_UUID, full_name: "x", [field]: value });
        if ("error" in checked) {
          warnings.push(`${label} "${short(value)}" is not valid, so it was left out`);
          keepUnused(label, value);
        } else (contact as Record<string, unknown>)[field] = (checked.value as Record<string, unknown>)[field];
      }
    }
  } else if (take("contact_email") || take("contact_phone") || take("contact_job_title")) {
    warnings.push("There are contact details but no contact name, so no contact was added");
  }

  return { company: errors.length ? null : company, contact: errors.length ? null : contact, extra, warnings, errors, label: name ?? "(no name)" };
}
