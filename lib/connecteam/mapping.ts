import type { ConnecteamUser } from "./client";

export const CONNECTEAM_SOURCE = "connecteam";

// The text before the colon on each line of a synced entry. Shared by the
// writer (buildStaffEntry) and the reader (parseStaffContent), so the Staff
// view can't drift out of step with what the sync writes.
export const STAFF_LABEL = {
  access: "Connecteam access level",
  jobTitle: "Job title",
  role: "Role",
  department: "Department",
  team: "Team",
  branch: "Branch",
  employmentType: "Employment type",
  workerType: "Worker type",
  startDate: "Start date",
  employeeId: "Employee ID",
  manager: "Direct manager",
  email: "Email",
  phone: "Phone",
} as const;

export type StaffEntry = {
  entry_type: "person";
  title: string;
  content: string;
  tags: string[];
  status: "verified" | "archived";
  source: string;
  owner_name: string;
  external_source: string;
  external_id: string;
};

const ACCESS_LEVEL_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  user: "Employee",
};

// Only these Connecteam custom fields are copied into Eleven. Birthday,
// gender, home address, pay type and overtime eligibility are deliberately
// absent — personal or pay data stays in Connecteam. Adding a field here is
// the only change needed to bring another one across.
const SYNCED_FIELDS: { name: string; label: string }[] = [
  { name: "Title", label: STAFF_LABEL.jobTitle },
  { name: "Role", label: STAFF_LABEL.role },
  { name: "Department", label: STAFF_LABEL.department },
  { name: "Team", label: STAFF_LABEL.team },
  { name: "Branch", label: STAFF_LABEL.branch },
  { name: "Employment Type", label: STAFF_LABEL.employmentType },
  { name: "Worker Type", label: STAFF_LABEL.workerType },
  { name: "Employment Start Date", label: STAFF_LABEL.startDate },
  { name: "Employee ID", label: STAFF_LABEL.employeeId },
];

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object" && "value" in item) return renderValue((item as { value: unknown }).value);
        return renderValue(item);
      })
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

function fullName(user: ConnecteamUser): string {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
}

export function buildStaffEntry(user: ConnecteamUser, managerNameById: Map<number, string>): StaffEntry {
  const archived = !!user.isArchived;
  const lines: string[] = [];

  if (archived) lines.push("Former employee — archived in Connecteam.");

  const access = user.userType ? ACCESS_LEVEL_LABEL[user.userType] || user.userType : "";
  if (access) lines.push(`${STAFF_LABEL.access}: ${access}`);

  const fieldsByName = new Map((user.customFields ?? []).map((f) => [f.name, f]));
  for (const { name, label } of SYNCED_FIELDS) {
    const text = renderValue(fieldsByName.get(name)?.value);
    if (text) lines.push(`${label}: ${text}`);
  }

  const managerId = fieldsByName.get("Direct manager")?.value;
  if (typeof managerId === "number" && managerNameById.has(managerId)) {
    lines.push(`${STAFF_LABEL.manager}: ${managerNameById.get(managerId)}`);
  }

  if (user.email) lines.push(`${STAFF_LABEL.email}: ${user.email}`);
  if (user.phoneNumber) lines.push(`${STAFF_LABEL.phone}: ${user.phoneNumber}`);

  return {
    entry_type: "person",
    title: fullName(user) || user.email || `Connecteam user ${user.userId}`,
    content: lines.join("\n"),
    tags: ["connecteam", "staff"],
    status: archived ? "archived" : "verified",
    source: "Connecteam (synced automatically — edits here are overwritten on the next sync)",
    // Knowledge Health flags any entry with no owner; the system that keeps
    // these accurate is Connecteam itself.
    owner_name: "Connecteam",
    external_source: CONNECTEAM_SOURCE,
    external_id: String(user.userId),
  };
}

export function buildStaffEntries(users: ConnecteamUser[]): StaffEntry[] {
  const managerNameById = new Map<number, string>();
  for (const u of users) {
    const name = fullName(u);
    if (name) managerNameById.set(u.userId, name);
  }
  return users.map((u) => buildStaffEntry(u, managerNameById));
}

export type StaffDetails = Partial<Record<keyof typeof STAFF_LABEL, string>> & { former: boolean };

/** Reads a synced entry's content back into named fields for the Staff view. */
export function parseStaffContent(content: string): StaffDetails {
  const byLabel = new Map<string, string>();
  let former = false;

  for (const line of content.split("\n")) {
    if (line.startsWith("Former employee")) {
      former = true;
      continue;
    }
    const i = line.indexOf(": ");
    if (i > 0) byLabel.set(line.slice(0, i), line.slice(i + 2));
  }

  const details: StaffDetails = { former };
  for (const [key, label] of Object.entries(STAFF_LABEL) as [keyof typeof STAFF_LABEL, string][]) {
    const value = byLabel.get(label);
    if (value) details[key] = value;
  }
  return details;
}
