export const PRIORITIES = ["High", "Medium", "Low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CONTACT_METHODS = ["WhatsApp", "Phone", "Email", "In person"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

/** What the code relies on; a stage can be renamed in Settings without losing its meaning. */
export type StageKind = "open" | "won" | "lost" | "not_suitable";
export const STAGE_KINDS: StageKind[] = ["open", "won", "lost", "not_suitable"];

/** Moving into one of these needs an explicit confirmation, and may record an outcome. */
export const CLOSING_KINDS: StageKind[] = ["won", "lost", "not_suitable"];

export type Category = { id: string; name: string; sort_order: number; active: boolean };
export type Stage = { id: string; name: string; kind: StageKind; sort_order: number; active: boolean };
export type Assignee = { id: string; email: string; role: string };

export type CompanyFields = {
  name: string;
  category_id: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  postcode: string | null;
  country: string;
  description: string | null;
  services: string | null;
  estimated_value: number | null;
  source: string | null;
  priority: Priority;
  assigned_to: string | null;
  next_follow_up: string | null;
  notes: string | null;
};

export type Company = CompanyFields & {
  id: string;
  stage_id: string | null;
  stage_changed_at: string | null;
  won_value: number | null;
  outcome_note: string | null;
  last_contacted_at: string | null;
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ContactFields = {
  company_id: string;
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  preferred_method: ContactMethod | null;
  source: string | null;
  notes: string | null;
  next_follow_up: string | null;
  assigned_to: string | null;
};

export type Contact = ContactFields & {
  id: string;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DuplicateMatch = {
  id: string;
  name: string;
  city: string | null;
  reasons: string[];
  strength: "strong" | "possible";
};

export type ContactDuplicateMatch = {
  id: string;
  full_name: string;
  company_id: string;
  company_name: string | null;
  reasons: string[];
};

export const SORT_FIELDS = ["name", "city", "created_at", "updated_at", "next_follow_up", "last_contacted_at", "estimated_value"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export type CompanyQuery = {
  q: string;
  category_id: string | null;
  stage_id: string | null;
  assigned_to: string | null; // a user id, or "none" for unassigned
  priority: Priority | null;
  source: string | null;
  location: string;
  contacted_before: string | null;
  follow_up_before: string | null;
  min_value: number | null;
  max_value: number | null;
  page: number;
  pageSize: number;
  sort: SortField;
  dir: "asc" | "desc";
};
