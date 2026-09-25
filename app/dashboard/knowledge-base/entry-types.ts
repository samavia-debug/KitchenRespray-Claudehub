export type EntryType =
  | "document"
  | "faq"
  | "pricing"
  | "company_fact"
  | "brand"
  | "service"
  | "person"
  | "process"
  | "sop"
  | "decision"
  | "policy"
  | "training"
  | "client"
  | "project"
  | "marketing"
  | "technical"
  | "other";

export type EntryStatus = "draft" | "review" | "verified" | "outdated" | "archived";

export const ENTRY_TYPES: EntryType[] = [
  "company_fact",
  "brand",
  "service",
  "person",
  "process",
  "sop",
  "decision",
  "policy",
  "faq",
  "training",
  "client",
  "project",
  "marketing",
  "technical",
  "document",
  "pricing",
  "other",
];

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  document: "Document",
  faq: "FAQ",
  pricing: "Pricing",
  company_fact: "Company Fact",
  brand: "Brand",
  service: "Service",
  person: "Person",
  process: "Process",
  sop: "SOP",
  decision: "Decision",
  policy: "Policy",
  training: "Training",
  client: "Client",
  project: "Project",
  marketing: "Marketing",
  technical: "Technical",
  other: "Other",
};

export const ENTRY_STATUSES: EntryStatus[] = ["draft", "review", "verified", "outdated", "archived"];

export const STATUS_COLOR: Record<EntryStatus, string> = {
  draft: "#6f6a63",
  review: "#b98900",
  verified: "#2e7d32",
  outdated: "#b3261e",
  archived: "#6f6a63",
};

export type KnowledgeEntry = {
  id: string;
  website_id: string | null;
  entry_type: EntryType;
  title: string;
  content: string;
  tags: string[];
  status: EntryStatus;
  owner_name: string | null;
  source: string | null;
  review_date: string | null;
  created_at: string;
  updated_at: string;
};

export type WebsiteOption = { id: string; name: string };
