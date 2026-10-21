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
  /** A mobile (WhatsApp) number, apart from the main phone. */
  mobile: string | null;
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
  notes: string | null;
};

export type Company = CompanyFields & {
  id: string;
  // The earliest open follow-up, kept up to date by the server. It is never typed in.
  next_follow_up: string | null;
  last_activity_type: string | null;
  last_activity_at: string | null;
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
  assigned_to: string | null;
};

export type Contact = ContactFields & {
  id: string;
  next_follow_up: string | null;
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
  /** One of the county choices, or "none" for companies with no county set. */
  county: string | null;
  contacted_before: string | null;
  follow_up_before: string | null;
  min_value: number | null;
  max_value: number | null;
  page: number;
  pageSize: number;
  sort: SortField;
  dir: "asc" | "desc";
};

// ---------- activities, follow-ups and opportunities (phase 3) ----------

export const ACTIVITY_TYPES = [
  "Initial research",
  "Telephone call",
  "WhatsApp message",
  "Email sent",
  "Promotional material sent",
  "WhatsApp follow-up",
  "Follow-up email",
  "Follow-up call",
  "Meeting",
  "Site visit",
  "Quote requested",
  "Quote sent",
  "Other",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/**
 * The activities that mean the company or contact was actually reached or dealt with, so "last contacted" moves.
 * Research and "Other" are real work but are not contact.
 */
export const CONTACT_ACTIVITY_TYPES: ActivityType[] = [
  "Telephone call",
  "WhatsApp message",
  "Email sent",
  "Promotional material sent",
  "WhatsApp follow-up",
  "Follow-up email",
  "Follow-up call",
  "Meeting",
  "Site visit",
  "Quote requested",
  "Quote sent",
];

export type ActivityFields = {
  company_id: string;
  contact_id: string | null;
  type: ActivityType;
  occurred_at: string | null;
  user_id: string | null;
  outcome: string | null;
  notes: string | null;
  next_action: string | null;
  next_follow_up: string | null;
};

export type Activity = {
  id: string;
  company_id: string;
  contact_id: string | null;
  contact_name: string | null;
  type: ActivityType;
  occurred_at: string;
  user_id: string | null;
  user_email: string | null;
  outcome: string | null;
  notes: string | null;
  next_action: string | null;
  next_follow_up: string | null;
  created_at: string;
};

export type TaskStatus = "open" | "done" | "cancelled";

export type TaskFields = {
  company_id: string;
  contact_id: string | null;
  title: string;
  due_date: string;
  assigned_to: string | null;
};

export type Task = {
  id: string;
  company_id: string;
  company_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  title: string;
  due_date: string;
  assigned_to: string | null;
  assignee_email: string | null;
  status: TaskStatus;
  completed_at: string | null;
  result: string | null;
  last_activity_type: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
};

export const FOLLOW_UP_VIEWS = ["overdue", "today", "week", "upcoming", "completed"] as const;
export type FollowUpView = (typeof FOLLOW_UP_VIEWS)[number];

export const OPPORTUNITY_STATUSES = ["identified", "quote_requested", "quote_sent", "won", "lost"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];
export const OPPORTUNITY_STATUS_LABEL: Record<OpportunityStatus, string> = {
  identified: "Identified",
  quote_requested: "Quote requested",
  quote_sent: "Quote sent",
  won: "Won",
  lost: "Lost",
};

/** Where a job came from. Left empty when nobody has said, and a sale is only credited to a source that was recorded. */
export const OPPORTUNITY_SOURCES = ["Direct prospecting", "Website enquiry", "Referral", "Existing customer", "Other"] as const;
export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];

export type OpportunityFields = {
  company_id: string;
  title: string;
  description: string | null;
  estimated_value: number | null;
  source: OpportunitySource | null;
  assigned_to: string | null;
};

export type Opportunity = OpportunityFields & {
  id: string;
  status: OpportunityStatus;
  status_changed_at: string;
  won_value: number | null;
  outcome_note: string | null;
  assignee_email: string | null;
  created_at: string;
  updated_at: string;
};
